import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import MessageBubble from './MessageBubble.jsx';
import ChatComposer from './ChatComposer.jsx';
import ScheduledStrip from './ScheduledStrip.jsx';

// Read view of one WhatsApp chat — the single thread component EVERY surface
// mounts (inbox, Deal dock, Contact/Org panels): any feature added here is
// automatically shared. Messages come from the GOS mirror API newest-first
// with keyset paging; we render ascending with date separators, WhatsApp-style
// bubbles and smart scrolling:
//   - stick to the bottom while the reader is at the bottom (new messages
//     scroll into view), but never yank the view while they read history
//   - scrolling near the top loads the previous page and PRESERVES the
//     reader's position (no jump)
// Real-time = polling (project decision, no websockets): 7s while the tab is
// visible, paused when hidden.
//
// Two modes:
//   'live' — the normal view: latest window + polling.
//   'jump' — entered from search / jump-to-date / starred: the window is
//            anchored at an old message; polling pauses (merging "latest 50"
//            into an old window would hide a gap between them). Scrolling
//            down loads FORWARD pages; reaching the present switches back to
//            live seamlessly (the window is contiguous, so no gap).

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

function fmtResultWhen(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('he-IL', {
      day: 'numeric',
      month: 'numeric',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function resultSnippet(m) {
  if (m.textContent) return m.textContent.slice(0, 90);
  return { image: '📷 תמונה', video: '🎬 סרטון', audio: '🎤 הודעה קולית', document: '📄 מסמך', sticker: 'סטיקר' }[m.messageType] || 'הודעה';
}

// One row in the search / starred result lists — click jumps to the message.
function ResultRow({ m, onPick }) {
  return (
    <button
      type="button"
      onClick={() => onPick(m)}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-right hover:bg-gray-100"
    >
      <span className="shrink-0 text-[11px] text-gray-400" dir="ltr">{fmtResultWhen(m.timestampFromSource)}</span>
      <span className="shrink-0 text-[11px] font-semibold text-gray-500">
        {m.direction === 'outgoing' ? 'אני:' : ''}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-gray-700" dir="auto">
        {resultSnippet(m)}
      </span>
      {m.starred && <span className="shrink-0 text-[11px] text-amber-500">★</span>}
    </button>
  );
}

function ToolButton({ onClick, title, active, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded-lg text-[14px] transition ${
        active ? 'bg-emerald-100 text-emerald-800' : 'text-gray-500 hover:bg-white hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  );
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
  // Drag&drop anywhere on the thread attaches the file(s) in the composer.
  const [dragOver, setDragOver] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState(null);
  // 'live' | 'jump' — see the header comment.
  const [mode, setMode] = useState('live');
  const [highlightId, setHighlightId] = useState(null);
  // Toolbar panel: null | 'search' | 'date' | 'starred'
  const [panel, setPanel] = useState(null);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [starredList, setStarredList] = useState(null);
  const [jumpDate, setJumpDate] = useState('');
  const containerRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const loadingNewerRef = useRef(false);
  const hasMoreNewerRef = useRef(false);
  // Set right before a prepend: the scrollHeight to restore relative to.
  const prependAnchorRef = useRef(null);
  // Message id to center after the next messages render (jump landing).
  const pendingScrollRef = useRef(null);
  const highlightTimerRef = useRef(null);

  // Quoted-message lookup for reply rendering (only among loaded messages).
  const byExternalId = useMemo(() => {
    const map = new Map();
    for (const m of messages || []) if (m.externalMessageId) map.set(m.externalMessageId, m);
    return map;
  }, [messages]);

  // Initial load + polling — LIVE mode only. Chat switch remounts
  // (key=chat.id in the panel). Hidden tab = skip the fetch, keep the schedule.
  useEffect(() => {
    if (mode !== 'live') return undefined;
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
        if (first) setHasMore((cur) => cur || page.hasMore);
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
  }, [chat.id, refreshNonce, mode]);

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

  // Forward fill while in jump mode. Reaching the present (no more newer
  // pages) switches back to live — the window is contiguous, so the poll can
  // safely merge the latest page on top of it.
  async function loadNewer() {
    if (loadingNewerRef.current || !hasMoreNewerRef.current || !messages?.length) return;
    loadingNewerRef.current = true;
    try {
      const newest = messages[messages.length - 1];
      const page = await api.whatsapp.chatMessages(chat.id, {
        limit: 50,
        after: newest.timestampFromSource,
      });
      setMessages((cur) => mergeMessages(cur || [], page.messages));
      if (!page.hasMore) {
        hasMoreNewerRef.current = false;
        setMode('live');
      }
    } catch {
      /* transient */
    } finally {
      loadingNewerRef.current = false;
    }
  }

  function onScroll() {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickToBottomRef.current = mode === 'live' && nearBottom;
    if (el.scrollTop < 80) loadOlder();
    if (mode === 'jump' && nearBottom) loadNewer();
  }

  // After every render caused by a messages change: land a pending jump,
  // else restore the reader's anchor after a prepend, else follow the bottom.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || messages === null) return;
    if (pendingScrollRef.current != null) {
      const target = el.querySelector(`[data-mid="${pendingScrollRef.current}"]`);
      if (target) {
        target.scrollIntoView({ block: 'center' });
        pendingScrollRef.current = null;
      }
    } else if (prependAnchorRef.current != null) {
      el.scrollTop = el.scrollHeight - prependAnchorRef.current;
      prependAnchorRef.current = null;
    } else if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  useEffect(() => () => clearTimeout(highlightTimerRef.current), []);

  // Enter jump mode anchored at one message: load the window ENDING at it
  // (before = its timestamp + 1ms, so the anchor is included), highlight it.
  async function jumpTo(m) {
    setPanel(null);
    setError(null);
    stickToBottomRef.current = false;
    try {
      const anchorEnd = new Date(tsOf(m) + 1).toISOString();
      const page = await api.whatsapp.chatMessages(chat.id, { limit: 50, before: anchorEnd });
      hasMoreNewerRef.current = true;
      // Date jumps pass a synthetic anchor without an id — land on the last
      // message of that day (the newest row in the page) instead.
      const anchorId = m.id ?? page.messages[0]?.id ?? null;
      pendingScrollRef.current = anchorId;
      setMode('jump');
      setMessages(mergeMessages([], page.messages));
      setHasMore(page.hasMore);
      setHighlightId(m.id ? anchorId : null);
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => setHighlightId(null), 2600);
    } catch {
      setError('failed');
    }
  }

  function backToPresent() {
    hasMoreNewerRef.current = false;
    stickToBottomRef.current = true;
    setMessages(null);
    setHasMore(false);
    setMode('live');
    setRefreshNonce((n) => n + 1);
  }

  // Search inside the conversation (server-side, debounced).
  useEffect(() => {
    if (panel !== 'search') return undefined;
    const q = searchQ.trim();
    if (!q) {
      setSearchResults(null);
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        const page = await api.whatsapp.chatMessages(chat.id, { search: q, limit: 30 });
        setSearchResults(page.messages);
      } catch {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [panel, searchQ, chat.id]);

  // Starred panel loads fresh on open.
  useEffect(() => {
    if (panel !== 'starred') return;
    setStarredList(null);
    api.whatsapp
      .chatStarred(chat.id)
      .then((d) => setStarredList(d.messages))
      .catch(() => setStarredList([]));
  }, [panel, chat.id]);

  async function toggleStar(m) {
    const next = !m.starred;
    // Optimistic — revert on failure.
    setMessages((cur) => (cur || []).map((x) => (x.id === m.id ? { ...x, starred: next } : x)));
    setStarredList((cur) => (cur ? cur.filter((x) => next || x.id !== m.id) : cur));
    try {
      await api.whatsapp.starMessage(m.id, next);
    } catch {
      setMessages((cur) => (cur || []).map((x) => (x.id === m.id ? { ...x, starred: !next } : x)));
    }
  }

  function jumpToDate() {
    if (!jumpDate) return;
    const end = new Date(`${jumpDate}T23:59:59.999`);
    if (Number.isNaN(end.getTime())) return;
    // Anchor = a synthetic "message" at the end of that day; jump loads the
    // window ending there. Landing centers the last message of the day.
    jumpTo({ id: null, timestampFromSource: end.toISOString() });
  }

  const isGroup = chat.type === 'group';

  return (
    <div
      className={`relative flex flex-col overflow-hidden bg-[#efeae2] ${fill ? 'h-full min-h-0' : 'rounded-xl border border-gray-200'}`}
      onDragOver={(e) => {
        if (canSend && e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!canSend) return;
        e.preventDefault();
        setDragOver(false);
        const files = [...(e.dataTransfer?.files || [])];
        if (files.length) setDroppedFiles(files);
      }}
    >
      {dragOver && canSend && (
        <div className="pointer-events-none absolute inset-1.5 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-emerald-500 bg-emerald-500/10">
          <span className="rounded-full bg-white/95 px-4 py-2 text-[13px] font-semibold text-emerald-700 shadow-sm">
            📎 שחררו כאן כדי לצרף את הקבצים
          </span>
        </div>
      )}

      {/* Thread toolbar — search / jump to date / starred. Shared by every
          surface because it lives in the thread itself. */}
      <div className="flex items-center gap-1 border-b border-black/5 bg-[#f0f2f5] px-2 py-1">
        <ToolButton title="חיפוש בשיחה" active={panel === 'search'} onClick={() => setPanel(panel === 'search' ? null : 'search')}>
          🔍
        </ToolButton>
        <ToolButton title="מעבר לתאריך" active={panel === 'date'} onClick={() => setPanel(panel === 'date' ? null : 'date')}>
          📅
        </ToolButton>
        <ToolButton title="הודעות מסומנות בכוכב" active={panel === 'starred'} onClick={() => setPanel(panel === 'starred' ? null : 'starred')}>
          ⭐
        </ToolButton>
        {mode === 'jump' && (
          <button
            type="button"
            onClick={backToPresent}
            className="mr-auto rounded-full bg-emerald-600 px-3 py-0.5 text-[11.5px] font-semibold text-white hover:bg-emerald-700"
          >
            ↓ חזרה להודעות האחרונות
          </button>
        )}
      </div>

      {panel === 'search' && (
        <div className="border-b border-black/5 bg-white px-2.5 py-2">
          <input
            autoFocus
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setPanel(null)}
            placeholder="חיפוש בשיחה…"
            dir="auto"
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] focus:border-emerald-500 focus:outline-none"
          />
          {searchResults !== null && (
            <div className="mt-1.5 max-h-52 overflow-y-auto">
              {searchResults.length === 0 ? (
                <p className="px-2 py-2 text-center text-[12px] text-gray-400">אין תוצאות</p>
              ) : (
                searchResults.map((m) => <ResultRow key={m.id} m={m} onPick={jumpTo} />)
              )}
            </div>
          )}
        </div>
      )}

      {panel === 'date' && (
        <div className="flex items-center gap-2 border-b border-black/5 bg-white px-2.5 py-2">
          <span className="text-[12px] text-gray-600">מעבר לתאריך:</span>
          <input
            type="date"
            value={jumpDate}
            onChange={(e) => setJumpDate(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-[13px]"
          />
          <button
            type="button"
            disabled={!jumpDate}
            onClick={jumpToDate}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            מעבר
          </button>
        </div>
      )}

      {panel === 'starred' && (
        <div className="border-b border-black/5 bg-white px-2.5 py-2">
          {starredList === null ? (
            <p className="px-2 py-2 text-center text-[12px] text-gray-400">טוען…</p>
          ) : starredList.length === 0 ? (
            <p className="px-2 py-2 text-center text-[12px] text-gray-400">
              אין הודעות מסומנות — ריחוף על הודעה ← ☆ מסמן אותה.
            </p>
          ) : (
            <div className="max-h-52 overflow-y-auto">
              {starredList.map((m) => <ResultRow key={m.id} m={m} onPick={jumpTo} />)}
            </div>
          )}
        </div>
      )}

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
                <div
                  key={m.id}
                  data-mid={m.id}
                  className={`rounded-xl transition-colors duration-700 ${
                    highlightId === m.id ? 'bg-amber-200/50' : ''
                  }`}
                >
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
                    onToggleStar={toggleStar}
                  />
                </div>
              );
            })}
            {mode === 'jump' && (
              <div className="my-2 text-center">
                <button
                  type="button"
                  onClick={loadNewer}
                  className="rounded-full bg-white/80 px-3 py-1 text-[12px] text-gray-600 shadow-sm hover:bg-white"
                >
                  טען הודעות חדשות יותר ↓
                </button>
              </div>
            )}
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
              if (mode !== 'live') {
                // Sending from an old window: reload the present cleanly
                // instead of merging into a window with a hidden gap.
                backToPresent();
                return;
              }
              stickToBottomRef.current = true;
              if (message) setMessages((cur) => mergeMessages(cur || [], [message]));
              setRefreshNonce((n) => n + 1);
            }}
            onScheduled={() => setScheduledNonce((n) => n + 1)}
            droppedFiles={droppedFiles}
            onDroppedFilesConsumed={() => setDroppedFiles(null)}
          />
        </>
      )}
    </div>
  );
}
