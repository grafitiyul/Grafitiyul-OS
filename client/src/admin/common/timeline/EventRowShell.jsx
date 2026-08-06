// THE one-line timeline event row — the shared shell every non-note history
// object renders through (change / communication / quote / tour / task / file /
// email / accounting).
//
// Before this existed, seven files hand-rolled the same markup
// (`rounded-xl border border-gray-200 bg-white px-3 py-2` → icon → chip →
// `text-[13px] text-gray-800` statement → `text-[11px] text-gray-400` stamp).
// They drifted, and worse, the statement — the only thing the operator is
// actually trying to read — carried LESS visual weight than the coloured kind
// chip beside it. One shell means one reading hierarchy for the whole feed:
//
//   kind chip   small, coloured — WHAT KIND of event (recognised by colour)
//   statement   .gos-title-sm   — WHAT HAPPENED (the primary level)
//   stamp       .gos-meta-key + .gos-meta — WHO and WHEN, trailing edge
//
// See index.css §GOS READING HIERARCHY.

const TONES = {
  default: 'border-gray-200 bg-white',
  warning: 'border-amber-200 bg-amber-50/60',
  success: 'border-emerald-200 bg-emerald-50/50',
};

export function fmtEventWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// The kind badge. Small and coloured, deliberately NOT competing with the
// statement — colour carries the recognition, size keeps it quiet.
export function EventChip({ tone, children }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold leading-none ring-1 ${tone}`}
    >
      {children}
    </span>
  );
}

// WHO + WHEN, always in this order, always at the trailing edge, always the
// smallest thing on the row. The actor is the findable token (.gos-meta-key);
// the timestamp uses tabular figures so stamps align down a stacked feed.
export function EventStamp({ when, actor }) {
  const stamp = fmtEventWhen(when);
  if (!stamp && !actor) return null;
  return (
    <span className="gos-meta-cluster shrink-0">
      {actor && <span className="gos-meta-key max-w-[10rem] truncate">{actor}</span>}
      {actor && stamp && <span className="gos-sep" aria-hidden>·</span>}
      {stamp && (
        <span className="gos-meta whitespace-nowrap" dir="ltr">
          {stamp}
        </span>
      )}
    </span>
  );
}

export default function EventRowShell({
  icon = null,
  chip = null, // { label, tone } — tone = ring/bg/text classes
  tone = 'default',
  children, // the statement (primary level)
  trailing = null, // inline extras that sit before the stamp (links, counters)
  when = null,
  actor = null,
  below = null, // expanded detail rendered under the line
}) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${TONES[tone] || TONES.default}`} dir="rtl">
      <div className="flex items-center gap-2">
        {icon && <span className="shrink-0 leading-none">{icon}</span>}
        {chip && <EventChip tone={chip.tone}>{chip.label}</EventChip>}
        {/* The statement carries the primary level from HERE, once, for every
            event kind. A row that needs a quieter continuation (a subject line
            followed by its snippet) drops .gos-detail on an inner span. */}
        <span className="gos-title-sm min-w-0 flex-1 truncate">{children}</span>
        {trailing}
        <EventStamp when={when} actor={actor} />
      </div>
      {below}
    </div>
  );
}
