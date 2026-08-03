import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import WhatsAppLogo from '../common/WhatsAppLogo.jsx';
import ChatThread from './ChatThread.jsx';
import AccountBubbles from './AccountBubbles.jsx';
import { useSubjectChats } from './useSubjectChats.js';
import { chatTargetKey } from './chatTarget.js';
import { OPEN_WHATSAPP_COMPOSER_EVENT } from './composerEvents.js';

// The MOBILE WhatsApp surface of the Deal workspace — a dedicated bottom tab
// (WorkspaceLayout mobileTabs), full-height like a real chat app. Desktop keeps
// the floating WhatsAppDock; both compose the SAME building blocks
// (useSubjectChats selection model, AccountBubbles, ChatThread) so there is one
// business logic and two presentations.
//
// Mounted for the whole mobile session (hidden, not unmounted, when another
// tab is active) so the thread keeps its scroll position and the tab badge can
// show live unread counts. `active` = this tab is the visible one:
//   - only an ACTIVE visible tab marks the conversation read (server SSOT +
//     WhatsApp read receipt), exactly like the dock only marks while open;
//   - the unread badge reported up EXCLUDES the conversation currently being
//     read, and sums the rest (other contacts / other numbers).
export default function DealWhatsAppTab({
  subjectType,
  subjectId,
  active = false,
  onUnreadChange = null,
  onRequestShow = null,
}) {
  const {
    loading,
    chats,
    contacts,
    primaryContactId,
    activeContact,
    accounts,
    activeAccountId,
    activeAccount,
    activeChat,
    existingChat,
    chatByAccount,
    unreadByAccount,
    selectContact,
    selectAccount,
    adoptChat,
    openChat,
  } = useSubjectChats(subjectType, subjectId);

  // "Open the composer on this chat" (e.g. "שלח ללקוח → WhatsApp"): switch the
  // screen to this tab and land on the target chat once the list is loaded.
  const [pendingOpenChatId, setPendingOpenChatId] = useState(null);
  useEffect(() => {
    function onOpen(e) {
      if (e.detail?.subjectId && e.detail.subjectId !== subjectId) return;
      onRequestShow?.();
      if (e.detail?.chatId) setPendingOpenChatId(e.detail.chatId);
    }
    window.addEventListener(OPEN_WHATSAPP_COMPOSER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_WHATSAPP_COMPOSER_EVENT, onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId]);
  useEffect(() => {
    if (!pendingOpenChatId) return;
    if (openChat(pendingOpenChatId)) setPendingOpenChatId(null);
  }, [pendingOpenChatId, openChat]);

  // Reading the visible conversation marks it read — same cadence as the dock
  // (immediate + 10s re-mark while visible, final mark on leave).
  useEffect(() => {
    if (!active || !existingChat) return undefined;
    const chatId = existingChat.id;
    const markRead = () => api.whatsapp.markChatRead(chatId).catch(() => {});
    markRead();
    const t = setInterval(() => {
      if (!document.hidden) markRead();
    }, 10_000);
    return () => {
      clearInterval(t);
      markRead();
    };
  }, [active, existingChat?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tab badge = every conversation's unread EXCEPT the one being read right now.
  const unreadRef = useRef(onUnreadChange);
  unreadRef.current = onUnreadChange;
  useEffect(() => {
    const viewedId = active ? existingChat?.id : null;
    const sum = chats.reduce(
      (acc, c) => acc + (c.id === viewedId ? 0 : c.unreadCount || 0),
      0,
    );
    unreadRef.current?.(sum);
  }, [chats, active, existingChat?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* Identity header — who + from which of our numbers (chip). */}
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
        <WhatsAppLogo size={18} />
        <span className="min-w-0 truncate text-[13px] font-semibold text-gray-900">
          {activeContact?.name || 'WhatsApp'}
        </span>
        {activeAccount?.label && (
          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
            {activeAccount.label}
          </span>
        )}
      </div>

      {/* Contact selector — only when the deal has multiple contacts. */}
      {contacts.length > 1 && (
        <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto no-scrollbar border-b border-gray-100 px-3 py-1.5">
          {contacts.map((c) => {
            const isActive = activeContact && c.id === activeContact.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => selectContact(c.id)}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[12px] font-medium transition ${
                  isActive
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-gray-300 bg-white text-gray-600'
                }`}
              >
                {c.name}
                {c.id === primaryContactId && (
                  <span className={isActive ? 'text-emerald-100' : 'text-gray-400'}> ★</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Number selector — one bubble per connected number, always. */}
      <AccountBubbles
        accounts={accounts}
        activeId={activeAccountId}
        chatByAccount={chatByAccount}
        unreadByAccount={unreadByAccount}
        onSelect={selectAccount}
        className="shrink-0 border-b border-gray-100 px-3 py-1.5"
      />

      <div className="min-h-0 flex-1">
        {activeChat ? (
          <ChatThread
            key={chatTargetKey(activeChat)}
            chat={activeChat}
            fill
            dealId={subjectType === 'deal' ? subjectId : null}
            onMaterialized={adoptChat}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <WhatsAppLogo size={28} />
            {loading ? (
              <p className="text-[13px] text-gray-400">טוען…</p>
            ) : !activeContact ? (
              <>
                <p className="text-sm font-medium text-gray-700">אין אנשי קשר בדיל הזה</p>
                <p className="text-[12px] leading-relaxed text-gray-500">
                  הוסיפו איש קשר לדיל כדי לנהל איתו שיחת WhatsApp.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-gray-700">אין מספר WhatsApp מחובר</p>
                <p className="text-[12px] leading-relaxed text-gray-500">
                  חברו מספר בהגדרות ← תקשורת כדי לשלוח הודעות.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
