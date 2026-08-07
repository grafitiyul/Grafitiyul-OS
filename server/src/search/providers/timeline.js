// Notes / Timeline search provider.
//
// TimelineEntry is polymorphic: subjectType + subjectId, an untyped string
// with NO foreign key (deliberate — it survives entity deletion). Prisma
// therefore cannot `include` the parent, so parents are resolved with ONE
// batched query per subject type (3 total), never one per row.
//
// Notes and system/changelog events share this table, discriminated by `kind`
// and `isSystem` — one source of truth, so this provider searches both and the
// result row says which it was.

import { lookupTimeline } from '../lookups.js';
import { scoreOf, bestReason } from '../ranking.js';
import { snippet, fullNameHe, fullNameEn } from '../text.js';
import {
  contactPath, organizationPath, dealPath,
  CONTACT_REF_SELECT, ORGANIZATION_REF_SELECT,
} from '../entityRefs.js';

const SUBJECT_TYPES = ['deal', 'contact', 'organization'];

async function resolveParents(rows, db) {
  const byType = new Map(SUBJECT_TYPES.map((t) => [t, new Set()]));
  for (const r of rows) {
    if (byType.has(r.subjectType)) byType.get(r.subjectType).add(r.subjectId);
  }

  const [deals, contacts, orgs] = await Promise.all([
    byType.get('deal').size
      ? db.deal.findMany({
          where: { id: { in: [...byType.get('deal')] } },
          select: { id: true, orderNo: true, title: true },
        })
      : [],
    byType.get('contact').size
      // contactNo / orgNo travel so the parent link is the CANONICAL one. This
      // provider used to address a contact by cuid while the contacts provider
      // used the public number — the same person, two different URLs.
      ? db.contact.findMany({
          where: { id: { in: [...byType.get('contact')] } },
          select: CONTACT_REF_SELECT,
        })
      : [],
    byType.get('organization').size
      ? db.organization.findMany({
          where: { id: { in: [...byType.get('organization')] } },
          select: ORGANIZATION_REF_SELECT,
        })
      : [],
  ]);

  const map = new Map();
  for (const d of deals) {
    map.set(`deal:${d.id}`, {
      type: 'deal',
      id: d.id,
      orderNo: d.orderNo,
      label: d.title,
      path: dealPath(d),
    });
  }
  for (const c of contacts) {
    map.set(`contact:${c.id}`, {
      type: 'contact',
      id: c.id,
      label: fullNameHe(c) || fullNameEn(c),
      path: contactPath(c),
    });
  }
  for (const o of orgs) {
    map.set(`organization:${o.id}`, {
      type: 'organization',
      id: o.id,
      label: o.name,
      path: organizationPath(o),
    });
  }
  return map;
}

export async function searchTimeline(q, pq, limit, todayIso, db) {
  const rowsByType = await Promise.all(SUBJECT_TYPES.map((t) => lookupTimeline(q, t, db)));
  const rows = rowsByType.flat();
  if (!rows.length) return { hits: [], truncated: false };

  const parents = await resolveParents(rows, db);

  const hits = [];
  for (const r of rows) {
    const parent = parents.get(`${r.subjectType}:${r.subjectId}`);
    // Dangling subjectId (parent deleted) — the loose link tolerates it, and a
    // result with no navigable parent is useless, so skip it.
    if (!parent) continue;
    const key = r.isSystem || r.kind !== 'note' ? 'timeline_partial' : 'note_partial';
    const reasons = [{ key, text: snippet(r.body, q) }];
    hits.push({
      score: scoreOf(reasons),
      groupRank: 0,
      updatedAt: r.createdAt?.getTime?.() ?? 0,
      best: bestReason(reasons),
      dto: () => ({
        type: 'timeline',
        id: r.id,
        path: parent.path,
        kind: r.kind,
        isSystem: r.isSystem,
        excerpt: snippet(r.body, q, 70),
        authorName: r.createdByName || null,
        createdAt: r.createdAt,
        parent,
        reasons,
      }),
    });
  }
  return { hits, truncated: false };
}
