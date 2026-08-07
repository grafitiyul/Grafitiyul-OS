// Compact history row for Communication Center sends (TimelineEntry
// kind='communication'). data = { event: 'communication_sent', deliveryId,
// messageNumber, channel, language, recipientName, eventName, messageName,
// subject }.
//
// DELIVERY TRUTH: outgoing-email rows carry `data.delivery`, attached at READ
// time by server/src/email/deliveryState.js from the canonical queue row. This
// row renders THAT state and never its own guess. It used to print
// "נשלח מייל" for anything queued — so deals #27099/#27100 read as sent in the
// feed for a full day while Gmail had rejected every attempt.

import EventRowShell from './EventRowShell.jsx';
import { DELIVERY_LABEL_HE, DELIVERY_TONE, deliverySummaryHe } from '../../../lib/emailDelivery.js';

export default function CommunicationEventRow({ entry }) {
  const d = entry.data || {};
  const wa = d.channel === 'whatsapp';
  // Operator-sent confirmation email rides the same row shape but is NOT
  // automated communication — label it for what it is.
  const manual = d.event === 'confirmation_email_queued';
  // The WON hook's auto-send stopped — visible in the feed, never invisible.
  const autoFailed = d.event === 'confirmation_email_auto_failed';
  const delivery = d.delivery || null;

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

  // The lead sentence follows the DELIVERY, not the intent. WhatsApp keeps its
  // existing wording (its own queue owns that state).
  let lead = wa ? 'נשלחה הודעת WhatsApp' : 'נשלח מייל';
  let rowTone;
  if (!wa && delivery) {
    if (delivery.state === 'sent') lead = 'נשלח מייל';
    else if (delivery.state === 'failed') { lead = 'המייל לא נשלח'; rowTone = 'warning'; }
    else if (delivery.state === 'cancelled') lead = 'השליחה בוטלה';
    else lead = 'המייל בתור השליחה'; // queued | sending
  }

  return (
    <EventRowShell
      tone={rowTone}
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
      {lead}
      {d.recipientName ? ` אל ${d.recipientName}` : ''}
      {/* The canonical delivery chip — one look tells the operator whether the
          customer actually has this email. Only 'sent' reads as success. */}
      {!wa && delivery && delivery.state !== 'sent' && (
        <span
          className={`mx-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${DELIVERY_TONE[delivery.state]}`}
          title={deliverySummaryHe(delivery)}
        >
          {DELIVERY_LABEL_HE[delivery.state]}
        </span>
      )}
      {d.subject && <span className="gos-detail"> · {d.subject}</span>}
      <span className="gos-detail"> · {d.eventName}{d.messageName ? ` — ${d.messageName}` : ''}</span>
      {manual && d.language && <span className="gos-detail"> · {d.language === 'en' ? 'English' : 'עברית'}</span>}
      {d.messageNumber != null && <span className="gos-meta font-mono"> · #{d.messageNumber}</span>}
      {/* A failure names its reason inline — never make the operator dig. */}
      {!wa && delivery?.state === 'failed' && delivery.failureReason && (
        <span className="gos-detail text-red-700"> · {delivery.failureReason}</span>
      )}
    </EventRowShell>
  );
}
