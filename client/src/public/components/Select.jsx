import { cn } from '../lib/cn.js';

// Accessible select built on the NATIVE <select> (keyboard + screen-reader safe
// by default), styled to match the design. `label` is the placeholder/default
// option text; an aria-label keeps it labelled even without a visible <label>.
//
// options: string[]  OR  [{ value, label }]
export default function Select({ label, value, onChange, options, className }) {
  const norm = options.map((o) =>
    typeof o === 'string' ? { value: o, label: o } : o,
  );
  return (
    <div className={cn('relative', className)}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-cta border border-ink-300 bg-white px-4 py-3 pl-9 text-body text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      >
        <option value="">{label}</option>
        {norm.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {/* Decorative chevron on the trailing (left, RTL) edge. */}
      <span
        className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-400"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  );
}
