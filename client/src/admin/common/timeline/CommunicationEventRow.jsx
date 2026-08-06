// Compact history row for Communication Center sends (TimelineEntry
// kind='communication'). data = { event: 'communication_sent', deliveryId,
// messageNumber, channel, language, recipientName, eventName, messageName,
// subject }.

import EventRowShell from './EventRowShell.jsx';

export default function CommunicationEventRow({ entry }) {
  const d = entry.data || {};
  const wa = d.channel === 'whatsapp';
  // Operator-sent confirmation email rides the same row shape but is NOT
  // automated communication — label it for what it is.
  const manual = d.event === 'confirmation_email_queued';
  // The WON hook's auto-send stopped — visible in the feed, never invisible.
  const autoFailed = d.event === 'confirmation_email_auto_failed';

  if (autoFailed) {
    return (
      <EventRowShell
        tone="warning"
        icon={<span className="text-[14px]" aria-hidden>⚠️</span>}
        chip={{ label: 'מייל אישור', tone: 'bg-amber-100 text-amber-800 ring-amber-200' }}
        when={entry.createdAt}
      >
        <span className="text-amber-900">השליחה האוטומטית נעצרה</span>
        <span className="gos-detail text-amber-700"> · {d.errorHe || d.error || ''}</span>
        <span className="gos-detail text-amber-700"> · פתחו תצוגה מקדימה ושלחו ידנית</span>
      </EventRowShell>
    );
  }

  return (
    <EventRowShell
      icon={<span className="text-[14px]" aria-hidden>{wa ? '💬' : '✉️'}</span>}
      chip={{
        label: manual ? 'מייל אישור' : 'תקשורת אוטומטית',
        tone: wa ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-indigo-50 text-indigo-700 ring-indigo-200',
      }}
      when={entry.createdAt}
      trailing={
        manual && d.sendId ? (
          <a
            href={`/admin/confirmation-view/${d.sendId}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-50"
          >
            צפייה
          </a>
        ) : null
      }
    >
      {wa ? 'נשלחה הודעת WhatsApp' : 'נשלח מייל'}
      {d.recipientName ? ` אל ${d.recipientName}` : ''}
      {d.subject && <span className="gos-detail"> · {d.subject}</span>}
      <span className="gos-detail"> · {d.eventName}{d.messageName ? ` — ${d.messageName}` : ''}</span>
      {manual && d.language && <span className="gos-detail"> · {d.language === 'en' ? 'English' : 'עברית'}</span>}
      {d.messageNumber != null && <span className="gos-meta font-mono"> · #{d.messageNumber}</span>}
    </EventRowShell>
  );
}
