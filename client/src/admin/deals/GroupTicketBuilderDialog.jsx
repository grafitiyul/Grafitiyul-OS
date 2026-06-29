import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import { InlineEditScope } from '../common/inline/InlineEditScope.jsx';
import InlineField from '../common/inline/InlineField.jsx';
import { api } from '../../lib/api.js';
import { formatMinor, minorToInput, toMinor } from '../../lib/money.js';

// Group Ticket Builder — a dedicated ticket-sales workspace for Group deals. It is
// NOT the Business Price Builder: instead of free rows, each Pricing Card the owner
// opted into Group Ticket Sales (the flag is the SOLE authority) becomes one
// section, with one row per priced ticket type. No product/city/activity filtering;
// no fabricated rows — only cards with explicit ticket-type pricing are sellable
// (cards without it are surfaced as a config warning, never invented into a row).
//
// It REUSES the platform: the same Dialog shell + totals area, the same calculation
// engine (/api/pricing/builder) and the same canonical storage (QuoteVersion /
// QuoteLine via /api/deals/:id/price-lines).
//
// Row identity is STRUCTURED, never note-encoded: each line persists
// sourceKind='group_ticket' + sourceCardGroupId + ticketTypeId, so reopening
// re-hydrates the exact card/ticket-type. The user `note` is left untouched and is
// safe to edit/clear/translate without affecting identity. Payment Terms / Payment
// Method are intentionally absent — they belong to the Deal's financial area.

const SOURCE_KIND = 'group_ticket';

// In-dialog row key (also the engine line id) — distinct per card × ticket type.
function rowIdFor(cardGroupId, ticketTypeId) {
  return `${cardGroupId}::${ticketTypeId}`;
}
// Identity key used to match a SAVED line back to a current card row. Only
// group-ticket lines carrying both structured ids participate.
function savedKeyOf(line) {
  if (line?.sourceKind !== SOURCE_KIND) return null;
  if (!line.sourceCardGroupId || !line.ticketTypeId) return null;
  return rowIdFor(line.sourceCardGroupId, line.ticketTypeId);
}

