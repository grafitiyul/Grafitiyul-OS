import { Link } from 'react-router-dom';

// The onboarding checklist.
//
// Two rules it follows:
//   • Progress is DERIVED from real state, never from a stored "completed"
//     flag. Delete your last knowledge item and that step reopens, honestly.
//   • It is guidance, not a gate. Nothing here blocks navigation, and the whole
//     card can be dismissed from view by simply going somewhere else.
export default function OnboardingCard({ onboarding, compact = false }) {
  if (!onboarding?.steps) return null;
  const { steps, doneCount, total, next } = onboarding;

  return (
    <section className="mb-4 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="gos-title text-[16px] text-blue-950">הסוכן עדיין בתחילת הדרך</h2>
          <p className="gos-detail mt-0.5 text-blue-900">
            {next
              ? <>הצעד הבא שלך: <strong>{next.titleHe}</strong> — {next.whyHe}</>
              : 'סיימת את כל שלבי ההתחלה.'}
          </p>
        </div>
        <div className="shrink-0 text-end">
          <div className="text-[22px] font-semibold leading-none tabular-nums text-blue-900">
            {doneCount}/{total}
          </div>
          <div className="gos-meta text-blue-800">שלבים</div>
        </div>
      </div>

      {/* Progress bar — a derived ratio, so it can move backwards honestly. */}
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-blue-200">
        <div
          className="h-full rounded-full bg-blue-600 transition-all"
          style={{ width: `${Math.round((doneCount / total) * 100)}%` }}
        />
      </div>

      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-start gap-2">
            <span
              aria-hidden
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                s.done ? 'bg-emerald-500 text-white' : 'bg-white text-blue-700 ring-1 ring-blue-300'
              }`}
            >
              {s.done ? '✓' : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`gos-detail ${s.done ? 'text-gray-600' : 'font-medium text-blue-950'}`}>
                {s.titleHe}
              </span>
              <span className="gos-meta block text-blue-800">{s.statusHe}</span>
            </span>
            {!s.done && (
              <Link
                to={s.to}
                className="shrink-0 rounded-lg border border-blue-300 bg-white px-2.5 py-1 text-[12px] font-medium text-blue-800 transition hover:bg-blue-50"
              >
                {s.ctaHe}
              </Link>
            )}
          </li>
        ))}
      </ol>

      {!compact && next && (
        <Link
          to="/admin/ai-agent/setup"
          className="mt-3 inline-block rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-700"
        >
          התחל הגדרה ראשונית
        </Link>
      )}
    </section>
  );
}
