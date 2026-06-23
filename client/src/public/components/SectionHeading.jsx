import { cn } from '../lib/cn.js';

// Centred section title + subtitle, the repeating header pattern across the
// homepage ("תצטרפו לסיורים…", "מארגנים אירוע?", etc.).
//
// tone: dark sections invert the text colour.
export default function SectionHeading({
  title,
  subtitle,
  align = 'center',
  tone = 'light',
  className,
}) {
  const isDark = tone === 'dark';
  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        align === 'center' ? 'items-center text-center' : 'items-start text-start',
        className,
      )}
    >
      <h2
        className={cn(
          'text-h2 sm:text-h1 font-bold',
          isDark ? 'text-white' : 'text-brand-950',
        )}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          className={cn(
            'max-w-2xl text-body-lg',
            isDark ? 'text-white/85' : 'text-ink-600',
          )}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}
