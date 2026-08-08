import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import { reconcileAllocations, proposeAllocations } from '../../../../../shared/paymentAllocation.mjs';

// "שייך לדילים נוספים" — divide ONE real payment between several deals.
//
// The whole panel exists to make one thing impossible: hidden arithmetic. The
// payment total, what has been allocated and what is left over are on screen at
// all times, and the running numbers come from the SAME pure function the
// server persists with (shared/paymentAllocation.mjs) — so the figure the
// operator confirms is the figure that is stored.
//
// Nothing here assumes two deals. Two, three, six or twenty behave identically:
// rows are a list, the totals are a reduce, and the confirmation step lists
// whatever is in the list.
//
// Over-allocation is ALLOWED (owner ruling, 2026-08-08). GOS shows it loudly
// and the save is still permitted — an office mid-reconciliation must never be
// blocked — because the discrepancy lives in the allocation layer and can never
// change the real money or the company's income.

const FIELD = 'w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none';

const ils = (minor) =>
  `₪${(Number(minor || 0) / 100).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const toMinor = (text) => {
  const n = Number(String(text ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const toText = (minor) => (Number(minor || 0) / 100).toString();

/**
 * @param payment  { groupId, realMinor, currency, label, docnum, doctype }
 * @param initial  [{ dealId, orderNo, amountMinor, … }] — current split, or the
 *                 single origin deal when nothing is split yet
 * @param onApply  (plan, { reason, confirmCrossCustomer }) => Promise
 */
export default function AllocationPanel({ payment, initial, originDealId, onApply, onCancel, busy }) {
  // Rows carry their own display state; the money is always recomputed.
  const [rows, setRows] = useState(() =>
    (initial || []).map((a) => ({
      dealId: a.dealId,
      orderNo: a.orderNo,
      title: a.dealTitle || a.title || null,
      contactName: a.contactName || null,
      organizationName: a.organizationName || null,
      totalMinor: a.dealTotalMinor ?? a.totalMinor ?? null,
      paidMinor: a.paidMinor ?? null,
      remainingMinor: a.remainingMinor ?? null,
      amountText: toText(a.amountMinor ?? 0),
    })),
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [crossWarning, setCrossWarning] = useState(null);

  const plan = useMemo(
    () => rows.map((r) => ({ dealId: r.dealId, amountMinor: toMinor(r.amountText) })),
    [rows],
  );
  // The SAME reconciliation the server will perform.
  const state = useMemo(() => reconcileAllocations(payment.realMinor, plan), [payment.realMinor, plan]);

  const setAmount = (dealId, text) =>
    setRows((prev) => prev.map((r) => (r.dealId === dealId ? { ...r, amountText: text } : r)));

  const addDeal = (deal) => {
    setRows((prev) => {
      if (prev.some((r) => r.dealId === deal.id)) return prev;
      // Open the new row on what it still owes, capped at what is unallocated —
      // the obvious intent, never an amount that silently over-allocates.
      const left = Math.max(0, payment.realMinor - prev.reduce((s, r) => s + toMinor(r.amountText), 0));
      const want = Math.max(0, Number(deal.remainingMinor ?? deal.totalMinor ?? 0));
      return [...prev, {
        dealId: deal.id,
        orderNo: deal.orderNo,
        title: deal.title,
        contactName: deal.contactName,
        organizationName: deal.organizationName,
        totalMinor: deal.totalMinor,
        paidMinor: deal.paidMinor,
        remainingMinor: deal.remainingMinor,
        amountText: toText(Math.min(want, left)),
      }];
    });
    setCrossWarning(null);
  };

  const removeDeal = (dealId) => setRows((prev) => prev.filter((r) => r.dealId !== dealId));

  const redistribute = () =>
    setRows((prev) => {
      const proposal = proposeAllocations(
        payment.realMinor,
        prev.map((r) => ({ dealId: r.dealId, remainingMinor: r.remainingMinor ?? r.totalMinor ?? 0 })),
      );
      const byId = new Map(proposal.map((p) => [p.dealId, p.amountMinor]));
      return prev.map((r) => ({ ...r, amountText: toText(byId.get(r.dealId) ?? 0) }));
    });

  // The remainder decision (rule 5): GOS never invents a customer credit. The
  // operator either puts the money on one of the deals in front of them, or
  // says explicitly that it stays unallocated.
  const assignRemainderTo = (dealId) =>
    setRows((prev) => prev.map((r) => (
      r.dealId === dealId ? { ...r, amountText: toText(toMinor(r.amountText) + state.unallocatedMinor) } : r
    )));

  async function submit({ confirmCrossCustomer = false } = {}) {
    setError(null);
    try {
      // The display rows travel with the plan so a caller that has not persisted
      // anything yet (the pre-issuance step) can still label what was chosen —
      // including deals added from the picker, which it never saw.
      await onApply(plan, { reason: reason.trim() || null, confirmCrossCustomer }, rows);
    } catch (err) {
      if (err?.body?.error === 'cross_customer_confirmation_required') {
        setCrossWarning(err.body.crossCustomer || { cross: true });
        return;
      }
      setError(errorText(err));
    }
  }

  const canSubmit = rows.length > 0 && !busy;

  return (
    <div className="space-y-4" dir="rtl">
      <PaymentHeader payment={payment} state={state} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-right text-xs text-gray-500">
              <th className="py-2 font-medium">דיל</th>
              <th className="py-2 font-medium">לקוח / ארגון</th>
              <th className="py-2 font-medium">סכום הדיל</th>
              <th className="py-2 font-medium">שולם</th>
              <th className="py-2 font-medium">נותר לתשלום</th>
              <th className="py-2 font-medium">שיוך</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.dealId} className="border-b border-gray-100 last:border-0">
                <td className="py-2 font-medium text-gray-900">
                  #{r.orderNo}
                  {r.dealId === originDealId && (
                    <span className="mr-2 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">הדיל הנוכחי</span>
                  )}
                </td>
                <td className="py-2 text-gray-700">
                  <div>{r.contactName || r.title || '—'}</div>
                  {r.organizationName && <div className="text-xs text-gray-500">{r.organizationName}</div>}
                </td>
                <td className="py-2 text-gray-700">{r.totalMinor == null ? '—' : ils(r.totalMinor)}</td>
                <td className="py-2 text-gray-700">{r.paidMinor == null ? '—' : ils(r.paidMinor)}</td>
                <td className="py-2 text-gray-700">{r.remainingMinor == null ? '—' : ils(r.remainingMinor)}</td>
                <td className="py-2">
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400">₪</span>
                    <input
                      className={`${FIELD} w-28`}
                      inputMode="decimal"
                      value={r.amountText}
                      onChange={(e) => setAmount(r.dealId, e.target.value)}
                      aria-label={`שיוך לדיל ${r.orderNo}`}
                    />
                  </div>
                </td>
                <td className="py-2 text-left">
                  {r.dealId !== originDealId && (
                    <button
                      type="button"
                      className="text-xs text-gray-400 hover:text-red-600"
                      onClick={() => removeDeal(r.dealId)}
                    >
                      הסר
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="py-6 text-center text-sm text-gray-500">לא נבחרו דילים.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <DealPicker
        excludeIds={rows.map((r) => r.dealId)}
        onPick={addDeal}
      />

      <Totals state={state} payment={payment} rows={rows} onAssignRemainder={assignRemainderTo} onRedistribute={redistribute} />

      {crossWarning && <CrossCustomerWarning info={crossWarning} onConfirm={() => submit({ confirmCrossCustomer: true })} busy={busy} />}

      <div>
        <label className="mb-1 block text-xs text-gray-500">הערה / סיבה (נשמרת בהיסטוריית השיוך)</label>
        <input className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למשל: תיקון שיוך לפי בקשת הלקוח" />
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
        <button type="button" className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50" onClick={onCancel} disabled={busy}>
          ביטול
        </button>
        <button
          type="button"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          onClick={() => submit()}
          disabled={!canSubmit}
        >
          {busy ? 'שומר…' : 'שמור שיוך'}
        </button>
      </div>
    </div>
  );
}

function PaymentHeader({ payment, state }) {
  return (
    <div className="rounded-xl bg-gray-50 px-4 py-3">
      <div className="text-xs text-gray-500">{payment.label || 'תשלום'}</div>
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-semibold text-gray-900">{ils(state.realMinor)}</div>
        <div className="text-sm text-gray-500">סכום התשלום בפועל</div>
      </div>
      {payment.docnum && <div className="mt-1 text-xs text-gray-500">מסמך מס׳ {payment.docnum}</div>}
    </div>
  );
}

// The arithmetic, never hidden. Three numbers, always visible, always agreeing
// with what the server will store.
function Totals({ state, payment, rows, onAssignRemainder, onRedistribute }) {
  const over = state.state === 'over';
  const under = state.state === 'unallocated';
  return (
    <div className="rounded-xl border border-gray-200">
      <div className="grid grid-cols-3 divide-x divide-x-reverse divide-gray-100 text-center">
        <Figure label="סכום התשלום" value={ils(state.realMinor)} />
        <Figure label="שויך" value={ils(state.allocatedMinor)} />
        <Figure
          label={over ? 'שויך ביתר' : 'לא שויך'}
          value={ils(over ? state.overAllocatedMinor : state.unallocatedMinor)}
          tone={over ? 'danger' : under ? 'warn' : 'ok'}
        />
      </div>

      {over && (
        <div className="border-t border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
          <div className="font-medium">שויכו {ils(state.overAllocatedMinor)} יותר מהתשלום שהתקבל.</div>
          <div className="mt-1 text-red-700">
            אפשר לשמור — אבל הכסף שהתקבל בפועל נשאר {ils(state.realMinor)}. ההפרש יסומן כאי-התאמה
            לטיפול, ולא ייחשב כהכנסה.
          </div>
        </div>
      )}

      {under && (
        <div className="border-t border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-medium">נותרו {ils(state.unallocatedMinor)} שלא שויכו.</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {rows.map((r) => (
              <button
                key={r.dealId}
                type="button"
                className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs text-amber-900 hover:bg-amber-100"
                onClick={() => onAssignRemainder(r.dealId)}
              >
                הוסף לדיל #{r.orderNo}
              </button>
            ))}
            <button
              type="button"
              className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs text-amber-900 hover:bg-amber-100"
              onClick={onRedistribute}
            >
              חלק מחדש לפי היתרות
            </button>
          </div>
          <div className="mt-2 text-xs text-amber-800">
            אפשר גם לשמור כך — הסכום יישאר לא משויך ותיפתח משימה לטיפול. יתרת זכות ללקוח לא נוצרת אוטומטית.
          </div>
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, tone = 'ok' }) {
  const color = tone === 'danger' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-900';
  return (
    <div className="px-3 py-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function CrossCustomerWarning({ info, onConfirm, busy }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="font-medium">הדילים שנבחרו שייכים ללקוחות שונים.</div>
      <div className="mt-1">
        זה יכול להיות תקין — למשל חברה שמשלמת עבור כמה אנשים — אבל זה לא אמור לקרות בטעות.
        בדקו את הרשימה ואשרו במפורש.
      </div>
      <button
        type="button"
        className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        onClick={onConfirm}
        disabled={busy}
      >
        אני מאשר/ת — שייך בכל זאת
      </button>
    </div>
  );
}

// The CANONICAL deal search (global-search provider), enriched server-side with
// each deal's real financial position. Deliberately not a second deal search.
function DealPicker({ excludeIds, onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  const run = useCallback(async (query) => {
    const seq = ++reqRef.current;
    if (query.trim().length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await api.payments.searchDeals(query.trim(), excludeIds);
      if (seq === reqRef.current) setResults(res.results || []);
    } catch {
      if (seq === reqRef.current) setResults([]);
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  }, [excludeIds]);

  useEffect(() => {
    const t = setTimeout(() => run(q), 250);
    return () => clearTimeout(t);
  }, [q, run]);

  return (
    <div>
      <label className="mb-1 block text-xs text-gray-500">הוסף דיל — חיפוש לפי מספר, שם, טלפון, אימייל, ארגון</label>
      <input className={FIELD} value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש דיל…" />
      {loading && <div className="mt-2 text-xs text-gray-400">מחפש…</div>}
      {!loading && q.trim().length >= 2 && results.length === 0 && (
        <div className="mt-2 text-xs text-gray-400">לא נמצאו דילים.</div>
      )}
      {results.length > 0 && (
        <ul className="mt-2 max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
          {results.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-right hover:bg-gray-50"
                onClick={() => { onPick(d); setQ(''); setResults([]); }}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900">
                    #{d.orderNo} · {d.contactName || d.title}
                  </span>
                  <span className="block truncate text-xs text-gray-500">
                    {[d.organizationName, d.product, d.tourDate].filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>
                <span className="shrink-0 text-left text-xs text-gray-600">
                  <span className="block">סה״כ {ils(d.totalMinor)}</span>
                  <span className="block text-gray-400">נותר {ils(d.remainingMinor)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function errorText(err) {
  const code = err?.body?.error || err?.message;
  const MAP = {
    allocation_empty: 'צריך לבחור לפחות דיל אחד.',
    allocation_amount_invalid: 'אחד הסכומים אינו תקין.',
    allocation_deal_duplicate: 'אותו דיל נבחר פעמיים.',
    allocation_deal_retired: 'אחד הדילים אוחד לתוך דיל אחר ולכן אי אפשר לשייך אליו תשלום.',
    allocation_origin_required: 'אי אפשר להסיר את הדיל שהמסמך הופק עבורו.',
    allocation_group_not_found: 'התשלום לא נמצא.',
    payment_row_not_found: 'שורת התשלום לא נמצאה.',
  };
  return MAP[code] || 'השמירה נכשלה. נסו שוב.';
}
