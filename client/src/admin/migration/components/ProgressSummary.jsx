import { num } from './format.js';

// Progress across the review queues + the migration gate: whether the queues
// that BLOCK the import are complete. This only REPORTS readiness — there is
// deliberately no "finalize import" action.
export default function ProgressSummary({ summary }) {
  if (!summary) return null;
  const { totals, gate } = summary;
  const pct = totals.decisions ? Math.round((totals.resolved / totals.decisions) * 100) : 0;
  const ready = gate.readyToFinalize;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-sm font-semibold text-gray-900">התקדמות הבדיקה</div>
        <span className="text-[12px] text-gray-500 tabular-nums">
          {num(totals.resolved)} מתוך {num(totals.decisions)} הוכרעו
        </span>
      </div>

      <div className="h-2 rounded-full bg-gray-100 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full ${ready ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span aria-hidden="true">{ready ? '✅' : '⏳'}</span>
          <span className="text-[13px] font-medium text-gray-900">
            {ready ? 'כל התורים החוסמים הושלמו' : `${num(gate.blockingComplete)} מתוך ${num(gate.blockingTotal)} תורים חוסמים הושלמו`}
          </span>
        </div>
        {!ready && gate.waitingOn?.length > 0 && (
          <ul className="text-[12px] text-gray-600 space-y-0.5">
            {gate.waitingOn.map((w) => (
              <li key={w.key}>
                • {w.label} — <span className="text-gray-500">{w.reason}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-gray-400 mt-2">
          תורים חוסמים חייבים להסתיים לפני שאפשר יהיה לסיים את הייבוא. תורים לא חוסמים אינם מעכבים.
        </p>
      </div>
    </div>
  );
}
