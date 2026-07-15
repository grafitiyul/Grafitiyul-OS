// Snapshot Browser — a compact READ-ONLY view of Snapshot #1 for the Review
// Center. Not a data platform: it exists so the owner can inspect the source
// record behind a review decision.
//
// Guarantees: reads R2 only; never the whole snapshot; the excluded passwords
// table is unreachable (it was never snapshotted AND is denied by name); secret-
// looking fields are stripped; values are flattened to readable label→value pairs
// server-side so the UI never renders raw JSON.
import { createSnapshotReader } from './snapshotReader.js';

const SECRET_KEY = /token|secret|password|api[_-]?key|credential|סיסמ/i;

// Pipedrive custom fields are 40-char hashes. The snapshot's own reference bundle
// carries key→name, so the browser shows the real field name, not a hash.
const FIELD_SOURCE = {
  'pipedrive/organizations': 'organizationFields',
  'pipedrive/persons': 'personFields',
  'pipedrive/deals': 'dealFields',
  'pipedrive/products': 'productFields',
};

// Pipedrive reference fields → the entity they point at (relationship links).
const REF_TARGET = {
  org_id: 'pipedrive/organizations',
  person_id: 'pipedrive/persons',
  deal_id: 'pipedrive/deals',
  owner_id: null,
  user_id: null,
  creator_user_id: null,
};

export function createBrowser({ store, snapshotId }) {
  const reader = createSnapshotReader({ store, snapshotId });
  let referenceCache = null;

  async function reference() {
    if (referenceCache !== null) return referenceCache;
    try {
      referenceCache = JSON.parse(await store.getText(`snapshots/${snapshotId}/pipedrive/reference/reference.json`));
    } catch { referenceCache = {}; }
    return referenceCache;
  }

  async function fieldLabels(entityKey) {
    const src = FIELD_SOURCE[entityKey];
    if (!src) return new Map();
    const ref = await reference();
    const defs = Array.isArray(ref?.[src]) ? ref[src] : [];
    return new Map(defs.filter((f) => f?.key && f?.name).map((f) => [f.key, f.name]));
  }

  // Flatten one value into something renderable. Returns {display, ref?}.
  function flatten(key, v) {
    if (v == null || v === '') return null;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      return { display: String(v) };
    }
    // Pipedrive reference shape: { value, name } / { value, ... }
    if (!Array.isArray(v) && typeof v === 'object' && 'value' in v) {
      const display = v.name != null ? String(v.name) : String(v.value ?? '');
      if (!display) return null;
      const target = REF_TARGET[key];
      return target && v.value != null ? { display, ref: { entity: target, id: v.value } } : { display };
    }
    // email / phone arrays: [{ value, primary, label }]
    if (Array.isArray(v)) {
      if (!v.length) return null;
      const parts = v
        .map((x) => (x && typeof x === 'object' ? (x.value ?? x.name ?? null) : x))
        .filter((x) => x != null && x !== '')
        .map(String);
      if (!parts.length) return { display: `${v.length} פריטים` };
      return { display: parts.join(' · ') };
    }
    if (typeof v === 'object') {
      const name = v.name ?? v.title ?? null;
      if (name) return { display: String(name) };
      const n = Object.keys(v).length;
      return n ? { display: `${n} שדות` } : null;
    }
    return null;
  }

  // One source record → clean label→value fields (+ relationship refs).
  async function record(entityKey, id) {
    const e = await reader.assertBrowsable(entityKey);
    const raw = await reader.getById(entityKey, id);
    if (!raw) return null;
    const labels = await fieldLabels(entityKey);
    const isAirtable = entityKey.startsWith('airtable/');
    const source = isAirtable ? raw.fields || {} : raw;

    const fields = [];
    for (const [key, value] of Object.entries(source)) {
      if (SECRET_KEY.test(key)) continue; // never surfaced
      const f = flatten(key, value);
      if (!f) continue;
      fields.push({
        key,
        // Custom-field hashes resolve to their real name; unknown keys keep the key.
        label: labels.get(key) || key,
        display: f.display,
        ref: f.ref || null,
        // A hashed custom-field key is not useful jargon for the reader.
        technical: /^[0-9a-f]{40}$/.test(key) && !labels.has(key),
      });
    }
    fields.sort((a, b) => Number(a.technical) - Number(b.technical));

    return {
      entity: { key: e.key, system: e.system, label: e.label },
      sourceSystem: e.system === 'pipedrive' ? 'Pipedrive' : 'Airtable',
      sourceId: isAirtable ? raw.id : raw.id ?? id,
      createdTime: isAirtable ? raw.createdTime || null : raw.add_time || null,
      fields,
    };
  }

  async function page(entityKey, opts) {
    const res = await reader.page(entityKey, opts);
    const isAirtable = entityKey.startsWith('airtable/');
    // Rows carry only an id + label — the browser never ships whole payloads to a list.
    const rows = res.records.map((r) => {
      if (isAirtable) {
        const first = Object.values(r.fields || {}).find((v) => typeof v === 'string' && v.trim());
        return { id: r.id, label: first ? String(first).slice(0, 80) : '(ללא כותרת)' };
      }
      const label = r.name ?? r.title ?? r.subject ?? (r.deal_id != null ? `עסקה ${r.deal_id}` : '') ?? '';
      return { id: r.id ?? r.deal_id, label: String(label || '(ללא כותרת)').slice(0, 80) };
    });
    return { entity: res.entity, total: res.total, offset: res.offset, limit: res.limit, rows };
  }

  return {
    entities: () => reader.listEntities(),
    page,
    record,
    filter: (entityKey, q, opts) => reader.filter(entityKey, q, opts),
  };
}

export { SECRET_KEY };
