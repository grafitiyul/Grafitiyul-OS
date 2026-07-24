// Compact history row for Communication Center sends (TimelineEntry
// kind='communication'). data = { event: 'communication_sent', deliveryId,
// messageNumber, channel, language, recipientName, eventName, messageName,
// subject }.

export default function CommunicationEventRow({ entry }) {
  const d = entry.data || {};
  const when = entry.createdAt ? new Date(entry.createdAt) : null;
  const wa = d.channel === 'whatsapp';

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2" dir="rtl">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[14px] leading-none" aria-hidden>{wa ? '💬' : '✉️'}</span>
        <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ${
          wa ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-indigo-50 text-indigo-700 ring-indigo-200'
        }`}>
          תקשורת אוטומטית
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-gray-800">
          <span className="font-medium">
            {wa ? 'נשלחה הודעת WhatsApp' : 'נשלח מייל'}
            {d.recipientName ? ` אל ${d.recipientName}` : ''}
          </span>
          {d.subject && <span className="text-gray-500"> · {d.subject}</span>}
          <span className="text-gray-500"> · {d.eventName}{d.messageName ? ` — ${d.messageName}` : ''}</span>
          {d.messageNumber != null && <span className="font-mono text-[11px] text-gray-400"> · #{d.messageNumber}</span>}
        </span>
        <span className="shrink-0 text-[11px] text-gray-400">
          {when
            ? when.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            : ''}
        </span>
      </div>
    </div>
  );
}
