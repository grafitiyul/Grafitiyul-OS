import { ACTIVITY_BADGE_TONE, ACTIVITY_BADGE_NEUTRAL, resolveActivityLabel } from './config.js';

// Display-only activity badge — the EXACT same text (resolveActivityLabel)
// and colors (ACTIVITY_BADGE_TONE) as the Deal header's ActivityBadge, in a
// compact chip any surface can drop into a row (WhatsApp inbox, lists).
// There is deliberately NO separate badge logic here: this component only
// composes the two shared sources of truth.
//
//   size 'sm' → list rows; 'md' → header-sized.
export default function ActivityBadgeChip({ activityType, orgTypeLabel, subtypeLabel, size = 'sm', title }) {
  const label =
    resolveActivityLabel({ activityType, orgTypeLabel, subtypeLabel }) || 'ללא סוג פעילות';
  const tone = activityType ? ACTIVITY_BADGE_TONE[activityType] : ACTIVITY_BADGE_NEUTRAL;
  const sizing =
    size === 'md' ? 'px-3 py-1 text-[13px] font-semibold' : 'px-2 py-0.5 text-[10.5px] font-medium';
  return (
    <span
      title={title || label}
      className={`inline-flex min-w-0 max-w-full items-center truncate rounded-full ${sizing} ${tone}`}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}