export default function GroupTicketBuilderDialog({ open, deal, context, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState([]);
  const [unconfigured, setUnconfigured] = useState([]);
  // rowId → { quantity, unitPriceMinor, overridden }. The card's own price stays on
  // the card (source of truth); a non-overridden row always reflects the latest.
  const [byRow, setByRow] = useState({});
  const [computed, setComputed] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const calcTimer = useRef(null);

  // Load the enabled cards + the deal's existing lines, then merge by STRUCTURED
  // identity (sourceCardGroupId + ticketTypeId). Saved quantities/overrides win for
  // rows that still exist; new rows default to qty 0.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setSaveError(null);
    Promise.all([
      api.pricing.groupCards().catch(() => ({ cards: [], unconfigured: [] })),
      api.deals.getPriceLines(deal.id).then((r) => r?.lines || []).catch(() => []),
    ])
      .then(([cardData, savedLines]) => {
        if (!live) return;
        const cardList = cardData?.cards || [];
        const savedByKey = new Map();
        for (const ln of savedLines) {
          const key = savedKeyOf(ln);
          if (key) savedByKey.set(key, ln);
        }
        const next = {};
        for (const card of cardList) {
          for (const row of card.rows) {
            const id = rowIdFor(card.cardGroupId, row.ticketTypeId);
            const saved = savedByKey.get(id);
            next[id] = {
              quantity: saved ? Number(saved.quantity) || 0 : 0,
              unitPriceMinor: saved?.overridden ? Number(saved.unitPriceMinor) || 0 : row.unitPriceMinor,
              overridden: !!saved?.overridden,
            };
          }
        }
        setCards(cardList);
        setUnconfigured(cardData?.unconfigured || []);
        setByRow(next);
        setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deal?.id]);

  // Flatten cards + per-row state into builder lines (engine input + save payload).
  // Each line carries its structured identity; `note` is intentionally never set.
  const lines = useMemo(() => {
    const out = [];
    for (const card of cards) {
      for (const row of card.rows) {
        const id = rowIdFor(card.cardGroupId, row.ticketTypeId);
        const st = byRow[id] || { quantity: 0, unitPriceMinor: row.unitPriceMinor, overridden: false };
        out.push({
          id,
          kind: 'manual',
          label: `${card.title} — ${row.label}`,
          refId: null,
          quantity: st.quantity,
          unitPriceMinor: st.unitPriceMinor,
          vatMode: card.vatMode || 'inherit',
          vatRate: card.vatRate ?? null,
          active: true,
          overridden: st.overridden,
          sourceKind: SOURCE_KIND,
          sourceCardGroupId: card.cardGroupId,
          ticketTypeId: row.ticketTypeId,
        });
      }
    }
    return out;
  }, [cards, byRow]);

  // Totals via the SAME engine the Price Builder uses. Debounced on row changes.
  useEffect(() => {
    if (!open || !lines.length) {
      setComputed(null);
      return undefined;
    }
    if (calcTimer.current) clearTimeout(calcTimer.current);
    calcTimer.current = setTimeout(() => {
      api.pricing
        .builder({ context, lines })
        .then((r) => setComputed(r))
        .catch((e) => setComputed({ ok: false, error: e.message }));
    }, 300);
    return () => calcTimer.current && clearTimeout(calcTimer.current);
  }, [open, lines, context]);

  const totals = computed?.totals;
  const vatDefault = computed?.vatDefault;

  function setQty(id, raw) {
    const quantity = Math.max(0, parseInt(String(raw).replace(/[^0-9]/g, ''), 10) || 0);
    setByRow((s) => ({ ...s, [id]: { ...s[id], quantity } }));
  }
  function setPrice(id, unitPriceMinor) {
    setByRow((s) => ({ ...s, [id]: { ...s[id], unitPriceMinor: unitPriceMinor ?? 0, overridden: true } }));
  }
  function revertPrice(id, cardPriceMinor) {
    setByRow((s) => ({ ...s, [id]: { ...s[id], unitPriceMinor: cardPriceMinor, overridden: false } }));
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      // Persist only rows that carry data (a sold quantity or a manual price). Empty
      // rows aren't stored — they re-appear from the card on reopen at qty 0.
      const toSave = lines.filter((l) => l.quantity > 0 || l.overridden);

      // SSOT summary: the Deal product is DERIVED from the selected tickets. One
      // product selected → that product; multiple → the first selected (display
      // order); none selected → leave the Deal product unchanged (send nothing).
      const productPatch = {};
      const firstSelectedCard = cards.find((c) =>
        c.rows.some((row) => (byRow[rowIdFor(c.cardGroupId, row.ticketTypeId)]?.quantity || 0) > 0),
      );
      if (firstSelectedCard?.productId) {
        productPatch.productId = firstSelectedCard.productId;
        productPatch.productVariantId = firstSelectedCard.productVariantId || null;
      }

      await api.deals.savePriceLines(deal.id, {
        lines: toSave,
        valueMinor: totals ? totals.grossMinor : 0,
        ...productPatch,
      });
      await onSaved?.();
      onClose?.();
    } catch (e) {
      setSaveError(e.payload?.error || e.message || 'שמירה נכשלה');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="כרטיסים לסיור קבוצתי"
      size="xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-2 hover:bg-gray-50">
            ביטול
          </button>
          <button onClick={save} disabled={saving || loading} className="bg-emerald-600 text-white text-sm font-semibold rounded-md px-6 py-2 hover:bg-emerald-700 disabled:opacity-50">
            {saving ? 'שומר…' : 'שמור וסגור'}
          </button>
        </>
      }
    >
      <InlineEditScope>
        <div className="space-y-6 px-1 py-1 min-h-[55vh] flex flex-col">
          {saveError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
              שמירה נכשלה: {saveError}
            </div>
          )}

          {/* Explicit config warning — flagged cards WITHOUT ticket-type pricing.
              We never invent rows for them; the admin must add ticket pricing. */}
          {!loading && unconfigured.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
              כרטיסי התמחור הבאים מסומנים למכירת כרטיסים קבוצתית אך אין להם תמחור לפי סוג כרטיס,
              ולכן אינם מוצגים כאן:
              <span className="font-medium"> {unconfigured.map((c) => c.title).join(' · ')}</span>.
              הגדירו עבורם מודל "סוגי כרטיסים" במסך התמחור.
            </div>
          )}

          {loading ? (
            <div className="text-sm text-gray-400 py-10 text-center">טוען כרטיסים…</div>
          ) : cards.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-[13px] text-amber-800 text-center">
              אין כרטיסי תמחור עם תמחור לפי סוג כרטיס שזמינים למכירת כרטיסים קבוצתית.
              <div className="text-[12px] text-amber-700 mt-1">
                סמנו כרטיס תמחור (מסוג "סוגי כרטיסים") כ"זמין למכירת כרטיסים קבוצתית" במסך התמחור.
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {cards.map((card) => (
                <CardSection
                  key={card.cardGroupId}
                  card={card}
                  byRow={byRow}
                  onQty={setQty}
                  onPrice={setPrice}
                  onRevert={revertPrice}
                />
              ))}
            </div>
          )}

          <div className="flex-1" />

          {/* Totals — same engine, same shape as the Price Builder. */}
          <div className="flex justify-end pt-4 border-t border-gray-100">
            <div className="min-w-[18rem] space-y-2 text-[15px] pt-2">
              <TotalRow label="סכום ביניים" minor={totals?.netMinor} />
              <TotalRow label={`מע״מ${vatDefault?.rate ? ` (${vatDefault.rate}%)` : ''}`} minor={totals?.vatMinor} />
              <div className="border-t border-gray-100 pt-2">
                <TotalRow label='סה"כ' minor={totals?.grossMinor} strong />
              </div>
            </div>
          </div>
        </div>
      </InlineEditScope>
    </Dialog>
  );
}

