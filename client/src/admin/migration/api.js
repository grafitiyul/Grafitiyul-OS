// Migration Review Center API client (TEMPORARY — deleted after cutover).
// All endpoints are admin-only and read-only except decision recording, which
// writes ONLY to the decision ledger.

async function req(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export const migrationApi = {
  summary: () => req('/api/migration/review/summary'),
  snapshot: () => req('/api/migration/review/snapshot'),
  queue: (key) => req(`/api/migration/review/queues/${encodeURIComponent(key)}`),
  // Idempotent — safe to call on every mount; a no-op once seeded.
  seed: () => req('/api/migration/review/seed', { method: 'POST' }),
  decide: (id, body) =>
    req(`/api/migration/review/decisions/${encodeURIComponent(id)}/decide`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
