// Shared WhatsApp composer draft store (localStorage). Scoped by
// accountId:chatId so drafts can't leak between contacts, deals or our two
// numbers. This is the GENERIC mechanism the composer reads on mount — any
// feature can seed a draft here (e.g. "send document to customer" pre-fills the
// text, then opens the dock) without a feature-specific prop on ChatComposer.
// localStorage only (V1, no server persistence).

const DRAFTS_KEY = 'gos-whatsapp-drafts';

export function draftKeyFor(chat) {
  return `${chat.accountId || chat.account?.id || ''}:${chat.id}`;
}

export function readDrafts() {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function readDraft(key) {
  return readDrafts()[key] || '';
}

export function writeDraft(key, text) {
  try {
    const map = readDrafts();
    if (text && text.trim()) map[key] = text;
    else delete map[key];
    // Safety valve: never let the map grow unbounded.
    const keys = Object.keys(map);
    if (keys.length > 100) for (const k of keys.slice(0, keys.length - 100)) delete map[k];
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
