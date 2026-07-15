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

const qs = (o) =>
  '?' + Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');

export const migrationApi = {
  summary: () => req('/api/migration/review/summary'),
  snapshot: () => req('/api/migration/review/snapshot'),
  queue: (key, filter = null) => req(`/api/migration/review/queues/${encodeURIComponent(key)}${filter ? qs({ filter }) : ''}`),
  // Snapshot Browser (read-only).
  browserEntities: () => req('/api/migration/review/browser/entities'),
  browserRecords: (entity, offset = 0, limit = 25) => req('/api/migration/review/browser/records' + qs({ entity, offset, limit })),
  browserRecord: (entity, id) => req('/api/migration/review/browser/record' + qs({ entity, id })),
  browserFilter: (entity, q) => req('/api/migration/review/browser/filter' + qs({ entity, q })),
  // Idempotent — safe to call on every mount; a no-op once seeded.
  seed: () => req('/api/migration/review/seed', { method: 'POST' }),
  decide: (id, body) =>
    req(`/api/migration/review/decisions/${encodeURIComponent(id)}/decide`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
