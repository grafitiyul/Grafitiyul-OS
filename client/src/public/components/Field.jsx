import { cn } from '../lib/cn.js';

// Form field wrapper: label (+ required marker) over a control, with optional
// hint and error text. Keeps form layout consistent and accessible — pass the
// same `htmlFor`/`id` to wire the label to the control.
//
// Usage:
//   <Field label="אימייל" htmlFor="email" required error={errors.email}>
//     <Input id="email" type="email" invalid={!!errors.email} />
//   </Field>
export default function Field({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  children,
  className,
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label != null && (
        <label htmlFor={htmlFor} className="text-body-sm font-medium text-ink-700">
          {label}
          {required && <span className="text-danger-500"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-body-sm text-danger-600">{error}</p>
      ) : hint ? (
        <p className="text-body-sm text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}
