// Shared cross-entity lookups for global search.
//
// These resolve the joins Prisma cannot express, each as ONE bounded query:
//   - phone      → ContactPhone has no normalized column, so narrow in SQL by
//                  digit-suffix and verify with the canonical normalizer.
//   - timeline   → TimelineEntry.subjectId is an untyped string with no FK.
//   - legacy     → LegacyRecord.cardData is JSON; entityId is a loose link.
//   - orderNo    → Int column, so partial matching needs a text cast.
//
// Every function returns ids/rows the providers fold into a single findMany —
// never a per-row query, so there is no N+1 anywhere.

import { isExactPhoneMatch } from './phoneQuery.js';
import { stripHtml, contains, equals } from './text.js';

// Upper bound on rows any single lookup may return. Generous relative to the
// per-category display limit so ranking still has room to choose, but hard —
// a pathological query can never scan the world into memory.
export const CANDIDATE_CAP = 300;

// LIKE wildcards typed by the user must be literals, not operators, or a query
// containing '%' would match every row. Paired with an explicit ESCAPE clause.
export function escapeLike(s, esc = '~') {
  return String(s ?? '').replace(new RegExp(`[${esc}%_]`, 'g'), (c) => esc + c);
}

// → Map<contactId, { value, exact }>
// SQL narrows by the significant digit-suffix (formatting-agnostic); the
// canonical normalizePhoneIntl decides what is genuinely the SAME number.
// A suffix hit that fails canonical equality is kept as a PARTIAL match rather
// than dropped — it is still evidence, it just ranks lower.
export async function lookupPhoneContacts(pq, db) {
  if (!pq || pq.kind === 'none') return new Map();

  const pattern = pq.kind === 'exact' ? `%${pq.significant}` : `%${pq.needle}%`;
  // '[^0-9]' rather than '\D': avoids backslash-escaping hazards inside the
  // tagged template, and is exactly equivalent here.
  const rows = await db.$queryRaw`
    SELECT "contactId", "value"
    FROM "ContactPhone"
    WHERE regexp_replace("value", '[^0-9]', '', 'g') LIKE ${pattern}
    LIMIT ${CANDIDATE_CAP}
  `;

  const map = new Map();
  for (const r of rows) {
    const exact = pq.kind === 'exact' && isExactPhoneMatch(r.value, pq.intl);
    const prev = map.get(r.contactId);
    if (!prev || (exact && !prev.exact)) map.set(r.contactId, { value: r.value, exact });
  }
  return map;
}

// → Map<contactId, { value, exact }>
export async function lookupEmailContacts(q, db) {
  const rows = await db.contactEmail.findMany({
    where: { value: { contains: q, mode: 'insensitive' } },
    select: { contactId: true, value: true },
    take: CANDIDATE_CAP,
  });
  const map = new Map();
  for (const r of rows) {
    const exact = equals(r.value, q);
    const prev = map.get(r.contactId);
    if (!prev || (exact && !prev.exact)) map.set(r.contactId, { value: r.value, exact });
  }
  return map;
}

// TimelineEntry.body is rich HTML. Matching in SQL would also match tag names
// and attributes ("div", "href", "span"), so every candidate is re-checked
// against the VISIBLE text before it counts as a hit.
export async function lookupTimeline(q, subjectType, db) {
  const rows = await db.timelineEntry.findMany({
    where: {
      subjectType,
      deletedAt: null,
      body: { contains: q, mode: 'insensitive' },
    },
    select: {
      id: true,
      subjectType: true,
      subjectId: true,
      kind: true,
      body: true,
      isSystem: true,
      createdAt: true,
      createdByName: true,
    },
    orderBy: { createdAt: 'desc' },
    take: CANDIDATE_CAP,
  });
  return rows.filter((r) => contains(stripHtml(r.body), q));
}

// Curated legacy card data ONLY.
//
// SECURITY: this reads LegacyRecord.cardData (curated label→value pairs, safe
// to display) and NEVER LegacyRecord.payload (the raw source record). The raw
// archive must never reach a search result.
//
// Naturally inert today: LegacyRecord is empty until the migration's import
// slice runs, so this returns [] and costs one cheap indexed query. It starts
// contributing the moment rows exist — no second search architecture, no
// switch to flip.
export async function lookupLegacy(q, entityType, db) {
  const like = `%${escapeLike(q)}%`;
  return db.$queryRaw`
    SELECT "entityId", "cardData"
    FROM "LegacyRecord"
    WHERE "entityType" = ${entityType}
      AND "entityId" IS NOT NULL
      AND "cardData" IS NOT NULL
      AND "cardData"::text ILIKE ${like} ESCAPE '~'
    LIMIT ${CANDIDATE_CAP}
  `;
}

// Deal.orderNo is an Int, so a partial number ("270") needs a text cast.
// Exact numbers go through Prisma's indexed unique lookup instead.
export async function lookupDealNoPartial(q, db) {
  const digits = String(q || '').trim();
  if (!/^\d{2,}$/.test(digits)) return [];
  const rows = await db.$queryRaw`
    SELECT "id"
    FROM "Deal"
    WHERE CAST("orderNo" AS TEXT) LIKE ${`%${digits}%`}
    LIMIT ${CANDIDATE_CAP}
  `;
  return rows.map((r) => r.id);
}

export function groupByKey(rows, key) {
  const map = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

// Find the first legacy card entry whose label or value matches, for the
// "why it matched" snippet. cardData shape is label→value pairs.
export function legacyCardHit(cardData, q) {
  if (!cardData) return null;
  const entries = Array.isArray(cardData)
    ? cardData.map((e) => [e?.label, e?.value])
    : Object.entries(cardData);
  for (const [label, value] of entries) {
    if (contains(value, q) || contains(label, q)) {
      return { label: String(label ?? ''), value: String(value ?? '') };
    }
  }
  return null;
}
