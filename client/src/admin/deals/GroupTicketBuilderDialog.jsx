import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import { InlineEditScope } from '../common/inline/InlineEditScope.jsx';
import InlineField from '../common/inline/InlineField.jsx';
import { api } from '../../lib/api.js';
import { formatMinor, minorToInput, toMinor } from '../../lib/money.js';

// Group Ticket Builder — a dedicated ticket-sales workspace for Group deals. It is
// NOT the Business Price Builder: instead of free rows, each Pricing Card the owner
// opted into Group Ticket Sales (the flag is the SOLE authority) becomes one
// section, with one row per ticket type. No product/city/activity filtering — the
// card list is whatever the server returns from /api/pricing/group-cards.
//
// It REUSES the platform: the same Dialog shell + totals area, the same calculation
// engine (/api/pricing/builder) and the same canonical storage (QuoteVersion /
// QuoteLine via /api/deals/:id/price-lines). Each ticket row is one manual
// QuoteLine; its stable identity lives in the line's `note` (gt:<cardGroupId>:<rowKey>)
// so saved quantities/overrides re-hydrate on reopen. Payment Terms / Payment Method
// are intentionally absent — they belong to the Deal's financial area, not here.

// Stable per-row identity persisted in QuoteLine.note. cardGroupId is a cuid (no
// colon); rowKey may contain colons (e.g. "tt:<id>"), so parse only the prefix.
function noteKeyFor(cardGroupId, rowKey) {
  return `gt:${cardGroupId}:${rowKey}`;
}
function parseNoteKey(note) {
  const m = /^gt:([^:]+):(.+)$/.exec(note || '');
  return m ? { cardGroupId: m[1], rowKey: m[2] } : null;
}
function rowIdFor(cardGroupId, rowKey) {
  return `${cardGroupId}::${rowKey}`;
}

export default function GroupTicketBuilderDialog({ open, deal, context, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState([]);
  // rowId → { quantity, unitPriceMinor, overridden }. cardPrice stays on the card
  // (source of truth) so a non-overridden row always reflects the latest card price.
  const [byRow, setByRow] = useState({});
  const [computed, setComputed] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const calcTimer = useRef(null);

  // Load the enabled cards + the deal's existing lines, then merge them. Saved
  // quantities/overrides win for rows that still exist; new cards default to qty 0.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setSaveError(null);
    Promise.all([
      api.pricing.groupCards().catch(() => []),
      api.deals.getPriceLines(deal.id).then((r) => r?.lines || []).catch(() => []),
    ])
      .then(([cardList, savedLines]) => {
        if (!live) return;
        const savedByKey = new Map();
        for (const ln of savedLines) {
          const parsed = parseNoteKey(ln.note);
          if (parsed) savedByKey.set(noteKeyFor(parsed.cardGroupId, parsed.rowKey), ln);
        }
        const next = {};
        for (const card of cardList) {
          for (const row of card.rows) {
            const id = rowIdFor(card.cardGroupId, row.key);
            const saved = savedByKey.get(noteKeyFor(card.cardGroupId, row.key));
            next[id] = {
              quantity: saved ? Number(saved.quantity) || 0 : 0,
              unitPriceMinor: saved?.overridden ? Number(saved.unitPriceMinor) || 0 : row.unitPriceMinor,
              overridden: !!saved?.overridden,
            };
          }
        }
        setCards(cardList);
        setByRow(next);
        setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deal?.id]);

  // Flatten cards + per-row state into builder lines (engine input + save payload).
  const lines = useMemo(() => {
    const out = [];
    for (const card of cards) {
      for (const row of card.rows) {
        const id = rowIdFor(card.cardGroupId, row.key);
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
          note: noteKeyFor(card.cardGroupId, row.key),
          overridden: st.overridden,
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
      await api.deals.savePriceLines(deal.id, {
        lines: toSave,
        valueMinor: totals ? totals.grossMinor : 0,
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
      title="בונה כרטיסים קבוצתי"
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

          {loading ? (
            <div className="text-sm text-gray-400 py-10 text-center">טוען כרטיסים…</div>
          ) : cards.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-[13px] text-amber-800 text-center">
              אין כרטיסי תמחור שזמינים למכירת כרטיסים קבוצתית.
              <div className="text-[12px] text-amber-700 mt-1">
                סמנו כרטיס תמחור כ"זמין למכירת כרטיסים קבוצתית" במסך התמחור כדי שיופיע כאן.
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
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
        <span className="text-[15px] font-semibold text-gray-900">{card.title}</span>
      </div>
      <div className="px-4 pt-2 pb-1">
        <div className="flex items-center gap-3 pb-1.5 text-[11px] font-medium text-gray-400">
          <span className="flex-1 min-w-[8rem]">סוג כרטיס</span>
          <span className="w-36 shrink-0 text-center">מחיר</span>
          <span className="w-20 shrink-0 text-center">כמות</span>
          <span className="w-36 shrink-0 text-left">סה״כ שורה</span>
        </div>
        <div className="divide-y divide-gray-100">
          {card.rows.map((row) => {
            const id = rowIdFor(card.cardGroupId, row.key);
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

                {/* Quantity — direct entry. */}
                <input
                  value={st.quantity || ''}
                  onChange={(e) => onQty(id, e.target.value)}
                  inputMode="numeric"
                  dir="ltr"
                  placeholder="0"
                  title="כמות"
                  className="w-20 shrink-0 h-9 text-center rounded-md border border-gray-200 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                />

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
