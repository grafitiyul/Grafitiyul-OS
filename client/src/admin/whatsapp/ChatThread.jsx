import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import MessageBubble from './MessageBubble.jsx';
import ChatComposer from './ChatComposer.jsx';
import ScheduledStrip from './ScheduledStrip.jsx';

// Read view of one WhatsApp chat — the single thread component every surface
// (Deal tab, Contact page, future inbox) mounts. Messages come from the GOS
// mirror API newest-first with keyset paging; we render ascending with date
// separators, WhatsApp-style bubbles and smart scrolling:
//   - stick to the bottom while the reader is at the bottom (new messages
//     scroll into view), but never yank the view while they read history
//   - scrolling near the top loads the previous page and PRESERVES the
//     reader's position (no jump)
// Real-time = polling (project decision, no websockets): 7s while the tab is
// visible, paused when hidden.

const POLL_MS = 7000;

function tsOf(m) {
  return m.timestampFromSource ? new Date(m.timestampFromSource).getTime() : 0;
}

function mergeMessages(current, incoming) {
  const map = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return [...map.values()].sort((a, b) => tsOf(a) - tsOf(b) || (a.id < b.id ? -1 : 1));
}

function dayKey(m) {
  const d = new Date(m.timestampFromSource || 0);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(m) {
  const d = new Date(m.timestampFromSource || 0);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const same = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return 'היום';
  if (same(d, yesterday)) return 'אתמול';
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function ChatThread({ chat, heightClass = 'h-[26rem]', canSend = true, fill = false }) {
  const [messages, setMessages] = useState(null); // ascending, null = loading
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  // Bumped after a successful send → the poll effect re-runs immediately.
  const [refreshNonce, setRefreshNonce] = useState(0);
  // Bumped after scheduling/cancelling → the scheduled strip reloads.
  const [scheduledNonce, setScheduledNonce] = useState(0);
  const containerRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);
  // Set right before a prepend: the scrollHeight to restore relative to.
  const prependAnchorRef = useRef(null);

  // Quoted-message lookup for reply rendering (only among loaded messages).
  const byExternalId = useMemo(() => {
    const map = new Map();
    for (const m of messages || []) if (m.externalMessageId) map.set(m.externalMessageId, m);
    return map;
  }, [messages]);

  // Initial load + polling. Chat switch remounts (key=chat.id in the panel).
  // Hidden tab = skip the fetch, keep the schedule.
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    async function tick(first) {
      if (!first && document.hidden) {
        timer = setTimeout(() => tick(false), POLL_MS);
        return;
      }
      try {
        const page = await api.whatsapp.chatMessages(chat.id, { limit: 50 });
        if (cancelled) return;
        setMessages((cur) => mergeMessages(cur || [], page.messages));
        if (first) setHasMore(page.hasMore);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e?.payload?.error || e?.message || 'failed');
      }
      if (!cancelled) timer = setTimeout(() => tick(false), POLL_MS);
    }
    tick(true);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [chat.id, refreshNonce]);

  async function loadOlder() {
    if (loadingOlderRef.current || !hasMore || !messages?.length) return;
    loadingOlderRef.current = true;
    try {
      const oldest = messages[0];
      const page = await api.whatsapp.chatMessages(chat.id, {
        limit: 50,
        before: oldest.timestampFromSource,
      });
      const el = containerRef.current;
      prependAnchorRef.current = el ? el.scrollHeight - el.scrollTop : null;
      setMessages((cur) => mergeMessages(cur || [], page.messages));
      setHasMore(page.hasMore);
    } catch {
      /* transient — the reader can scroll again */
    } finally {
      loadingOlderRef.current = false;
    }
  }

  function onScroll() {
    const el = containerRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 80) loadOlder();
  }

  // After every render caused by a messages change: restore the reader's
  // anchor after a prepend, otherwise follow the bottom if they were there.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || messages === null) return;
    if (prependAnchorRef.current != null) {
      el.scrollTop = el.scrollHeight - prependAnchorRef.current;
      prependAnchorRef.current = null;
    } else if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const isGroup = chat.type === 'group';

  return (
    <div className={`flex flex-col overflow-hidden bg-[#efeae2] ${fill ? 'h-full min-h-0' : 'rounded-xl border border-gray-200'}`}>
      <div
        ref={containerRef}
        onScroll={onScroll}
        className={`flex-1 overflow-y-auto px-3 py-3 ${fill ? 'min-h-0' : heightClass}`}
      >
        {messages === null ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            טוען הודעות…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            אין עדיין הודעות בשיחה הזו.
          </div>
        ) : (
          <>
            {hasMore && (
              <div className="mb-2 text-center">
                <button
                  type="button"
                  onClick={loadOlder}
                  className="rounded-full bg-white/80 px-3 py-1 text-[12px] text-gray-600 shadow-sm hover:bg-white"
                >
                  טען הודעות קודמות
                </button>
              </div>
            )}
            {messages.map((m, i) => {
              const newDay = i === 0 || dayKey(m) !== dayKey(messages[i - 1]);
              return (
                <div key={m.id}>
                  {newDay && (
                    <div className="my-3 flex justify-center">
                      <span className="rounded-lg bg-white/90 px-3 py-1 text-[11px] font-medium text-gray-500 shadow-sm">
                        {dayLabel(m)}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    message={m}
                    showSender={isGroup && m.direction === 'incoming'}
                    quoted={m.quotedExternalId ? byExternalId.get(m.quotedExternalId) : null}
                    onReply={canSend ? () => setReplyTo(m) : null}
                  />
                </div>
              );
            })}
          </>
        )}
      </div>
      {error && (
        <p className="border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] text-amber-800">
          בעיה זמנית בטעינת הודעות — מנסים שוב…
        </p>
      )}
      {canSend && (
        <>
          <ScheduledStrip chat={chat} nonce={scheduledNonce} />
          <ChatComposer
            chat={chat}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onSent={(message) => {
              stickToBottomRef.current = true;
              if (message) setMessages((cur) => mergeMessages(cur || [], [message]));
              setRefreshNonce((n) => n + 1);
            }}
            onScheduled={() => setScheduledNonce((n) => n + 1)}
          />
        </>
      )}
    </div>
  );
}
