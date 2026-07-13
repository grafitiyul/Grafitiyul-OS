import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { InlineEditScope } from '../common/inline/InlineEditScope.jsx';
import InlineField from '../common/inline/InlineField.jsx';
import { api } from '../../lib/api.js';
import { formatMinor, minorToInput, toMinor } from '../../lib/money.js';

// Group Ticket Builder BODY (no Dialog shell) — a dedicated ticket-sales
// workspace for Group deals, reused in three places with ONE implementation:
//   • GroupTicketBuilderDialog  (standalone editor, DealDetail + Quote canvas)
//   • GroupRegistrationModal     (INLINE inside the progressive modal, PART 4)
// It is NOT the Business Price Builder: each Pricing Card the owner opted into
// Group Ticket Sales becomes one section with one row per priced ticket type. It
// REUSES the platform calc engine (/api/pricing/builder) and canonical storage
// (QuoteVersion / QuoteLine via /api/deals/:id/price-lines). Row identity is
// STRUCTURED (sourceKind='group_ticket' + sourceCardGroupId + ticketTypeId) so
// reopening re-hydrates the exact card/ticket-type; the user `note` is untouched.
//
// The parent drives saving through a ref: `ref.current.save()` persists and
// returns { ok, participants, valueMinor, productId, productVariantId } (or
// throws). `hasSelection()` reports whether any ticket qty > 0. `compact` tightens
// spacing for the narrow modal.

const SOURCE_KIND = 'group_ticket';

function rowIdFor(cardGroupId, ticketTypeId) {
  return `${cardGroupId}::${ticketTypeId}`;
}
function savedKeyOf(line) {
  if (line?.sourceKind !== SOURCE_KIND) return null;
  if (!line.sourceCardGroupId || !line.ticketTypeId) return null;
  return rowIdFor(line.sourceCardGroupId, line.ticketTypeId);
}

const GroupTicketBuilder = forwardRef(function GroupTicketBuilder(
  { deal, context = {}, compact = false, onSavedData, onSelectionChange },
  ref,
) {
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState([]);
  const [unconfigured, setUnconfigured] = useState([]);
  const [byRow, setByRow] = useState({});
  const [computed, setComputed] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const calcTimer = useRef(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setSaveError(null);
    Promise.all([
      api.pricing.groupCards().catch(() => ({ cards: [], unconfigured: [] })),
      api.deals.getPriceLines(deal.id).then((r) => r?.lines || []).catch(() => []),
    ]).then(([cardData, savedLines]) => {
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
  }, [deal?.id]);

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
          // The card's operational variant — persisted on the QuoteLine so the
          // tour's operational product derives from the real ticket (plain vs
          // workshop). Without it the offering resolves to a null variant.
          productVariantId: card.productVariantId || null,
        });
      }
    }
    return out;
  }, [cards, byRow]);

  const hasSelection = useMemo(() => lines.some((l) => (Number(l.quantity) || 0) > 0), [lines]);
  useEffect(() => {
    onSelectionChange?.(hasSelection);
  }, [hasSelection, onSelectionChange]);

  useEffect(() => {
    if (!lines.length) {
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
  }, [lines, context]);

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

  // opts.waiverDecision ('expand' | 'charge_added' | 'cancel') is sent only when
  // the operator has resolved a waiver-decision prompt (the server returns 409
  // waiver_decision_required when a waived deal's builder is INCREASED). On that
  // 409 we throw a structured error so the caller can open the decision dialog and
  // re-save with the chosen decision — never silently waive or charge.
  async function save(opts = {}) {
    setSaveError(null);
    try {
      const toSave = lines.filter((l) => l.quantity > 0 || l.overridden);
      const productPatch = {};
      const firstSelectedCard = cards.find((c) =>
        c.rows.some((row) => (byRow[rowIdFor(c.cardGroupId, row.ticketTypeId)]?.quantity || 0) > 0),
      );
      if (firstSelectedCard?.productId) {
        productPatch.productId = firstSelectedCard.productId;
        productPatch.productVariantId = firstSelectedCard.productVariantId || null;
      }
      const participants = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
      const valueMinor = totals ? totals.grossMinor : 0;
      const payload = { lines: toSave, valueMinor, participants, ...productPatch };
      if (opts.waiverDecision) payload.waiverDecision = opts.waiverDecision;
      await api.deals.savePriceLines(deal.id, payload);
      const summary = { ok: true, participants, valueMinor, ...productPatch };
      await onSavedData?.(summary);
      return summary;
    } catch (e) {
      // A waiver decision is required — surface it to the caller WITHOUT flagging
      // an error banner; the caller opens the system decision dialog.
      if (e.payload?.error === 'waiver_decision_required') {
        const err = new Error('waiver_decision_required');
        err.code = 'waiver_decision_required';
        err.added = e.payload.added || [];
        throw err;
      }
      setSaveError(e.payload?.error || e.message || 'שמירה נכשלה');
      throw e;
    }
  }

  useImperativeHandle(ref, () => ({ save, hasSelection: () => hasSelection }), [save, hasSelection]);

  return (
    <InlineEditScope>
      <div className={compact ? 'flex flex-col gap-4' : 'space-y-6 px-1 py-1 min-h-[55vh] flex flex-col'}>
        {saveError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">שמירה נכשלה: {saveError}</div>
        )}

        {!loading && unconfigured.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
            כרטיסי התמחור הבאים מסומנים למכירת כרטיסים קבוצתית אך אין להם תמחור לפי סוג כרטיס, ולכן אינם מוצגים כאן:
            <span className="font-medium"> {unconfigured.map((c) => c.title).join(' · ')}</span>. הגדירו עבורם מודל "סוגי כרטיסים" במסך התמחור.
          </div>
        )}

        {loading ? (
          <div className="text-sm text-gray-400 py-10 text-center">טוען כרטיסים…</div>
        ) : cards.length === 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-[13px] text-amber-800 text-center">
            אין כרטיסי תמחור עם תמחור לפי סוג כרטיס שזמינים למכירת כרטיסים קבוצתית.
            <div className="text-[12px] text-amber-700 mt-1">סמנו כרטיס תמחור (מסוג "סוגי כרטיסים") כ"זמין למכירת כרטיסים קבוצתית" במסך התמחור.</div>
          </div>
        ) : (
          <div className={compact ? 'space-y-3' : 'space-y-5'}>
            {cards.map((card) => (
              <CardSection key={card.cardGroupId} card={card} byRow={byRow} onQty={setQty} onPrice={setPrice} onRevert={revertPrice} compact={compact} />
            ))}
          </div>
        )}

        {!compact && <div className="flex-1" />}

        <div className={'flex justify-end ' + (compact ? 'pt-3 border-t border-gray-100' : 'pt-4 border-t border-gray-100')}>
          <div className="min-w-[16rem] space-y-2 text-[15px] pt-1">
            <TotalRow label="סכום ביניים" minor={totals?.netMinor} />
            <TotalRow label={`מע״מ${vatDefault?.rate ? ` (${vatDefault.rate}%)` : ''}`} minor={totals?.vatMinor} />
            <div className="border-t border-gray-100 pt-2">
              <TotalRow label='סה"כ' minor={totals?.grossMinor} strong />
            </div>
          </div>
        </div>
      </div>
    </InlineEditScope>
  );
});

