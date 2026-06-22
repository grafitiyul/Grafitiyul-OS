import { forwardRef } from 'react';
import { cn } from '../lib/cn.js';

// Multi-line text field — same visual language as Input.
const Textarea = forwardRef(function Textarea(
  { invalid = false, rows = 4, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full rounded-cta border bg-white px-4 py-3 text-body text-ink-900',
        'placeholder:text-ink-400 outline-none transition-colors resize-y',
        'focus:ring-2 focus:ring-offset-0',
        invalid
          ? 'border-danger-400 focus:border-danger-500 focus:ring-danger-100'
          : 'border-ink-300 focus:border-brand-500 focus:ring-brand-100',
        className,
      )}
      {...rest}
    />
  );
});

export default Textarea;
