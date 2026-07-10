// Shared on/off switch (RTL-safe — the knob position uses inset-inline-start).
// New surfaces should use THIS instead of hand-rolling a per-file toggle; two
// older private copies (PriceBuilderDialog, QuoteLayoutSettings) predate it and
// should be consolidated here when those files are next touched.
// `showLabel` renders the label as visible text inside the same button, so the
// text and the switch act as one clickable control; without it the label is
// aria-only and callers place their own text.
export default function Toggle({ checked, onChange, disabled = false, label, showLabel = false }) {
  const trackClass = `relative h-6 w-11 shrink-0 rounded-full transition-colors ${
    checked ? 'bg-blue-600' : 'bg-gray-300'
  } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`;
  const knob = (
    <span
      className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
      style={{ insetInlineStart: checked ? '1.375rem' : '0.125rem' }}
    />
  );
  if (!showLabel) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={trackClass}
      >
        {knob}
      </button>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 ${disabled ? 'cursor-not-allowed' : ''}`}
    >
      <span className={trackClass}>{knob}</span>
      <span className={`text-[13.5px] font-medium ${disabled ? 'text-gray-400' : 'text-gray-700'}`}>{label}</span>
    </button>
  );
}
