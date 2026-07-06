// The ONE per-device read/unread store for every WhatsApp surface (inbox,
// Deal dock, Contact/Org panels). Per-chat "last seen" ISO markers live in
// localStorage; unread = incoming activity newer than the marker.
//
// Rules (shared, so surfaces can never disagree):
//   • a chat seen for the FIRST time initializes its marker to NOW — history
//     is never "unread"
//   • reading a conversation marks it seen (marker = now)
//   • manual "mark unread" rewinds the marker to just before the last
//     message, so exactly that message counts as unread again
// localStorage only (V1) — this is per-device state, like WhatsApp Web.

const SEEN_KEY = 'gos-whatsapp-seen'; // { [chatId]: ISO lastSeenAt }

export function readSeen() {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeSeen(map) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function markSeen(chatId) {
  if (!chatId) return;
  const map = readSeen();
  map[chatId] = new Date().toISOString();
  writeSeen(map);
}

// Manual "mark as unread": rewind the marker to 1ms before `beforeIso` (the
// chat's last message) so that message counts as unread again.
export function markUnread(chatId, beforeIso) {
  if (!chatId || !beforeIso) return;
  const t = new Date(beforeIso).getTime();
  if (Number.isNaN(t)) return;
  const map = readSeen();
  map[chatId] = new Date(t - 1).toISOString();
  writeSeen(map);
}

// First-sight initialization for a batch of chats (history isn't unread).
// Returns the (possibly updated) marker map so callers read it once.
export function ensureSeen(chatIds) {
  const map = readSeen();
  let changed = false;
  const now = new Date().toISOString();
  for (const id of chatIds || []) {
    if (id && !map[id]) {
      map[id] = now;
      changed = true;
    }
  }
  if (changed) writeSeen(map);
  return map;
}

// Unread test from data already in the chat list payload — no extra fetch.
export function isUnread(chat, seenMap = null) {
  if (!chat?.lastMessage || chat.lastMessage.direction !== 'incoming') return false;
  const marker = (seenMap || readSeen())[chat.id];
  if (!marker) return false; // first sight — initialized elsewhere via ensureSeen
  const ts = chat.lastMessage.timestampFromSource || chat.lastMessageAt;
  return !!ts && ts > marker;
}