function CardSection({ card, byRow, onQty, onPrice, onRevert }) {
  // No overflow-hidden on the card: the inline-edit mini-toolbar floats just below a
  // row and must not be clipped at the card edge. The header rounds its own corners.
  return (
    <div className="rounded-xl border border-gray-200">
      <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 rounded-t-xl">
        <span className="text-[15px] font-semibold text-gray-900">{card.title}</span>
      </div>
      <div className="px-4 pt-2 pb-1">
        <div className="flex items-center gap-3 pb-1.5 text-[11px] font-medium text-gray-400">
          <span className="flex-1 min-w-[8rem]">סוג כרטיס</span>
          <span className="w-36 shrink-0 text-center">מחיר</span>
          <span className="w-32 shrink-0 text-center">כמות</span>
          <span className="w-36 shrink-0 text-left">סה״כ שורה</span>
        </div>
        <div className="divide-y divide-gray-100">
          {card.rows.map((row) => {
            const id = rowIdFor(card.cardGroupId, row.ticketTypeId);
            const st = byRow[id] || { quantity: 0, unitPriceMinor: row.unitPriceMinor, overridden: false };
            const lineTotal = (Number(st.unitPriceMinor) || 0) * (st.quantity || 0);
            return (
              <div key={id} className="flex items-center gap-3 py-2.5">
                <span className="flex-1 min-w-[8rem] text-sm text-gray-800">{row.label}</span>

                {/* Price — platform inline pattern: Read → Click → Edit → Save → Read. */}
                <div className="w-36 shrink-0 flex items-center justify-center gap-1">
                  <div className="w-28">
                    <InlineField
                      id={`gt-price-${id}`}
                      type="text"
                      dir="ltr"
                      value={minorToInput(st.unitPriceMinor)}
                      display={(v) => `₪${v || 0}`}
                      onSave={(v) => { onPrice(id, toMinor(v) ?? 0); return Promise.resolve(); }}
                    />
                  </div>
                  {st.overridden && (
                    <button
                      type="button"
                      onClick={() => onRevert(id, row.unitPriceMinor)}
                      title="חזרה למחיר מהכרטיס"
                      className="shrink-0 text-[12px] text-gray-400 hover:text-gray-700"
                    >
                      ↺
                    </button>
                  )}
                </div>

                {/* Quantity — steppers on the sides + manual typing in the middle.
                    − / + step by 1; onQty clamps at 0 (never negative). The local
                    row total and the engine totals both follow immediately. */}
                {/* RTL: + sits on the right (leading), − on the left. */}
                <div className="w-32 shrink-0 flex items-center justify-center gap-1">
                  <button
                    type="button"
                    onClick={() => onQty(id, String((st.quantity || 0) + 1))}
                    title="הוסף כמות"
                    aria-label="הוסף כמות"
                    className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-md border border-gray-200 text-gray-600 leading-none hover:bg-gray-50"
                  >
                    +
                  </button>
                  <input
                    value={st.quantity || ''}
                    onChange={(e) => onQty(id, e.target.value)}
                    inputMode="numeric"
                    dir="ltr"
                    placeholder="0"
                    title="כמות"
                    className="w-12 h-9 text-center rounded-md border border-gray-200 px-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                  <button
                    type="button"
                    onClick={() => onQty(id, String(Math.max(0, (st.quantity || 0) - 1)))}
                    disabled={(st.quantity || 0) <= 0}
                    title="הפחת כמות"
                    aria-label="הפחת כמות"
                    className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-md border border-gray-200 text-gray-600 leading-none hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    −
                  </button>
                </div>

                {/* Row total — local price × qty (matches the Price Builder row display). */}
                <div className="w-36 shrink-0 text-[13px] text-gray-700 text-left tabular-nums" dir="ltr">
                  {formatMinor(lineTotal)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TotalRow({ label, minor, strong }) {
  return (
    <div className="flex items-center justify-between gap-8">
      <span className={strong ? 'font-semibold text-gray-900' : 'text-gray-500'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'text-[20px] font-bold text-blue-700' : 'text-gray-700'}`} dir="ltr">
        {minor == null ? '—' : formatMinor(minor)}
      </span>
    </div>
  );
}
