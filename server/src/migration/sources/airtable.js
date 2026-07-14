// Read-only Airtable source for snapshot extraction. GET-only; never writes.
// Attachment URLs expire within hours, so bodies are downloaded at extraction
// time (not deferred). The passwords table is excluded by the caller — this
// client will happily read any table id it is given, so callers MUST filter.
import { setTimeout as sleep } from 'node:timers/promises';

export const EXCLUDED_TABLE_NAME = 'גישה, סיסמאות';

export function airtableClient({ throttleMs = 220 } = {}) {
  const token = String(process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN || '').trim();
  const mainBase = String(process.env.AIRTABLE_MAIN_BASE_ID || '').trim();
  const legacyBase = String(process.env.AIRTABLE_LEGACY_BASE_ID || '').trim();
  if (!token || !mainBase || !legacyBase) throw new Error('airtable_not_configured');
  const API = 'https://api.airtable.com/v0';
  const AUTH = { Authorization: `Bearer ${token}` };

  async function get(path, params, attempt = 0) {
    const u = new URL(API + path);
    if (params) for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) for (const x of v) u.searchParams.append(k, String(x));
      else u.searchParams.set(k, String(v));
    }
    const res = await fetch(u.toString(), { method: 'GET', headers: AUTH });
    if (res.status === 429 && attempt < 8) {
      await sleep(1500);
      return get(path, params, attempt + 1);
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) { const e = new Error(`airtable ${path} HTTP ${res.status}`); e.status = res.status; e.body = String(text || '').slice(0, 200); throw e; }
    await sleep(throttleMs);
    return json;
  }

  return {
    bases: [{ role: 'main', id: mainBase }, { role: 'legacy', id: legacyBase }],
    async tables(baseId) {
      const json = await get(`/meta/bases/${encodeURIComponent(baseId)}/tables`);
      return (json?.tables || []).map((t) => ({
        id: t.id, name: t.name, primaryFieldId: t.primaryFieldId,
        fields: (t.fields || []).map((f) => ({ name: f.name, type: f.type })),
        attachmentFields: (t.fields || []).filter((f) => f.type === 'multipleAttachments').map((f) => f.name),
      }));
    },
    // One page of records. Returns {records, offset}. `fields` optional projection.
    async recordsPage(baseId, tableId, { offset = null, fields = null, pageSize = 100 } = {}) {
      const params = { pageSize };
      if (offset) params.offset = offset;
      if (fields) params['fields[]'] = fields;
      const json = await get(`/${baseId}/${encodeURIComponent(tableId)}`, params);
      return { records: json?.records || [], offset: json?.offset || null };
    },
    // Download an attachment body (fresh URL, valid at read time). Returns Buffer.
    async download(fileUrl) {
      const res = await fetch(fileUrl, { method: 'GET' });
      if (!res.ok) { const e = new Error(`attachment download HTTP ${res.status}`); e.status = res.status; throw e; }
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
