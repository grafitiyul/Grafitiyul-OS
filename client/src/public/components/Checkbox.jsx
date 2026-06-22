import { forwardRef } from 'react';
import { cn } from '../lib/cn.js';

// Checkbox + inline label (the checkout "I accept the terms" pattern).
// Uses the native input (accessible) with brand accent colour.
const Checkbox = forwardRef(function Checkbox(
  { label, id, className, ...rest },
  ref,
) {
  return (
    <label
      htmlFor={id}
      className={cn('inline-flex items-center gap-2 cursor-pointer select-none', className)}
    >
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className="h-5 w-5 rounded border-ink-300 text-brand-500 accent-brand-500 focus:ring-brand-100"
        {...rest}
      />
      {label != null && <span className="text-body text-ink-800">{label}</span>}
    </label>
  );
});

export default Checkbox;
