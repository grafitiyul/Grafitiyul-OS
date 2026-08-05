// WON operational-recovery action bar — the SAME amber action-banner shell as
// PendingTourUpdateBar, for the "commercially closed but operationally
// incomplete" states (deal.wonRecovery — server-derived, nothing stored):
//
//   plan_tour             → "הדיל נסגר ללא סיור משובץ": the payment made the
//                           deal WON before a tour existed (production #27074).
//                           Primary action completes the chain — create the
//                           tour (group deals: pick a slot first).
//   confirmation_pending  → the tour exists but the confirmation email has not
//                           gone out; the banner morphs to the remaining action
//                           instead of disappearing.
//
// One banner at a time, one obvious action — the canonical recovery pattern
// for every future "WON but incomplete" state.
export default function WonRecoveryBar({ recovery, busy, onPlanTour, onOpenPreview }) {
  if (!recovery) return null;

  if (recovery.state === 'plan_tour') {
    const missingLabels = [...new Set((recovery.missing || []).map((m) => m.labelHe))];
    const detail = recovery.needsSlot
      ? 'כל הפרטים קיימים — נותר לבחור סיור קבוצתי ולשבץ אליו.'
      : missingLabels.length
        ? `חסרים: ${missingLabels.join(' • ')}`
        : 'כל הפרטים קיימים — נותר ליצור את הסיור.';
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3" dir="rtl">
        <div className="flex items-center gap-1.5 text-[13px] font-bold text-amber-900">
          <span aria-hidden>⚠️</span>
          הדיל נסגר ללא סיור משובץ
        </div>
        <div className="mt-0.5 text-[12px] text-amber-800">{detail}</div>
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={onPlanTour}
            disabled={busy}
            className="w-full rounded-lg bg-yellow-400 px-3 py-2 text-sm font-bold text-gray-900 hover:bg-yellow-500 disabled:opacity-50"
          >
            השלם פרטי סיור וצור סיור
          </button>
        </div>
      </div>
    );
  }

  if (recovery.state === 'confirmation_pending') {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3" dir="rtl">
        <div className="flex items-center gap-1.5 text-[13px] font-bold text-amber-900">
          <span aria-hidden>⚠️</span>
          מייל האישור ללקוח טרם נשלח
        </div>
        {recovery.reasonHe ? (
          <div className="mt-0.5 text-[12px] text-amber-800">{recovery.reasonHe}</div>
        ) : null}
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={onOpenPreview}
            disabled={busy}
            className="w-full rounded-lg bg-yellow-400 px-3 py-2 text-sm font-bold text-gray-900 hover:bg-yellow-500 disabled:opacity-50"
          >
            פתח תצוגה מקדימה ושלח
          </button>
        </div>
      </div>
    );
  }

  return null;
}
