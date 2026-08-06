// The email row in the Deal/Contact history feed (timeline kind='email' —
// read-time merged pseudo-entries; EmailMessage is the source of truth, nothing
// is copied into TimelineEntry).
//
// It used to say only direction + subject + snippet, which meant the operator
// had to leave the feed and go find the אימייל tab to learn anything. Now the
// collapsed row answers the triage questions on its own — who it was with, when,
// how big the thread is, whether anything is attached, whether it still needs
// reading, whether GOS sent it, and whether it actually went out — and clicking
// it opens the SAME canonical thread modal the Email tab uses.
//
// Built on EventRowShell so it keeps the feed's one reading hierarchy
// (index.css §GOS READING HIERARCHY) instead of becoming a special case.

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

// The chip states the DELIVERY TRUTH, never a hopeful summary. A mirrored
// message exists because Gmail has it; anything else is still an intention and
// says so. "queued" and "failed" must never read as "sent".
const STATE = {
  sent: { label: 'נשלח מייל', tone: 'bg-blue-50 text-blue-700 ring-blue-200', rowTone: 'default' },
  received: { label: 'התקבל מייל', tone: 'bg-gray-100 text-gray-600 ring-gray-200', rowTone: 'default' },
  queued: { label: 'ממתין לשליחה', tone: 'bg-amber-50 text-amber-800 ring-amber-200', rowTone: 'warning' },
  failed: { label: 'שליחה נכשלה', tone: 'bg-red-50 text-red-700 ring-red-200', rowTone: 'warning' },
  cancelled: { label: 'בוטל', tone: 'bg-gray-100 text-gray-500 ring-gray-200', rowTone: 'default' },
};

// Who the exchange is WITH — recipients for outbound, the sender for inbound.
function counterparty(d) {
  const names = (list) => (list || []).map((r) => r?.name || r?.email).filter(Boolean);
  if (d.direction === 'outbound') return names(d.toRecipients).join(', ');
  return d.fromName || d.fromEmail || '';
}

export default function EmailEventRow({ entry, onOpenThread = null }) {
  const data = entry.data || {};
  const state = STATE[data.deliveryState] || (data.direction === 'outbound' ? STATE.sent : STATE.received);
  const opens = data.engagement?.openCount || 0;
  const people = counterparty(data);
  const cc = (data.ccRecipients || []).length;
  // A thread we can actually open. An older/queued row without one degrades to
  // a plain row rather than opening something unrelated.
  const canOpen = !!(onOpenThread && data.threadId);

  const row = (
    <EventRowShell
      icon={<GmailGlyph />}
      chip={{ label: state.label, tone: state.tone }}
      tone={state.rowTone}
      when={entry.createdAt}
      actor={data.direction === 'outbound' ? entry.createdByName || 'המערכת' : data.fromName || null}
      trailing={
        <span className="flex shrink-0 items-center gap-1.5">
          {data.threadUnread && (
            <span className="h-2 w-2 rounded-full bg-blue-600" title="יש הודעות שלא נקראו בשיחה" aria-label="לא נקרא" />
          )}
          {data.attachmentCount > 0 && (
            <span className="gos-meta whitespace-nowrap" title={`${data.attachmentCount} קבצים מצורפים`}>
              📎 {data.attachmentCount}
            </span>
          )}
          {data.threadMessageCount > 1 && (
            <span className="gos-meta whitespace-nowrap" title="הודעות בשיחה">✉ {data.threadMessageCount}</span>
          )}
          {data.sentFromGos && (
            <span
              title="נשלח מתוך GOS"
              className="rounded-full bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200"
            >
              GOS
            </span>
          )}
          {opens > 0 && (
            <span
              className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold leading-none text-emerald-700 ring-1 ring-emerald-200"
              title="אינדיקציית פתיחה — אינה מדויקת ב-100% (חוסמי תמונות, פרוקסי של Gmail וכד')"
            >
              נפתח · {opens}
            </span>
          )}
        </span>
      }
      below={
        (people || cc > 0 || data.failureReason) && (
          <div className="gos-meta-cluster mt-1 ps-[23px]">
            {people && (
              <span className="gos-detail truncate" dir="auto">
                {data.direction === 'outbound' ? 'אל: ' : 'מאת: '}
                {people}
              </span>
            )}
            {cc > 0 && <span className="gos-meta shrink-0">· עותק ל-{cc}</span>}
            {/* A failure is stated, with its reason — never a silent amber row. */}
            {data.failureReason && (
              <span className="gos-meta shrink-0 text-red-700" dir="auto">· {data.failureReason}</span>
            )}
          </div>
        )
      }
    >
      <span dir="auto">
        {data.subject || '(ללא נושא)'}
        {data.snippet && <span className="gos-detail"> — {data.snippet}</span>}
      </span>
    </EventRowShell>
  );

  if (!canOpen) return row;
  return (
    <button
      type="button"
      // The subject rides along so the modal's title is the conversation's own
      // subject from the first frame, rather than "(ללא נושא)" until it loads.
      onClick={() => onOpenThread({ id: data.threadId, subject: data.subject })}
      aria-label={`פתיחת שיחת המייל: ${data.subject || 'ללא נושא'}`}
      className="block w-full rounded-xl text-right transition-shadow hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
    >
      {row}
    </button>
  );
}
