import { cn } from '../lib/cn.js';

// Rounded content card. Figma cards use generous radii (16–36px) and a soft
// shadow. `radius` picks between the standard card radius and a tighter one.
//
// radius: card (36px, the marketing look) | cta (10px) | xl (16px)
const RADIUS = {
  card: 'rounded-card',
  cta: 'rounded-cta',
  xl: 'rounded-2xl',
};

export default function Card({
  children,
  radius = 'card',
  elevated = false,
  className,
  ...rest
}) {
  return (
    <div
      className={cn(
        'bg-white',
        RADIUS[radius] || RADIUS.card,
        elevated ? 'shadow-elevated' : 'shadow-card',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
