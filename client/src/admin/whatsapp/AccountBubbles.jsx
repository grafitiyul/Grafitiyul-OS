import { isUsableAccount } from './senderAccount.js';

// THE number picker. Every WhatsApp sending surface in GOS renders this and
// nothing else — Deal conversation panel, Deal templates, scheduled WhatsApp
// tasks, Contact/Organization panels, payment links, operational
// notifications, staff broadcasts. One control, one behaviour, so an operator
// reads "which number am I sending from" the same way everywhere.
//
// Design intent: the selected number must be unmistakable, so it is FILLED and
// ringed rather than merely tinted; a number with no conversation with this
// contact yet is drawn dashed — present and clickable, visibly empty; a number
// whose bridge is down or unreachable is dimmed and cannot be chosen, because
// selecting it would only queue messages nowhere.
//
// `alwaysShow` forces the row even with a single number, for surfaces whose
// whole job is choosing a sender (staff broadcasts). Elsewhere a one-option
// picker is hidden: it would imply a decision that does not exist, and those
// surfaces name the number in their header instead.

export default function AccountBubbles({
  accounts = [],
  activeId = null,
  chatByAccount = null,
  unreadByAccount = {},
  busyId = null,
  onSelect,
  label = 'שולח מ־',
  alwaysShow = false,
  className = '',
}) {
  if (accounts.length === 0) return null;
  if (accounts.length < 2 && !alwaysShow) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {label && <span className="shrink-0 text-[11px] font-medium text-gray-400">{label}</span>}
      {accounts.map((a) => {
        const active = a.id === activeId;
        // chatByAccount is optional: surfaces with no conversation concept
        // (staff broadcasts, notifications) pass nothing and get plain bubbles.
        const knowsChats = !!chatByAccount;
        const hasChat = knowsChats && !!chatByAccount[a.id];
        const unread = unreadByAccount[a.id] || 0;
        const busy = busyId === a.id;
        const selectable = a.retired ? false : isUsableAccount(a);
        return (
          <button
            key={a.id}
            type="button"
            disabled={!selectable && !active}
            onClick={() => selectable && onSelect?.(a.id)}
            aria-pressed={active}
            title={
              a.retired
                ? `${a.label} — מספר שאינו פעיל עוד (היסטוריה בלבד)`
                : !selectable
                  ? `${a.label} — לא מחובר כרגע, אי אפשר לשלוח ממנו`
                  : knowsChats && !hasChat
                    ? `אין עדיין שיחה מ${a.label} — ההודעה הראשונה תפתח אותה`
                    : `שליחה מ${a.label}`
            }
            className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold transition ${
              active
                ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-200'
                : !selectable
                  ? 'cursor-not-allowed border border-gray-200 bg-gray-50 text-gray-400'
                  : knowsChats && !hasChat
                    ? 'border border-dashed border-gray-300 bg-white text-gray-500 hover:border-emerald-400 hover:text-emerald-700'
                    : 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {/* Live connection state — an operator about to type into a number
                whose bridge is down deserves to see it before they send. */}
            {!a.retired && (
              <span
                aria-hidden
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  isUsableAccount(a) ? (active ? 'bg-emerald-200' : 'bg-emerald-500') : 'bg-amber-400'
                }`}
              />
            )}
            <span>{a.label}</span>
            {busy && <span className={active ? 'text-emerald-100' : 'text-gray-400'}>…</span>}
            {!active && unread > 0 && (
              <span
                dir="ltr"
                className="flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-red-500 px-1 text-[10.5px] font-bold leading-none text-white"
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
