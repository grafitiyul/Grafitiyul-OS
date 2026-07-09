// Shared on/off switch (RTL-safe — the knob position uses inset-inline-start).
// New surfaces should use THIS instead of hand-rolling a per-file toggle; two
// older private copies (PriceBuilderDialog, QuoteLayoutSettings) predate it and
// should be consolidated here when those files are next touched.
export default function Toggle({ checked, onChange, disabled = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-blue-600' : 'bg-gray-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
        style={{ insetInlineStart: checked ? '1.375rem' : '0.125rem' }}
      />
    </button>
  );
}
