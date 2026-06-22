import { cn } from '../lib/cn.js';
import Container from './Container.jsx';

// Vertical section wrapper providing consistent page rhythm + optional
// background tone. Wraps its children in a Container by default (set
// `contained={false}` for full-bleed sections that manage their own width).
//
// tone: white | light (ink-100 off-white) | dark (ink-800 navy) | brand
const TONE = {
  white: 'bg-white text-ink-900',
  light: 'bg-ink-100 text-ink-900',
  dark: 'bg-ink-800 text-white',
  brand: 'bg-brand-950 text-white',
};

const SPACE = {
  sm: 'py-10 lg:py-14',
  md: 'py-14 lg:py-20',
  lg: 'py-16 lg:py-28',
};

export default function Section({
  children,
  tone = 'white',
  space = 'md',
  contained = true,
  containerSize = 'default',
  className,
  ...rest
}) {
  return (
    <section
      className={cn(TONE[tone] || TONE.white, SPACE[space] || SPACE.md, className)}
      {...rest}
    >
      {contained ? <Container size={containerSize}>{children}</Container> : children}
    </section>
  );
}