export default GroupTicketBuilder;

function CardSection({ card, byRow, onQty, onPrice, onRevert, compact }) {
  return (
    <div className="rounded-xl border border-gray-200">
      <div className={'bg-gray-50 border-b border-gray-200 rounded-t-xl ' + (compact ? 'px-3 py-2' : 'px-4 py-2.5')}>
        <span className={compact ? 'text-[13.5px] font-semibold text-gray-900' : 'text-[15px] font-semibold text-gray-900'}>{card.title}</span>
      </div>
      <div className={compact ? 'px-3 pt-1.5 pb-1' : 'px-4 pt-2 pb-1'}>
        <div className="flex items-center gap-2 pb-1.5 text-[11px] font-medium text-gray-400">
          <span className="min-w-0 flex-1">סוג כרטיס</span>
          <span className="w-24 shrink-0 text-center">מחיר</span>
          <span className="w-28 shrink-0 text-center">כמות</span>
          <span className="w-20 shrink-0 text-left">סה״כ שורה</span>
        </div>
        <div className="divide-y divide-gray-100">
          {card.rows.map((row) => {
            const id = rowIdFor(card.cardGroupId, row.ticketTypeId);
            const st = byRow[id] || { quantity: 0, unitPriceMinor: row.unitPriceMinor, overridden: false };
            const lineTotal = (Number(st.unitPriceMinor) || 0) * (st.quantity || 0);
            return (
              <div key={id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{row.label}</span>
                <div className="w-24 shrink-0 flex items-center justify-center gap-1">
                  <div className="w-20">
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
                    <button type="button" onClick={() => onRevert(id, row.unitPriceMinor)} title="חזרה למחיר מהכרטיס" className="shrink-0 text-[12px] text-gray-400 hover:text-gray-700">
                      ↺
                    </button>
                  )}
                </div>
                <div className="w-28 shrink-0 flex items-center justify-center gap-1">
                  <button type="button" onClick={() => onQty(id, String((st.quantity || 0) + 1))} title="הוסף כמות" aria-label="הוסף כמות" className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-md border border-gray-200 text-gray-600 leading-none hover:bg-gray-50">
                    +
                  </button>
                  <input
                    value={st.quantity || ''}
                    onChange={(e) => onQty(id, e.target.value)}
                    inputMode="numeric"
                    dir="ltr"
                    placeholder="0"
                    title="כמות"
                    className="w-11 h-9 text-center rounded-md border border-gray-200 px-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                  <button type="button" onClick={() => onQty(id, String(Math.max(0, (st.quantity || 0) - 1)))} disabled={(st.quantity || 0) <= 0} title="הפחת כמות" aria-label="הפחת כמות" className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-md border border-gray-200 text-gray-600 leading-none hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                    −
                  </button>
                </div>
                <div className="w-20 shrink-0 text-[13px] text-gray-700 text-left tabular-nums" dir="ltr">{formatMinor(lineTotal)}</div>
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
