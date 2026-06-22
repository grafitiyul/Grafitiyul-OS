import { cn } from '../lib/cn.js';

// Small pill label (categories, tags, status chips).
// tone: brand | accent | highlight | danger | success | neutral
const TONE = {
  brand: 'bg-brand-50 text-brand-700',
  accent: 'bg-accent-50 text-accent-700',
  highlight: 'bg-highlight-50 text-highlight-700',
  danger: 'bg-danger-50 text-danger-700',
  success: 'bg-[#34C759]/10 text-[#1A8287]',
  neutral: 'bg-ink-100 text-ink-600',
};

export default function Badge({ children, tone = 'brand', className, ...rest }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-pill px-3 py-1 text-body-sm font-medium',
        TONE[tone] || TONE.brand,
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
