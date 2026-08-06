// ONE email-conversation row. Deal, Contact and any future surface render this
// — a thread must not look like a different object depending on where it is
// read from.
//
// A subject and a date are not enough to work from. Everything an operator
// needs to triage without opening anything is on the row: which way the last
// message went, who it was with, whether something is attached, whether it is
// unread, and — where the surface does not already imply it — which Deal the
// conversation belongs to.

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// Who this exchange is WITH. Outbound → the recipients; inbound → the sender.
// `participants` (counterparties, never our own address) is the fallback for a
// thread whose last message was not fetched.
function counterparty(thread) {
  if (thread.lastDirection === 'outbound' && thread.lastTo?.length) return thread.lastTo.join(', ');
  if (thread.lastDirection === 'inbound' && thread.lastFrom) return thread.lastFrom;
  return (thread.participants || []).map((p) => p.name || p.email).filter(Boolean).join(', ');
}

const DIRECTION = {
  outbound: { label: 'נשלח', tone: 'bg-blue-50 text-blue-700 ring-blue-200' },
  inbound: { label: 'התקבל', tone: 'bg-gray-100 text-gray-600 ring-gray-200' },
};

export default function EmailThreadRow({ thread, onOpen, showDeal = false }) {
  const unread = thread.unreadCount > 0 || thread.manualUnread;
  const dir = DIRECTION[thread.lastDirection] || null;
  const people = counterparty(thread);
  return (
    <button
      type="button"
      onClick={() => onOpen(thread)}
      className="flex w-full items-start gap-2.5 px-3 py-2.5 text-right transition-colors hover:bg-blue-50/40"
    >
      {/* Unread is a dot, not a colour change on everything — the row still has
          to be readable while it screams. */}
      <span
        aria-hidden="true"
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? 'bg-blue-600' : 'bg-transparent'}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {dir && (
            <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold ring-1 ${dir.tone}`}>
              {dir.label}
            </span>
          )}
          <span
            className={`min-w-0 flex-1 truncate text-[13.5px] ${unread ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}
            dir="auto"
          >
            {thread.subject || '(ללא נושא)'}
          </span>
          {/* Provenance, only where it is a FACT: this conversation's last
              message left through GOS. Gmail's SENT label alone cannot tell
              GOS from someone typing in Gmail, so silence here means "we
              don't know", never "not from GOS". */}
          {thread.sentFromGos && (
            <span
              title="נשלח מתוך GOS"
              className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200"
            >
              GOS
            </span>
          )}
          {thread.hasAttachments && (
            <span className="shrink-0 text-[12px] text-gray-400" title="יש קבצים מצורפים">📎</span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-gray-500">
          {people && <span className="truncate" dir="auto">{people}</span>}
          {thread.messageCount > 1 && <span className="shrink-0 text-gray-400">· {thread.messageCount}</span>}
        </span>
        {thread.snippet && (
          <span className="mt-0.5 block truncate text-[12px] text-gray-400" dir="auto">{thread.snippet}</span>
        )}
        {/* On the Contact surface a thread may belong to a deal — that context
            is the difference between "an email" and "the email about THIS job".
            Suppressed on the Deal surface, where it is already the answer. */}
        {showDeal && thread.linkedDeal && (
          <span className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-md bg-indigo-50 px-1.5 py-px text-[10.5px] font-medium text-indigo-700">
            דיל #{thread.linkedDeal.orderNo ?? ''} {thread.linkedDeal.stageName || ''}
          </span>
        )}
      </span>
      <span className="shrink-0 pt-0.5 text-[11px] text-gray-400">{fmtWhen(thread.lastMessageAt)}</span>
    </button>
  );
}
