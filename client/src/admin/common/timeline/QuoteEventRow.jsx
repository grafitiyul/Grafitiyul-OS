// Compact history row for quote events (TimelineEntry kind='quote').
// data = { event: 'quote_generated' | 'quote_sent', quoteDocumentId, offerNo?,
//          versionNo, language, publicToken, channel?, to? }.
// The public URL is permanent (immutable snapshot), so linking straight to it
// from history is always safe.

import EventRowShell from './EventRowShell.jsx';

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-gray-400">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

export default function QuoteEventRow({ entry }) {
  const d = entry.data || {};
  const sent = d.event === 'quote_sent';
  const won = d.event === 'won_reference';
  const version = d.versionNo ? `גרסה ${d.versionNo}` : null;
  const offer = d.offerNo && (d.offerNo > 1 || won) ? `הצעה ${d.offerNo}` : null;
  const url = d.publicToken ? `/quote/${d.publicToken}` : null;

  return (
    <EventRowShell
      icon={<DocIcon />}
      chip={{ label: 'הצעת מחיר', tone: 'bg-teal-50 text-teal-700 ring-teal-200' }}
      when={entry.createdAt}
      actor={entry.createdByName || entry.actorLabel || 'מערכת'}
      trailing={
        url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-50"
          >
            פתח ↗
          </a>
        ) : null
      }
    >
      {won ? '🏆 העסקה נסגרה על בסיס הצעה זו' : sent ? `נשלחה ${d.channel === 'email' ? 'במייל' : 'ללקוח'}` : 'הופקה'}
      {[offer, version].filter(Boolean).map((part) => (
        <span key={part} className="gos-detail"> · {part}</span>
      ))}
      {sent && d.to && <span className="gos-detail"> · אל {d.to}</span>}
    </EventRowShell>
  );
}
