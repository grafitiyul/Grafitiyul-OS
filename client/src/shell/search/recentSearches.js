// Recent global searches — a small, per-operator, per-browser localStorage
// store. Versioned payload, capped list, stores ONLY { q, kind, at } — never
// result contents, contact/deal ids or any customer record.
//
// The key is namespaced by the logged-in admin username so two operators
// sharing a browser profile never see each other's history. Storage access is
// wrapped: a blocked/full localStorage degrades to "no recents", never a crash.

export const RECENTS_LIMIT = 10;
const VERSION = 1;
const MIN_LENGTH = 2; // ignore empty / one-character searches

export function recentsKey(username) {
  return `gos.globalSearch.recents.v${VERSION}:${String(username || 'local')}`;
}

function read(storage, username) {
  try {
    const raw = storage.getItem(recentsKey(username));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (parsed?.v !== VERSION || !Array.isArray(parsed.items)) return [];
    return parsed.items.filter(
      (it) => it && typeof it.q === 'string' && it.q.trim().length >= MIN_LENGTH,
    );
  } catch {
    return [];
  }
}

function write(storage, username, items) {
  try {
    storage.setItem(recentsKey(username), JSON.stringify({ v: VERSION, items }));
  } catch {
    /* private mode / quota — recents just don't persist */
  }
  return items;
}

export function loadRecents(storage, username) {
  return read(storage, username);
}

// Record a committed search. Deduplicates by trimmed, case-folded text —
// re-using an older search moves it back to the top. Most recent first,
// capped at RECENTS_LIMIT. Returns the new list.
export function recordRecent(storage, username, q, kind) {
  const text = String(q || '').trim();
  if (text.length < MIN_LENGTH) return read(storage, username);
  const foldKey = text.toLowerCase();
  const rest = read(storage, username).filter((it) => it.q.trim().toLowerCase() !== foldKey);
  const items = [{ q: text, kind: kind || 'invalid', at: Date.now() }, ...rest].slice(
    0,
    RECENTS_LIMIT,
  );
  return write(storage, username, items);
}

// Remove one recent search (by its stored text). Returns the new list.
export function removeRecent(storage, username, q) {
  const foldKey = String(q || '').trim().toLowerCase();
  const items = read(storage, username).filter((it) => it.q.trim().toLowerCase() !== foldKey);
  return write(storage, username, items);
}

// Clear the whole history for this operator. Returns [].
export function clearRecents(storage, username) {
  try {
    storage.removeItem(recentsKey(username));
  } catch {
    /* ignore */
  }
  return [];
}
