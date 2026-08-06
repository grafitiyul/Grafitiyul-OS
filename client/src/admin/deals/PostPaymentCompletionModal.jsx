import { useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import { api } from '../../lib/api.js';
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS } from './config.js';

// "התשלום התקבל. יש להשלים את פרטי הסיור."
//
// A payment can close a deal with nobody looking at it — an iCount IPN, a
// Cardcom callback, a worker. When that happens on a deal whose activity type
// was never chosen, the system resolves one so the sale is not blocked and the
// tour still gets created (deals/resolveActivityType.js). What it must never do
// is let that stand as though a person decided it.
//
// So this modal is the moment the assumption is handed back. It is deliberately
// prominent rather than a quiet banner: the money already moved, and the
// classification drives the tour's kind, its pricing context and who the
// customer is treated as. Confirming takes one click; correcting takes two.
//
// It never offers to undo the payment or reopen the deal — the money is real,
// and this is the follow-up, not a reconsideration.

const REASON_HE = {
  group_slot_selected: 'הדיל שויך לסיור קבוצתי קיים',
  organization_linked: 'הדיל משויך לארגון, ולכן סווג כפעילות עסקית',
  default_private: 'לא נבחר סוג פעילות, ולכן סווג כפעילות פרטית',
};

export default function PostPaymentCompletionModal({ deal, open, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState(null); // null = confirm as-is
  const [error, setError] = useState(null);

  if (!deal) return null;
  const assumedType = deal.activityType || null;
  const recovery = deal.wonRecovery || null;
  const stillMissing = recovery?.state === 'plan_tour' ? recovery.missing || [] : [];
  const needsSlot = recovery?.state === 'plan_tour' && recovery.needsSlot;
  // The reason is not stored on the DTO — derive the same way the server did, so
  // the wording matches what actually happened without a second source of truth.
  const reason = deal.organizationId
    ? 'organization_linked'
    : assumedType === 'group'
      ? 'group_slot_selected'
      : 'default_private';

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.deals.confirmClassification(deal.id, chosen ? { activityType: chosen } : {});
      onDone?.();
      onClose?.();
    } catch (e) {
      setError(
        e.payload?.error === 'organization_forces_business'
          ? 'הדיל משויך לארגון — סיווג עסקי הוא הכלל הקבוע ולא ניתן לשנותו כאן. הסירו את שיוך הארגון כדי לסווג אחרת.'
          : 'השמירה נכשלה — נסו שוב.',
      );
    } finally {
      setBusy(false);
    }
  }

  const btn = (label, onClick, { primary = false, disabled = false } = {}) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ' +
        (primary
          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
          : 'border border-gray-300 text-gray-700 hover:bg-gray-50')
      }
    >
      {label}
    </button>
  );

  return (
    <Dialog
      open={open}
      onClose={busy ? null : onClose}
      title="התשלום התקבל — יש להשלים את פרטי הסיור"
      size="lg"
      footer={
        <>
          {btn('אחר כך', onClose, { disabled: busy })}
          {btn(busy ? 'שומר…' : chosen && chosen !== assumedType ? 'שמור שינוי' : 'אישור', submit, {
            primary: true,
            disabled: busy,
          })}
        </>
      }
    >
      <div className="space-y-5 py-1">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
          <p className="text-[13.5px] leading-relaxed text-emerald-900">
            💳 התשלום התקבל והעסקה נסגרה. כדי לא לעכב את הסגירה המערכת השלימה בעצמה
            את מה שהיה חסר — זה המקום לאשר או לתקן.
          </p>
        </div>

        <div>
          <p className="mb-2 text-[12px] font-medium text-gray-600">מה המערכת הניחה</p>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="mb-3 text-[13px] text-gray-700">{REASON_HE[reason]}</p>
            <div className="flex flex-wrap gap-2">
              {ACTIVITY_TYPES.map((key) => {
                const active = (chosen || assumedType) === key;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={busy}
                    onClick={() => setChosen(key)}
                    className={
                      'rounded-lg border px-4 py-2 text-sm font-medium transition ' +
                      (active
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
                        : 'border-gray-200 text-gray-700 hover:bg-gray-50')
                    }
                  >
                    {ACTIVITY_TYPE_LABELS[key]}
                    {key === assumedType && !chosen && (
                      <span className="mr-1.5 text-[11px] text-emerald-600">· הונח</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {(stillMissing.length > 0 || needsSlot) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
            <p className="mb-1 text-[13px] font-semibold text-amber-900">עדיין חסר כדי שייווצר סיור</p>
            {stillMissing.length > 0 && (
              <p className="text-[13px] text-amber-900">{stillMissing.map((m) => m.labelHe).join(', ')}</p>
            )}
            {needsSlot && (
              <p className="text-[13px] text-amber-900">נדרש שיבוץ לסיור קבוצתי — המערכת לא תנחש סיור.</p>
            )}
            <p className="mt-2 text-[12px] text-amber-800">
              השלימו מכרטיס "פרטי הסיור" בדיל, ואז השתמשו ב"השלם פרטי סיור וצור סיור".
            </p>
          </div>
        )}

        {error && <p className="text-[13px] text-red-600">{error}</p>}

        <p className="text-[12px] leading-relaxed text-gray-500">
          התשלום נשאר כפי שהוא והעסקה נשארת סגורה — אישור כאן רק מאשר את הסיווג.
        </p>
      </div>
    </Dialog>
  );
}
