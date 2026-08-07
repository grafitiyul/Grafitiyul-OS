import { api } from '../../lib/api.js';

// Read-only peek at a conversation, for the row hover preview.
//
// The whole point of the hover preview is that it costs the operator NOTHING:
// looking at a conversation must not open it, must not mark it read, must not
// link a contact or a deal, and must not write anything at all. So this module
// is deliberately tiny and deliberately narrow — it calls exactly one endpoint,
// GET /api/whatsapp/chats/:id/messages, which is a pure read (the read receipt
// lives on a SEPARATE markChatRead call that only the opened thread makes).
//
// A short-lived module cache keeps incidental mouse travel down the list from
// turning into a request per row: the same chat re-peeked within CACHE_MS
// reuses the last page, and an in-flight request is shared rather than doubled.

const CACHE_MS = 30_000;
const PEEK_LIMIT = 12;

const cache = new Map(); // chatId -> { at, messages } | { promise }

/** Newest-last messages for the preview, or [] on any failure (never throws). */
export function peekChat(chatId) {
  const hit = cache.get(chatId);
  if (hit?.promise) return hit.promise;
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.messages);

  const promise = api.whatsapp
    .chatMessages(chatId, { limit: PEEK_LIMIT })
    .then((data) => {
      // The endpoint pages newest-first; the preview reads like a conversation.
      const messages = [...(data?.messages || [])].reverse();
      cache.set(chatId, { at: Date.now(), messages });
      return messages;
    })
    .catch(() => {
      cache.delete(chatId);
      return [];
    });

  cache.set(chatId, { promise });
  return promise;
}

/** Drop a chat's cached peek — called when its thread is opened for real. */
export function invalidatePeek(chatId) {
  cache.delete(chatId);
}

export const PEEK_CACHE_MS = CACHE_MS;
