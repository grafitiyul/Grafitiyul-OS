// The safety panel — "what can the agent actually do right now".
//
// Every line comes from the server's derived safety summary. Nothing here is a
// reassuring constant: if automatic sending is ever granted, this panel says so
// on the very next load, with no code change. A safety panel that can lie once
// is worse than no safety panel at all.

export default function SafetyPanel({ safety, compact = false }) {
  if (!safety?.facts) return null;

  return (
    <section className={`rounded-xl border border-gray-200 bg-white ${compact ? 'p-3' : 'p-4'}`}>
      <h2 className="gos-detail mb-1 font-semibold text-gray-900">מה הסוכן רשאי לעשות כרגע</h2>
      <p className="gos-meta mb-3">מחושב מההגדרות בפועל — לא טקסט קבוע.</p>

      <ul className="space-y-1.5">
        {safety.facts.map((f) => {
          // A "yes" on a negative fact (can send by itself) is a WARNING, not a
          // success. Colour follows meaning, never the boolean.
          const good = f.negative ? !f.yes : f.yes;
          return (
            <li key={f.key} className="flex items-start gap-2">
              <span
                aria-hidden
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                  good ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                }`}
              >
                {f.yes ? '✓' : '✕'}
              </span>
              <span className="min-w-0">
                <span className={`gos-detail ${good ? 'text-gray-800' : 'text-rose-800 font-semibold'}`}>
                  {f.textHe}
                </span>
                {f.detailHe && <span className="gos-meta block">{f.detailHe}</span>}
              </span>
            </li>
          );
        })}
      </ul>

      {safety.canAutoSend && (
        <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-900">
          שים לב: הסוכן מוסמך כרגע לשלוח הודעות ללקוחות בעצמו.
        </div>
      )}
    </section>
  );
}

/** The mode rollup — how many categories sit at each authority level. */
export function ModeRollup({ counts, onNavigate }) {
  if (!counts) return null;
  const cells = [
    { key: 'disabled', labelHe: 'כבויות', value: counts.disabled, style: 'bg-gray-100 text-gray-600' },
    { key: 'shadow', labelHe: 'בצפייה בלבד', value: counts.shadow, style: 'bg-slate-100 text-slate-700' },
    { key: 'approval', labelHe: 'דורשות אישור', value: counts.approval, style: 'bg-amber-50 text-amber-800' },
    { key: 'auto', labelHe: 'אוטומטיות', value: counts.auto, style: 'bg-emerald-50 text-emerald-800' },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onNavigate?.(c.key)}
          className={`rounded-lg px-3 py-2 text-start transition hover:opacity-80 ${c.style}`}
        >
          <div className="text-[20px] font-semibold leading-none tabular-nums">{c.value ?? 0}</div>
          <div className="gos-meta mt-0.5 opacity-90">{c.labelHe}</div>
        </button>
      ))}
    </div>
  );
}
