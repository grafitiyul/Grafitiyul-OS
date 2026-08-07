import { api } from '../../lib/api.js';

// Read-only peek at a Contact / Organization named inside a search result.
//
// The whole point of a hover preview is that it costs the operator NOTHING:
// pointing at a name must not navigate, must not change the search selection,
// must not close the dropdown, must not mark anything read and must not write
// anything at all. So this module is deliberately tiny and calls exactly one
// endpoint — GET /api/search/peek — which is a pure read.
//
// Same shape as the WhatsApp conversation peek (admin/whatsapp/chatPeek.js),
// deliberately: a short module cache keeps a mouse travelling down a result
// list from turning into a request per row, and an in-flight request is shared
// rather than doubled.

const CACHE_MS = 60_000;

const cache = new Map(); // "type:id" -> { at, data } | { promise }

/** The card payload, or null on any failure/absence. Never throws. */
export function peekEntity(type, id) {
  if (!type || !id) return Promise.resolve(null);
  const key = `${type}:${id}`;
  const hit = cache.get(key);
  if (hit?.promise) return hit.promise;
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.data);

  const promise = api.search
    .peek(type, id)
    .then((data) => {
      cache.set(key, { at: Date.now(), data });
      return data;
    })
    .catch(() => {
      cache.delete(key);
      return null;
    });

  cache.set(key, { promise });
  return promise;
}

/** Testing / long-session hygiene. */
export function clearPeekCache() {
  cache.clear();
}

export const PEEK_CACHE_MS = CACHE_MS;
