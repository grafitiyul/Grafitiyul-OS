import { forwardRef } from 'react';
import { cn } from '../lib/cn.js';

// Text input. Matches the Figma checkout field: 1px border, 8px radius,
// comfortable height, RTL-friendly (the surrounding `.public-root[dir=rtl]`
// handles text direction; placeholder/label sit on the start edge).
//
// `invalid` switches the border to the danger tone for validation states.
const Input = forwardRef(function Input(
  { invalid = false, className, type = 'text', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full rounded-cta border bg-white px-4 py-3 text-body text-ink-900',
        'placeholder:text-ink-400 outline-none transition-colors',
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

export default Input;
