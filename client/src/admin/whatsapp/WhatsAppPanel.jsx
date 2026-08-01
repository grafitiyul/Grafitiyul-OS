import WhatsAppLogo from '../common/WhatsAppLogo.jsx';
import ChatThread from './ChatThread.jsx';
import AccountBubbles from './AccountBubbles.jsx';
import { useSubjectChats } from './useSubjectChats.js';
import { chatTargetKey } from './chatTarget.js';

// The WhatsApp surface embedded in a CRM page (Contact page / Organization
// page, via the timeline's WhatsApp tab). The Deal page uses WhatsAppDock
// instead — different chrome, IDENTICAL model: both read useSubjectChats, both
// switch on contact × our number through AccountBubbles, both treat a number
// with no conversation as an empty thread whose first message creates it.
//
// This panel never creates data on its own and never links chats: chats reach
// Contacts by phone matching, upstream.

export default function WhatsAppPanel({ subjectType, subjectId }) {
  const {
    loading,
    contacts,
    primaryContactId,
    activeContact,
    accounts,
    activeAccountId,
    activeAccount,
    activeChat,
    chatByAccount,
    unreadByAccount,
    selectContact,
    selectAccount,
    adoptChat,
  } = useSubjectChats(subjectType, subjectId);

  if (loading) {
    return <div className="rounded-xl bg-gray-50 px-4 py-10 text-center text-sm text-gray-400">טוען שיחות…</div>;
  }

  if (!activeChat) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50">
          <WhatsAppLogo size={24} />
        </div>
        <p className="text-sm font-medium text-gray-700">
          {activeContact ? 'אין מספר WhatsApp מחובר' : 'אין איש קשר לשיחה'}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-gray-500">
          {activeContact
            ? 'חברו מספר בהגדרות → תקשורת כדי לשלוח הודעות.'
            : 'שיחות מתקשרות אוטומטית לפי מספר הטלפון של אנשי הקשר.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* WHO — only when this subject has more than one person. */}
      {contacts.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {contacts.map((c) => {
            const active = activeContact && c.id === activeContact.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => selectContact(c.id)}
                className={`rounded-full border px-3 py-1 text-[12px] font-medium transition ${
                  active
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {c.name}
                {c.id === primaryContactId && (
                  <span className={active ? 'text-emerald-100' : 'text-gray-400'}> ★</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* FROM WHICH NUMBER — the shared picker, hidden when there is only one. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[12px] text-gray-500">
          <WhatsAppLogo size={14} />
          <span>{activeContact?.name || activeChat.displayName || 'שיחה'}</span>
          {activeAccount?.label && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
              {activeAccount.label}
            </span>
          )}
        </p>
        <AccountBubbles
          accounts={accounts}
          activeId={activeAccountId}
          chatByAccount={chatByAccount}
          unreadByAccount={unreadByAccount}
          onSelect={selectAccount}
        />
      </div>

      <ChatThread key={chatTargetKey(activeChat)} chat={activeChat} onMaterialized={adoptChat} />
    </div>
  );
}
