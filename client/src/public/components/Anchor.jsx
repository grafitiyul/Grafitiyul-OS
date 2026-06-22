import { cn } from '../lib/cn.js';

// Link abstraction for the public surface.
//
// Right now it renders a plain <a> (works for SSR + crawlers). It is the
// single chokepoint we will swap to the router's client-side Link in Step 3/4
// (Vike) WITHOUT touching every call site — that's the whole point of routing
// through this component instead of raw <a> everywhere.
//
// tone: inherit (default) | brand | muted
const TONE = {
  inherit: '',
  brand: 'text-brand-600 hover:text-brand-700',
  muted: 'text-ink-500 hover:text-ink-700',
};

export default function Anchor({ href, children, tone = 'inherit', className, ...rest }) {
  return (
    <a
      href={href}
      className={cn('transition-colors', TONE[tone] || '', className)}
      {...rest}
    >
      {children}
    </a>
  );
}
