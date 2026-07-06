// The ONE per-device read/unread store for every WhatsApp surface (inbox,
// Deal dock, Contact/Org panels). Per-chat "last seen" ISO markers live in
// localStorage; unread = incoming activity newer than the marker.
//
// Rules (shared, so surfaces can never disagree):
//   • a chat seen for the FIRST time initializes its marker to NOW — history
//     is never "unread"
//   • reading a conversation marks it seen (marker = now, manual flag off)
//   • manual "mark unread" raises a FLAG (WhatsApp-style): the row shows an
//     empty unread circle even though no new message arrived; any real new
//     message shows its count as usual. The flag never inflates counts.
// localStorage only (V1) — this is per-device state, like WhatsApp Web.

const SEEN_KEY = 'gos-whatsapp-seen'; // { [chatId]: ISO lastSeenAt }
const MANUAL_KEY = 'gos-whatsapp-unread-manual'; // { [chatId]: true }

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') || {};
  } catch {
    return {};
  }
}

function writeJson(key, map) {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function readSeen() {
  return readJson(SEEN_KEY);
}

export function readManualUnread() {
  return readJson(MANUAL_KEY);
}

export function markSeen(chatId) {
  if (!chatId) return;
  const map = readSeen();
  map[chatId] = new Date().toISOString();
  writeJson(SEEN_KEY, map);
  const manual = readManualUnread();
  if (manual[chatId]) {
    delete manual[chatId];
    writeJson(MANUAL_KEY, manual);
  }
}

// Manual "mark as unread" — a display flag only (does NOT rewind the marker,
// so unread COUNTS stay honest: they count real new messages only).
export function markUnread(chatId) {
  if (!chatId) return;
  const manual = readManualUnread();
  manual[chatId] = true;
  writeJson(MANUAL_KEY, manual);
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
  if (changed) writeJson(SEEN_KEY, map);
  return map;
}

// Unread test from data already in the chat list payload — no extra fetch.
// True for real new incoming messages OR a manual unread flag.
export function isUnread(chat, seenMap = null, manualMap = null) {
  if (!chat) return false;
  if ((manualMap || readManualUnread())[chat.id]) return true;
  if (!chat.lastMessage || chat.lastMessage.direction !== 'incoming') return false;
  const marker = (seenMap || readSeen())[chat.id];
  if (!marker) return false; // first sight — initialized elsewhere via ensureSeen
  const ts = chat.lastMessage.timestampFromSource || chat.lastMessageAt;
  return !!ts && ts > marker;
}
