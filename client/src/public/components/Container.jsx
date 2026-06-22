import { cn } from '../lib/cn.js';

// Horizontal page container with responsive gutters.
//
// Figma desktop frames are 1440px wide with ~146–150px side padding; mobile
// frames are 375px with ~16–20px padding. We approximate that as a centred
// max-width with gutters that grow by breakpoint, rather than hard-coding the
// 1440 design width (so the layout stays fluid between the two fixed canvases).
//
// size: default (max-w-[1180px]) | wide (max-w-[1320px]) | narrow (max-w-[820px])
const MAX = {
  default: 'max-w-[1180px]',
  wide: 'max-w-[1320px]',
  narrow: 'max-w-[820px]',
};

export default function Container({ children, size = 'default', className }) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 sm:px-6 lg:px-12 xl:px-16',
        MAX[size] || MAX.default,
        className,
      )}
    >
      {children}
    </div>
  );
}
