// Compact history row for an email event (timeline kind='email' — read-time
// merged pseudo-entries; EmailMessage is the source of truth, nothing is
// copied into TimelineEntry). Shows direction, subject, snippet and the
// honest engagement signal for GOS-sent mail.

import EventRowShell from '../common/timeline/EventRowShell.jsx';

function GmailGlyph() {
  return (
    <svg viewBox="0 0 48 48" width="15" height="15" aria-hidden>
      <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75V40h7a3 3 0 0 0 3-3V16.2z" />
      <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6a3 3 0 0 1-3-3V16.2z" />
      <path fill="#e53935" d="M35 11.2L24 19.45 13 11.2 12 17l1 6.7 11 8.25 11-8.25 1-6.7z" />
      <path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859A4.298 4.298 0 0 0 3 12.298z" />
      <path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341A4.298 4.298 0 0 1 45 12.298z" />
    </svg>
  );
}

export default function EmailEventRow({ entry }) {
  const data = entry.data || {};
  const outbound = data.direction === 'outbound';
  const opens = data.engagement?.openCount || 0;

  return (
    <EventRowShell
      icon={<GmailGlyph />}
      chip={{
        label: outbound ? 'נשלח מייל' : 'התקבל מייל',
        tone: outbound ? 'bg-blue-50 text-blue-700 ring-blue-200' : 'bg-gray-100 text-gray-600 ring-gray-200',
      }}
      when={entry.createdAt}
      // Inbound mail's origin is the sender; outbound's is whoever sent it from
      // GOS. Both are the same metadata slot, so they line up down the feed.
      actor={outbound ? entry.createdByName || 'המערכת' : data.fromName || null}
      trailing={
        outbound && opens > 0 ? (
          <span
            className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold leading-none text-emerald-700 ring-1 ring-emerald-200"
            title="אינדיקציית פתיחה — אינה מדויקת ב-100% (חוסמי תמונות, פרוקסי של Gmail וכד')"
          >
            נפתח · {opens}
          </span>
        ) : null
      }
    >
      <span dir="auto">
        {data.subject || '(ללא נושא)'}
        {data.snippet && <span className="gos-detail"> — {data.snippet}</span>}
      </span>
    </EventRowShell>
  );
}
