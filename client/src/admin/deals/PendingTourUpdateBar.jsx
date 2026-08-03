// Pending Tour Update action bar — shown (full width, above "מידע חשוב על
// הלקוח") while the deal's planning fields differ from its LIVE tour
// (deal.tourUpdatePending — the server-derived diff; nothing is stored).
// RTL: first child renders on the RIGHT → "עדכון סיור" (yellow, the business
// action) right, "ביטול שינויים" (white) left, both exactly 50%.
export default function PendingTourUpdateBar({
  pending = [], busy, onApply, onDiscard,
  sendUpdatedEmail = true, onToggleSendUpdatedEmail,
}) {
  if (!pending.length) return null;
  const labels = [...new Set(pending.map((p) => p.labelHe))];
  const summary =
    labels.length > 4 ? `${labels.length} שינויים ממתינים` : labels.join(' • ');
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3" dir="rtl">
      <div className="flex items-center gap-1.5 text-[13px] font-bold text-amber-900">
        <span aria-hidden>⚠️</span>
        יש שינויים שעדיין לא הוחלו על הסיור
      </div>
      <div className="mt-0.5 text-[12px] text-amber-800">{summary}</div>
      {/* Default ON: a tour whose details moved is exactly when the customer
          needs the updated confirmation. Composed only after the update
          succeeds, so it carries the new values. */}
      <label className="mt-2 flex items-center gap-2 text-[12.5px] text-amber-900">
        <input
          type="checkbox"
          checked={sendUpdatedEmail}
          onChange={(e) => onToggleSendUpdatedEmail?.(e.target.checked)}
          disabled={busy}
          className="rounded border-amber-400"
        />
        שליחת מייל מעודכן ללקוח
      </label>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={onApply}
          disabled={busy}
          className="w-1/2 rounded-lg bg-yellow-400 px-3 py-2 text-sm font-bold text-gray-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          עדכון סיור
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={busy}
          className="w-1/2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          ביטול שינויים
        </button>
      </div>
    </div>
  );
}
