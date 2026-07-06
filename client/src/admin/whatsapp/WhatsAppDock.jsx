import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import WhatsAppLogo from '../common/WhatsAppLogo.jsx';
import ChatThread from './ChatThread.jsx';
import { ensureSeen, markSeen } from './seenStore.js';

// Floating WhatsApp dock for the Deal page. Rendered through WorkspaceLayout's
// `seamLeft` slot, so the closed bubble sits in the empty gap between the deal
// center area and the sales-script panel, aligned with the deal header row —
// not inside the header, not on top of the script. The open panel is a fixed
// overlay (may cover the script), horizontally RESIZABLE by dragging its
// center-facing edge; the chosen width persists globally across deals.
//
// Unread badge: derived from the SHARED seen-store (seenStore.js — the same
// per-chat "last seen" markers the inbox uses; no duplicate unread system);
// the count is the store's incoming messages after each marker. Opening the
// popup marks the visible conversation read.
//
// Contact model (user spec): default to the Deal's PRIMARY contact; a compact
// selector switches between the deal's linked contacts inside the same popup.
// Conversations are per-contact and never merged.

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

export default function WhatsAppDock({ subjectType, subjectId }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null); // { chats, primaryContactId }
  const [contactSel, setContactSel] = useState(null);
  const [chatSel, setChatSel] = useState(null);
  const [unread, setUnread] = useState(0);
  const [width, setWidth] = useState(() => {
    const w = Number(readJson(WIDTH_KEY, {}).width);
    return Number.isFinite(w) && w >= MIN_W && w <= MAX_W ? w : 440;
  });
  const draggingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await api.whatsapp.contextChats(subjectType, subjectId);
      setData(d);
      return d;
    } catch {
      return null;
    }
  }, [subjectType, subjectId]);

  // Unread = incoming messages newer than each chat's last-seen marker. A
  // chat we've never seen gets its marker initialized to NOW (history isn't
  // "unread"); only messages arriving after that count.
  const computeUnread = useCallback(async (d) => {
    const chats = d?.chats || [];
    // First sight initializes markers to NOW (history isn't "unread").
    const seen = ensureSeen(chats.map((c) => c.id));
    let total = 0;
    for (const chat of chats) {
      if (!seen[chat.id] || !chat.lastMessageAt || chat.lastMessageAt <= seen[chat.id]) continue;
      try {
        const { count } = await api.whatsapp.chatMessages(chat.id, { after: seen[chat.id], count: 1 });
        total += count || 0;
      } catch {
        /* transient — next poll recounts */
      }
    }
    setUnread(total);
  }, []);

  // Load + poll the chat list. While CLOSED the poll only feeds the badge;
  // while OPEN it also keeps the selector fresh (the thread polls itself).
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const d = await load();
      if (!cancelled && d) await computeUnread(d);
    }
    refresh();
    const t = setInterval(() => {
      if (!document.hidden) refresh();
    }, 45_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [load, computeUnread]);

  // Contact tabs come from the DEAL'S contact list (server), so a contact
  // with no WhatsApp thread yet still gets a tab (with an empty state) — and
  // adding/removing deal contacts updates the tabs on the next refresh.
  // Fallback to chat-derived grouping when the server sends no contacts.
  const contacts = useMemo(() => {
    const chats = data?.chats || [];
    if (data?.contacts?.length) {
      return data.contacts.map((c) => ({
        ...c,
        chats: chats.filter((chat) => (chat.contact?.id || chat.contactId) === c.id),
      }));
    }
    const map = new Map();
    for (const c of chats) {
      const key = c.contact?.id || c.contactId || c.id;
      if (!map.has(key)) {
        map.set(key, { id: key, name: c.contact?.name || c.displayName || 'לא מזוהה', chats: [] });
      }
      map.get(key).chats.push(c);
    }
    return [...map.values()];
  }, [data]);

  const activeContact =
    contacts.find((c) => c.id === contactSel) ||
    contacts.find((c) => c.id === data?.primaryContactId) ||
    contacts[0] ||
    null;
  const activeChat =
    activeContact?.chats.find((c) => c.id === chatSel) || activeContact?.chats[0] || null;

  // Reading the conversation = seen. Mark on open/switch and keep marking
  // while the popup stays open on it (the badge is for the CLOSED bubble).
  useEffect(() => {
    if (!open || !activeChat) return undefined;
    markSeen(activeChat.id);
    setUnread(0);
    const t = setInterval(() => {
      if (!document.hidden) markSeen(activeChat.id);
    }, 10_000);
    return () => {
      clearInterval(t);
      markSeen(activeChat.id);
    };
  }, [open, activeChat?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

          {/* Header */}
          <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
            <WhatsAppLogo size={18} />
            <span className="text-[13px] font-semibold text-gray-900">WhatsApp</span>
            {activeContact && (
              <span className="min-w-0 truncate text-[12px] text-gray-500">
                · {activeContact.name}
                {activeChat?.account?.label ? ` · ${activeChat.account.label}` : ''}
              </span>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="סגירה"
              className="mr-auto flex h-7 w-7 items-center justify-center rounded-full text-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
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
                    onClick={() => {
                      setContactSel(c.id);
                      setChatSel(null);
                    }}
                    className={`whitespace-nowrap rounded-full border px-3 py-1 text-[12px] font-medium transition ${
                      active
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {c.name}
                    {c.id === data?.primaryContactId && (
                      <span className={active ? 'text-emerald-100' : 'text-gray-400'}> ★</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Same contact on more than one of our numbers → number switcher. */}
          {activeContact && activeContact.chats.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto border-b border-gray-100 px-3 py-1.5">
              {activeContact.chats.map((c) => {
                const active = activeChat && c.id === activeChat.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setChatSel(c.id)}
                    className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                      active
                        ? 'border-gray-700 bg-gray-700 text-white'
                        : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {c.account?.label || c.accountId}
                  </button>
                );
              })}
            </div>
          )}

          {/* Body */}
          <div className="min-h-0 flex-1">
            {activeChat ? (
              <ChatThread key={activeChat.id} chat={activeChat} fill />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <WhatsAppLogo size={28} />
                <p className="text-sm font-medium text-gray-700">
                  {activeContact ? `עדיין אין שיחת WhatsApp עם ${activeContact.name}` : 'אין שיחת WhatsApp מקושרת'}
                </p>
                <p className="text-[12px] leading-relaxed text-gray-500">
                  שיחות מתקשרות אוטומטית לפי מספר הטלפון של אנשי הקשר בדיל.
                  ברגע שתתקיים שיחה — היא תופיע כאן.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
