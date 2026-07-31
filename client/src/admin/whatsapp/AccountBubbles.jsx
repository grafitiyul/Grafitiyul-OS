// THE number switcher — one bubble per connected WhatsApp number, shared by
// every CRM surface that can read or send (Deal dock, template modal), so the
// control looks and behaves identically everywhere.
//
// Design intent: the operator must never wonder which of our numbers they are
// reading or sending from. So the row is LABELLED ("שולח מ־"), the selected
// bubble is filled and ringed rather than merely tinted, and a number with no
// conversation yet is drawn dashed — present and clickable, visibly empty.
//
// Renders nothing with a single number: a switcher with one option implies a
// decision that does not exist (the same rule SenderAccountSelect follows).
// The surrounding surface still names the number in its header.

export default function AccountBubbles({
  accounts = [],
  activeId = null,
  chatByAccount = {},
  unreadByAccount = {},
  busyId = null,
  onSelect,
  className = '',
}) {
  if (accounts.length < 2) return null;

  return (
    <div className={`flex items-center gap-1.5 overflow-x-auto ${className}`}>
      <span className="shrink-0 text-[11px] font-medium text-gray-400">שולח מ־</span>
      {accounts.map((a) => {
        const active = a.id === activeId;
        const hasChat = !!chatByAccount[a.id];
        const unread = unreadByAccount[a.id] || 0;
        const busy = busyId === a.id;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect?.(a.id)}
            aria-pressed={active}
            title={
              a.retired
                ? `${a.label} — מספר שאינו פעיל עוד (היסטוריה בלבד)`
                : hasChat
                  ? `שיחה עם הלקוח מ${a.label}`
                  : `אין עדיין שיחה מ${a.label} — לחיצה תפתח שיחה חדשה`
            }
            className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold transition ${
              active
                ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-200'
                : hasChat
                  ? 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                  : 'border border-dashed border-gray-300 bg-white text-gray-400 hover:border-emerald-400 hover:text-emerald-700'
            }`}
          >
            {/* Live connection state — an operator about to type into a number
                whose bridge is down deserves to see it before they send. */}
            {!a.retired && (
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  a.connected ? (active ? 'bg-emerald-200' : 'bg-emerald-500') : 'bg-amber-400'
                }`}
                title={a.connected ? 'מחובר' : 'לא מחובר כרגע'}
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
