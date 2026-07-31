import { useContext, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import WhatsAppLogo from '../common/WhatsAppLogo.jsx';
import ChatThread from './ChatThread.jsx';
import AccountBubbles from './AccountBubbles.jsx';
import { useSubjectChats } from './useSubjectChats.js';
import { OPEN_WHATSAPP_COMPOSER_EVENT } from './composerEvents.js';
import { WorkspaceSeamContext } from '../../shell/WorkspaceLayout.jsx';

// Floating WhatsApp dock for the Deal page. Rendered through WorkspaceLayout's
// `seamLeft` slot, so the closed bubble sits in the empty gap between the deal
// center area and the sales-script panel, aligned with the deal header row —
// not inside the header, not on top of the script. The open panel is a fixed
// overlay (may cover the script), horizontally RESIZABLE by dragging its
// center-facing edge; the chosen width persists globally across deals.
//
// Unread badge: the SUM of the server's canonical per-chat unreadCount (one
// read model shared with the inbox — no per-device markers). Opening the popup
// marks the visible conversation read (server SSOT + WhatsApp read receipt).
//
// TWO switchers, two questions, in the order an operator asks them:
//   contacts — WHO (the deal's people; a contact with no thread still gets a
//              bubble). Conversations are per-contact and never merged.
//   numbers  — FROM WHICH OF OUR NUMBERS (AccountBubbles). Every connected
//              number is present, including ones this contact has never been
//              written to from; picking such a bubble opens that conversation
//              on the spot.
// Both live in useSubjectChats, which is also what the Deal's template modal
// uses — one selection model, one panel, no duplicated send path. Everything
// below the switchers (thread, composer, scheduling, media, templates) is
// keyed on the resolved chat, so switching number switches every action with
// it automatically.

const WIDTH_KEY = 'gos-whatsapp-dock'; // { width } — global, not per-deal
const MIN_W = 380;
const MAX_W = 760;

function readJson(key, fallback) {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') };
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

// The closed bubble's badge: every conversation's unread EXCEPT the ones this
// dock has already marked read and not yet re-read from the server.
function unreadForClosedBubble(chats, readIds) {
  return chats.reduce((sum, c) => sum + (readIds.has(c.id) ? 0 : c.unreadCount || 0), 0);
}

const START_ERRORS = {
  contact_has_no_phone: 'לאיש הקשר הזה אין מספר טלפון שמור, ולכן אי אפשר לפתוח ממנו שיחה. הוסיפו מספר בכרטיס איש הקשר.',
  unknown_account: 'המספר הזה כבר לא פעיל במערכת.',
};

export default function WhatsAppDock({ subjectType, subjectId }) {
  const [open, setOpen] = useState(false);
  // Chats this dock has already marked read but whose server count may not have
  // been re-read yet. Scoped PER CHAT, never a blanket "unread = 0": with
  // several conversations open on a deal, clearing the whole badge because ONE
  // of them was read hides real unread messages on the others.
  const [readIds, setReadIds] = useState(() => new Set());
  const [width, setWidth] = useState(() => {
    const w = Number(readJson(WIDTH_KEY, {}).width);
    return Number.isFinite(w) && w >= MIN_W && w <= MAX_W ? w : 440;
  });
  const draggingRef = useRef(false);
  // The chat the popup was last showing — what closing reconciles against.
  const lastViewedRef = useRef(null);
  // A generic "open composer on this chat" request (e.g. from "שלח ללקוח →
  // WhatsApp"); applied once the chat list is loaded.
  const [pendingOpenChatId, setPendingOpenChatId] = useState(null);

  const {
    chats,
    contacts,
    primaryContactId,
    activeContact,
    accounts,
    activeAccountId,
    activeAccount,
    activeChat,
    chatByAccount,
    unreadByAccount,
    starting,
    startError,
    selectContact,
    selectAccount,
    startConversation,
    openChat,
    reload,
  } = useSubjectChats(subjectType, subjectId);

  // Report the open panel's width to the hosting WorkspaceLayout so the
  // center workspace moves aside instead of being covered when the left panel
  // is collapsed. `animate: false` while drag-resizing — the workspace must
  // track the handle 1:1, and ease only on open/close. Null-safe: the dock
  // may render outside a WorkspaceLayout.
  const seam = useContext(WorkspaceSeamContext) || null;
  const setSeamOverlay = seam?.setSeamOverlay;
  useEffect(() => {
    if (!setSeamOverlay) return undefined;
    setSeamOverlay({ width: open ? width : 0, animate: !draggingRef.current });
    return () => setSeamOverlay({ width: 0, animate: true });
  }, [setSeamOverlay, open, width]);

  // Open-composer signal: open the dock and remember which chat to focus. The
  // draft text is seeded by the caller through the shared draft store, which
  // ChatComposer reads on mount — so this reuses the real composer/send flow.
  useEffect(() => {
    function onOpen(e) {
      if (e.detail?.subjectId && e.detail.subjectId !== subjectId) return;
      setOpen(true);
      if (e.detail?.chatId) setPendingOpenChatId(e.detail.chatId);
    }
    window.addEventListener(OPEN_WHATSAPP_COMPOSER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_WHATSAPP_COMPOSER_EVENT, onOpen);
  }, [subjectId]);

  // Apply a pending "open on this chat" request once the chat list is loaded:
  // selects both the contact and the number, so the thread mounts on it (and
  // its composer reads the seeded draft).
  useEffect(() => {
    if (!pendingOpenChatId) return;
    if (openChat(pendingOpenChatId)) setPendingOpenChatId(null);
  }, [pendingOpenChatId, openChat]);

  // Reading the conversation marks it read on the server (SSOT) and pushes a
  // WhatsApp read receipt. Mark on open/switch and periodically while the popup
  // stays open on it (a newer inbound message re-marks read). The badge is for
  // the CLOSED bubble, so clear it optimistically too.
  useEffect(() => {
    if (!open || !activeChat) return undefined;
    const chatId = activeChat.id;
    const markRead = () => api.whatsapp.markChatRead(chatId).catch(() => {});
    markRead();
    lastViewedRef.current = chatId;
    setReadIds((cur) => new Set(cur).add(chatId));
    const t = setInterval(() => {
      if (!document.hidden) markRead();
    }, 10_000);
    return () => {
      clearInterval(t);
      markRead();
    };
  }, [open, activeChat?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Closing hands the badge back to the server. The order matters: mark the
  // last-viewed chat read, THEN re-read the list, THEN drop the optimistic set.
  // Reloading in parallel could read the count back before the mark landed and
  // then clear the optimism on top of a stale number — a phantom badge until
  // the next poll.
  const everOpenedRef = useRef(false);
  useEffect(() => {
    if (open) {
      everOpenedRef.current = true;
      return undefined;
    }
    if (!everOpenedRef.current) return undefined; // never opened — nothing to reconcile
    let cancelled = false;
    const id = lastViewedRef.current;
    (id ? api.whatsapp.markChatRead(id).catch(() => {}) : Promise.resolve())
      .then(() => reload())
      .then(() => {
        if (!cancelled) setReadIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [open, reload]);

  const unread = unreadForClosedBubble(chats, readIds);

  // Drag-to-resize: the panel is anchored at the viewport's LEFT edge, so
  // width follows the pointer's clientX. Persisted globally on release.
  useEffect(() => {
    function onMove(e) {
      if (!draggingRef.current) return;
      const w = Math.max(MIN_W, Math.min(MAX_W, e.clientX - 16));
      setWidth(w);
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setWidth((w) => {
        writeJson(WIDTH_KEY, { width: w });
        return w;
      });
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  const badge = unread > 99 ? '99+' : String(unread);
  const accountLabel = activeAccount?.label || activeAccountId || '';

  const bubble = (positionClass) => (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      title="WhatsApp"
      aria-label={unread > 0 ? `WhatsApp — ${unread} הודעות חדשות` : 'WhatsApp'}
      aria-expanded={open}
      className={`${positionClass} h-11 w-11 items-center justify-center rounded-full shadow-lg ring-1 transition hover:scale-105 ${
        open ? 'bg-emerald-600 ring-emerald-700' : 'bg-white ring-gray-200'
      }`}
    >
      {open ? <span className="text-xl text-white">×</span> : <WhatsAppLogo size={24} />}
      {!open && unread > 0 && (
        <span
          dir="ltr"
          className="absolute -top-2 -left-2 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[12px] font-bold leading-none text-white shadow-sm ring-2 ring-white"
        >
          {badge}
        </span>
      )}
    </button>
  );

  // What fills the body when the selected number has no conversation with this
  // contact. Never a dead end: either it is being opened, or there is one
  // button that opens it, or we say plainly why it cannot be opened.
  function emptyBody() {
    if (starting) {
      return <p className="text-[13px] text-gray-500">פותח שיחה מ{accountLabel}…</p>;
    }
    if (!activeContact) {
      return (
        <>
          <p className="text-sm font-medium text-gray-700">אין אנשי קשר בדיל הזה</p>
          <p className="text-[12px] leading-relaxed text-gray-500">
            הוסיפו איש קשר לדיל כדי לנהל איתו שיחת WhatsApp.
          </p>
        </>
      );
    }
    if (startError) {
      return (
        <>
          <p className="text-[13px] leading-relaxed text-red-700">
            {START_ERRORS[startError] || 'פתיחת השיחה נכשלה — נסו שוב.'}
          </p>
          {!START_ERRORS[startError] && (
            <button
              type="button"
              onClick={() => startConversation(activeAccountId)}
              className="rounded-xl bg-emerald-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-emerald-700"
            >
              נסו שוב
            </button>
          )}
        </>
      );
    }
    if (activeAccount?.retired) {
      return (
        <p className="text-[12.5px] leading-relaxed text-gray-500">
          {accountLabel} כבר לא מחובר למערכת — אפשר לקרוא היסטוריה קיימת, אך לא לפתוח ממנו שיחה חדשה.
        </p>
      );
    }
    return (
      <>
        <p className="text-sm font-medium text-gray-700">
          עדיין אין שיחה עם {activeContact.name} מ{accountLabel}
        </p>
        <p className="text-[12px] leading-relaxed text-gray-500">
          אפשר לפתוח שיחה חדשה מהמספר הזה — ההודעה הראשונה תישלח ממנו.
        </p>
        <button
          type="button"
          onClick={() => startConversation(activeAccountId)}
          className="mt-1 rounded-xl bg-emerald-600 px-4 py-1.5 text-[13px] font-semibold text-white transition hover:bg-emerald-700"
        >
          התחלת שיחה מ{accountLabel}
        </button>
      </>
    );
  }

  return (
    <>
      {/* Desktop: in the content's left gutter, nudged 16px past the content
          edge so it clears the header's 3-dot actions (the sticky seam
          wrapper keeps it visible while scrolling). Mobile: fixed
          bottom-left fallback. */}
      {bubble('hidden lg:flex absolute top-0 -left-4 z-40')}
      {bubble('flex lg:hidden fixed bottom-5 left-4 z-40')}

      {open && (
        <div
          style={{ width }}
          className="fixed bottom-4 left-4 top-24 z-40 flex max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
        >
          {/* Resize handle — the center-facing edge. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="שינוי רוחב הצ'אט"
            onMouseDown={() => {
              draggingRef.current = true;
              document.body.style.userSelect = 'none';
              document.body.style.cursor = 'col-resize';
            }}
            className="absolute bottom-0 right-0 top-0 z-10 w-1.5 cursor-col-resize hover:bg-emerald-400/60"
          />

          {/* Header — the active NUMBER is a chip, not a footnote: with several
              numbers connected, "which one am I in" must be readable at a
              glance even when the bubble row is scrolled. */}
          <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
            <WhatsAppLogo size={18} />
            {activeContact && (
              <span className="min-w-0 truncate text-[13px] font-semibold text-gray-900">
                {activeContact.name}
              </span>
            )}
            {accountLabel && (
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
                {accountLabel}
              </span>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="סגירה"
              className="mr-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              ×
            </button>
          </div>

          {/* Contact selector — only when the deal has multiple contacts. */}
          {contacts.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto border-b border-gray-100 px-3 py-1.5">
              {contacts.map((c) => {
                const active = activeContact && c.id === activeContact.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectContact(c.id)}
                    className={`whitespace-nowrap rounded-full border px-3 py-1 text-[12px] font-medium transition ${
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

          {/* Number selector — one bubble per connected number, always. */}
          <AccountBubbles
            accounts={accounts}
            activeId={activeAccountId}
            chatByAccount={chatByAccount}
            unreadByAccount={unreadByAccount}
            busyId={starting}
            onSelect={selectAccount}
            className="border-b border-gray-100 px-3 py-1.5"
          />

          {/* Body */}
          <div className="min-h-0 flex-1">
            {activeChat ? (
              <ChatThread
                key={activeChat.id}
                chat={activeChat}
                fill
                dealId={subjectType === 'deal' ? subjectId : null}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <WhatsAppLogo size={28} />
                {emptyBody()}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
