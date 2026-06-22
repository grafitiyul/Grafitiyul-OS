import { cn } from '../lib/cn.js';

// Public CTA button — modelled on the Figma "Master Primary Button" set.
//
// Presentational + props-only (no data fetching, no routing logic) so it is
// SSR-safe and survives the Vike wiring later. Polymorphic: pass `href` to
// render an <a>, otherwise it renders a <button>.
//
// variant:
//   action    — primary pink CTA (cranberry/500) — the main "buy / continue"
//   highlight  — amber CTA (golden/400) — secondary emphasis ("search tour")
//   brand      — cerulean primary
//   outline    — transparent with current-colour border (for dark navbars)
//   ghost      — text-only
// size: sm | md | lg     shape: pill (default) | cta (10px radius)

const VARIANTS = {
  action: 'bg-action-500 text-white hover:bg-action-600 focus-visible:ring-action-500',
  highlight:
    'bg-highlight-400 text-ink-900 hover:bg-highlight-500 focus-visible:ring-highlight-400',
  brand: 'bg-brand-500 text-white hover:bg-brand-600 focus-visible:ring-brand-500',
  outline:
    'bg-transparent border border-current hover:bg-white/10 focus-visible:ring-current',
  ghost: 'bg-transparent hover:bg-ink-100 text-ink-800 focus-visible:ring-ink-300',
};

const SIZES = {
  sm: 'text-body-sm px-4 py-2 gap-1.5',
  md: 'text-body-lg px-6 py-3 gap-2',
  lg: 'text-body-lg px-8 py-4 gap-2',
};

export default function Button({
  children,
  variant = 'action',
  size = 'md',
  shape = 'pill',
  href,
  iconLeft,
  iconRight,
  fullWidth = false,
  className,
  type,
  disabled = false,
  ...rest
}) {
  const classes = cn(
    'inline-flex items-center justify-center font-medium select-none',
    'transition-colors duration-150 outline-none',
    'focus-visible:ring-2 focus-visible:ring-offset-2',
    'disabled:opacity-50 disabled:pointer-events-none',
    shape === 'pill' ? 'rounded-pill' : 'rounded-cta',
    VARIANTS[variant] || VARIANTS.action,
    SIZES[size] || SIZES.md,
    fullWidth && 'w-full',
    className,
  );

  const content = (
    <>
      {iconLeft != null && <span className="shrink-0">{iconLeft}</span>}
      {children != null && <span>{children}</span>}
      {iconRight != null && <span className="shrink-0">{iconRight}</span>}
    </>
  );

  if (href && !disabled) {
    return (
      <a href={href} className={classes} {...rest}>
        {content}
      </a>
    );
  }

  return (
    <button
      type={type || 'button'}
      className={classes}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      {...rest}
    >
      {content}
    </button>
  );
}
