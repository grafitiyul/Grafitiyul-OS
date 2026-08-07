// The "לא נקרא" filter's membership model.
//
// The defect this replaces: the filter was a live predicate over the loaded
// chats, so opening a conversation marked it read and the row vanished from
// under the operator's cursor mid-task. WhatsApp itself changed away from that
// behavior for the same reason.
//
// The model: while the unread filter is on, membership of the visible set is
// FROZEN for the filter session. Reading a conversation updates its unread
// truth (the badge clears, the row goes light) but does not evict it. Newly
// unread conversations still join, because a live inbox that stops showing new
// work is worse than one that shuffles.
//
// Truth vs membership is the whole point: nothing here fakes a chat as unread.
// `unreadCount` / `manualUnread` remain exactly what the server says. Only
// "is this row part of the set I'm currently working through" is held still.
//
// A filter SESSION ends — and the set recomputes — when the operator changes
// what they are looking at: toggling the filter off and on, or changing scope /
// conversation kind / business number / search. That is the `sessionKey`.

/** Canonical unread predicate — server SSOT fields, one definition. */
export function isUnreadChat(c) {
  return (c?.unreadCount ?? 0) > 0 || !!c?.manualUnread;
}

/**
 * Fold the current chats into the frozen set.
 * Returns null when the filter is off (no session), otherwise
 * `{ sessionKey, ids: Set<string> }`. The previous object is returned
 * unchanged when nothing joined, so this is safe to call on every render.
 */
export function reconcileUnreadSnapshot(prev, { chats, active, sessionKey }) {
  if (!active) return null;
  if (!chats) return prev && prev.sessionKey === sessionKey ? prev : null;

  const unreadNow = chats.filter(isUnreadChat).map((c) => c.id);

  // New session (filter just turned on, or the operator changed the view) →
  // freeze whatever is unread right now.
  if (!prev || prev.sessionKey !== sessionKey) {
    return { sessionKey, ids: new Set(unreadNow) };
  }

  let grew = false;
  const ids = new Set(prev.ids);
  for (const id of unreadNow) {
    if (!ids.has(id)) {
      ids.add(id);
      grew = true;
    }
  }
  return grew ? { sessionKey, ids } : prev;
}

/**
 * The rows the unread filter shows: everyone frozen into this session, plus
 * anything unread right now (covers the render before reconcile has folded a
 * newly arrived conversation in).
 */
export function applyUnreadSnapshot(chats, snapshot) {
  if (!chats) return chats;
  if (!snapshot) return chats.filter(isUnreadChat);
  return chats.filter((c) => snapshot.ids.has(c.id) || isUnreadChat(c));
}

/** Identity of the current filter session — changing it recomputes the set. */
export function unreadSessionKey({ scope, kind, accountFilter, search, epoch = 0 }) {
  return [scope, kind, accountFilter, search || '', epoch].join('|');
}
