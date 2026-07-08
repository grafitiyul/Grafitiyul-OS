// Compact history row for quote events (TimelineEntry kind='quote').
// data = { event: 'quote_generated' | 'quote_sent', quoteDocumentId, offerNo?,
//          versionNo, language, publicToken, channel?, to? }.
// The public URL is permanent (immutable snapshot), so linking straight to it
// from history is always safe.

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
  const when = entry.createdAt ? new Date(entry.createdAt) : null;
  const actor = entry.createdByName || entry.actorLabel || 'מערכת';
  const sent = d.event === 'quote_sent';
  const version = d.versionNo ? `גרסה ${d.versionNo}` : null;
  const offer = d.offerNo && d.offerNo > 1 ? `הצעה ${d.offerNo}` : null;
  const url = d.publicToken ? `/quote/${d.publicToken}` : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2" dir="rtl">
      <div className="flex items-center gap-2">
        <span className="shrink-0 leading-none"><DocIcon /></span>
        <span className="inline-flex shrink-0 items-center rounded-full bg-teal-50 px-2 py-0.5 text-[10.5px] font-semibold text-teal-700 ring-1 ring-teal-200">
          הצעת מחיר
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-gray-800">
          <span className="font-medium">{sent ? `נשלחה ${d.channel === 'email' ? 'במייל' : 'ללקוח'}` : 'הופקה'}</span>
          {[offer, version].filter(Boolean).map((part) => (
            <span key={part} className="text-gray-500"> · {part}</span>
          ))}
          {sent && d.to && <span className="text-gray-500"> · אל {d.to}</span>}
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline"> · פתח ↗</a>
          )}
        </span>
        <span className="shrink-0 text-[11px] text-gray-400">
          {when
            ? when.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            : ''}
          {' · '}
          {actor}
        </span>
      </div>
    </div>
  );
}
