// Minimal in-process fixed-window rate limiter for the PUBLIC reservation
// endpoints — a leaked link must not become a Deal-creation firehose or a
// scraping surface. In-process is the right weight here (single-service
// deployment; the בקרה abuse detector is the durable backstop across
// restarts/instances). No new dependency.

export function createRateLimiter({ windowMs, max }) {
  const hits = new Map(); // key → { count, resetAt }
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs);
  cleanup.unref?.();

  return function allow(key) {
    const now = Date.now();
    const cur = hits.get(key);
    if (!cur || cur.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    cur.count += 1;
    return cur.count <= max;
  };
}
