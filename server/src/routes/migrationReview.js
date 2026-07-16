// Migration Review Center API (TEMPORARY — deleted after cutover).
//
// Mounted under /api/migration/review, which is already admin-gated by
// requireAdminAuth at the /api/migration mount in index.js.
//
// DELETION BOUNDARY: remove this file, src/migration/review/, the one mount line
// in routes/migration.js, and client/src/admin/migration/. Nothing else in GOS
// imports any of it. MigrationDecision + LegacyRecord are permanent and stay.
//
// This slice writes NOTHING except MigrationDecision rows (the ledger). No
// production entities, no LegacyRecords, no Pipedrive/Airtable calls.
import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import * as r2 from '../migration/r2.js';
import { seedStageConfig, buildReviewSummary, listQueue, recordDecision, batchApproveSafe, buildOrgTargets, buildContactWorkload, recordIdentityEdits, buildImportReadiness, getDeletedPersonIds, buildOrgDispositionIndex, standaloneEligible } from '../migration/review/service.js';
import { buildSnapshotStatus } from '../migration/review/snapshotStatus.js';
import { createBrowser } from '../migration/review/browser.js';

const router = Router();

// ── Snapshot Browser ────────────────────────────────────────────────────────
// One browser per snapshot id, cached for the process (its internal caches are
// bounded). The snapshot id is resolved from the run mirror, never from input,
// so no request can point the browser at arbitrary storage.
const browsers = new Map();
async function browser() {
  const run = await prisma.migrationRun.findFirst({ where: { kind: 'snapshot' }, orderBy: { startedAt: 'desc' } });
  if (!run?.snapshotId) { const e = new Error('no_snapshot'); e.code = 'NO_SNAPSHOT'; throw e; }
  if (!browsers.has(run.snapshotId)) {
    browsers.set(run.snapshotId, createBrowser({ store: { getText: r2.getObjectText }, snapshotId: run.snapshotId }));
  }
  return browsers.get(run.snapshotId);
}
// Map browser errors to honest HTTP codes (the excluded table lands on 404).
function browserError(e, res) {
  if (e.code === 'NOT_BROWSABLE') return res.status(404).json({ error: 'entity_not_browsable' });
  if (e.code === 'NO_INDEX') return res.status(503).json({ error: 'index_unavailable', message: 'הצילום טרם אונדקס' });
  if (e.code === 'NO_SNAPSHOT') return res.status(404).json({ error: 'no_snapshot' });
  throw e;
}

router.get('/browser/entities', handle(async (_req, res) => {
  try { res.json({ entities: await (await browser()).entities() }); }
  catch (e) { browserError(e, res); }
}));

// Owner-DELETED persons ("זו שטות מוחלטת — מחק") are hidden from the normal
// Legacy Archive UI. Deliberately enforced HERE, at the route layer: browser.js
// stays a pure snapshot reader (it never consults the ledger, so it can never
// alter what the snapshot says), while the user-facing surface filters the
// deleted set out. The raw R2 objects are untouched — audit access is storage-
// level, not through this UI.
const isPersons = (entity) => String(entity || '') === 'pipedrive/persons';
async function hideDeleted(pageResult) {
  const deleted = await getDeletedPersonIds(prisma);
  if (!deleted.size || !Array.isArray(pageResult?.records)) return pageResult;
  const before = pageResult.records.length;
  const records = pageResult.records.filter((r) => !deleted.has(r?.id));
  return { ...pageResult, records, hiddenDeleted: before - records.length };
}

router.get('/browser/records', handle(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100); // bounded page
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  try {
    const entity = String(req.query.entity || '');
    const page = await (await browser()).page(entity, { offset, limit });
    res.json(isPersons(entity) ? await hideDeleted(page) : page);
  } catch (e) { browserError(e, res); }
}));

router.get('/browser/record', handle(async (req, res) => {
  try {
    const entity = String(req.query.entity || '');
    if (isPersons(entity) && (await getDeletedPersonIds(prisma)).has(Number(req.query.id))) {
      return res.status(404).json({
        error: 'owner_deleted',
        message: 'הרשומה נמחקה על ידי הבעלים ואינה זמינה כישות. צילום המקור הגולמי נשמר לצורכי ביקורת בלבד.',
      });
    }
    const rec = await (await browser()).record(entity, req.query.id);
    if (!rec) return res.status(404).json({ error: 'record_not_found' });
    res.json(rec);
  } catch (e) { browserError(e, res); }
}));

router.get('/browser/filter', handle(async (req, res) => {
  try {
    const entity = String(req.query.entity || '');
    const out = await (await browser()).filter(entity, String(req.query.q || ''), { limit: 25 });
    res.json(isPersons(entity) ? await hideDeleted(out) : out);
  } catch (e) { browserError(e, res); }
}));

// Queue counts, progress, and the blocking gate.
router.get(
  '/summary',
  handle(async (_req, res) => {
    res.json(await buildReviewSummary(prisma));
  }),
);

// Snapshot #1 status from the real manifest (safe summary facts only).
router.get(
  '/snapshot',
  handle(async (_req, res) => {
    res.json(await buildSnapshotStatus(prisma, r2));
  }),
);

// Idempotent seeding of the frozen, owner-approved configuration.
router.post(
  '/seed',
  handle(async (_req, res) => {
    res.json(await seedStageConfig(prisma));
  }),
);

// The Contacts owner dashboard: SAFE / requires-review-before-import /
// historical review / no-decision-required, plus per-section progress.
router.get(
  '/queues/contacts/workload',
  handle(async (_req, res) => {
    res.json(await buildContactWorkload(prisma));
  }),
);

// Impact report for a graph-changing DEAL decision. Read-only: what else would
// be removed or disconnected. The report replaces technical prohibitions —
// nothing here blocks; the owner decides. Person→deals index built lazily from
// the snapshot and cached per process.
let dealGraphCache = null;
async function dealGraph() {
  if (dealGraphCache) return dealGraphCache;
  const b = await browser();
  const graph = { dealsByPerson: new Map(), participantsByDeal: new Map(), personName: new Map() };
  // One bounded pass over deals + participants via the browser's page API.
  const run = await prisma.migrationRun.findFirst({ where: { kind: 'snapshot' }, orderBy: { startedAt: 'desc' } });
  const { createSnapshotReader } = await import('../migration/review/snapshotReader.js');
  const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId: run.snapshotId });
  const pv = (x) => (x && typeof x === 'object' ? x.value : x) ?? null;
  const stream = async (key, visit) => {
    const man = await reader.entityManifest(key);
    for (const s of man.shards || []) { for (const rec of await reader.readShard(s.key)) visit(rec); reader._shardCache.clear(); }
  };
  await stream('pipedrive/deals', (d) => {
    const p = pv(d.person_id);
    if (p == null) return;
    if (!graph.dealsByPerson.has(p)) graph.dealsByPerson.set(p, []);
    graph.dealsByPerson.get(p).push({ id: d.id, status: d.status });
  });
  await stream('pipedrive/deal_participants', (l) => {
    if (!graph.participantsByDeal.has(l.deal_id)) graph.participantsByDeal.set(l.deal_id, []);
    graph.participantsByDeal.get(l.deal_id).push(l.person_id);
    if (!graph.dealsByPerson.has(l.person_id)) graph.dealsByPerson.set(l.person_id, []);
  });
  await stream('pipedrive/persons', (p) => graph.personName.set(p.id, String(p.name || '').trim()));
  dealGraphCache = graph;
  return graph;
}

router.get(
  '/deal-impact',
  handle(async (req, res) => {
    const dealId = Number(req.query.dealId);
    if (!Number.isInteger(dealId)) return res.status(400).json({ error: 'dealId_required' });
    try {
      const raw = await (await browser()).record('pipedrive/deals', dealId);
      if (!raw) return res.status(404).json({ error: 'deal_not_found' });
      const graph = await dealGraph();
      const row = await prisma.migrationDecision.findUnique({ where: { queue_subjectKey: { queue: 'deals', subjectKey: `deal:${dealId}` } } });
      const proposal = row?.proposal || {};
      const primary = proposal.personSourceId ?? null;
      const linked = [...new Set([primary, ...(graph.participantsByDeal.get(dealId) || [])].filter((x) => x != null))];
      const xwalk = await prisma.legacyRecord.findMany({ where: { sourceSystem: 'pipedrive', sourceType: 'person', sourceId: { in: linked.map(String) } } });
      const { computeDealDeletionImpact } = await import('../migration/review/dealImpact.js');
      const impact = computeDealDeletionImpact({
        deal: { id: dealId, title: proposal.title, status: proposal.status, value: proposal.value, wonTime: proposal.wonTime, personId: primary, orgId: proposal.orgSourceId ?? null, orgName: null, activityCount: 0, noteCount: 0, fileCount: 0 },
        linkedPersons: linked.map((id) => {
          const others = (graph.dealsByPerson.get(id) || []).filter((d) => d.id !== dealId);
          const byStatus = { open: 0, won: 0, lost: 0 };
          for (const d of others) if (byStatus[d.status] != null) byStatus[d.status] += 1;
          const x = xwalk.find((w) => w.sourceId === String(id));
          return {
            legacyId: id, name: graph.personName.get(id) || String(id),
            relationship: id === primary ? 'primary' : 'participant',
            otherDeals: byStatus, otherHistory: 0,
            imported: x?.entityType === 'Contact' ? 'contact' : x?.entityType === 'Organization' ? 'organization' : 'not_imported',
          };
        }),
        orgOtherDeals: null,
      });
      res.json(impact);
    } catch (e) { browserError(e, res); }
  }),
);

// Identity Import readiness — derived from the live ledger, never a toggled flag.
// Reports only: there is no import action anywhere in this router.
router.get(
  '/readiness',
  handle(async (_req, res) => {
    res.json(await buildImportReadiness(prisma));
  }),
);

// One queue's decisions (optionally filtered; ordered by priority rank).
// `section` routes the Contacts queue by business impact. With no section, the
// listing excludes `none` (clusters that cannot produce a duplicate at all).
router.get(
  '/queues/:queue',
  handle(async (req, res) => {
    try {
      res.json(await listQueue(prisma, req.params.queue, {
        status: req.query.status || null,
        filter: req.query.filter || null,
        section: req.query.section || null,
      }));
    } catch (e) {
      if (e.code === 'UNKNOWN_QUEUE') return res.status(404).json({ error: 'unknown_queue' });
      if (e.code === 'UNKNOWN_FILTER') return res.status(400).json({ error: 'unknown_filter' });
      if (e.code === 'UNKNOWN_SECTION') return res.status(400).json({ error: 'unknown_section' });
      throw e;
    }
  }),
);

// Every Organization a source record can be mapped to: migration proposals +
// live GOS organizations, each with their units. Read-only.
router.get(
  '/org-targets',
  handle(async (_req, res) => {
    res.json(await buildOrgTargets(prisma));
  }),
);

// Searchable destination lookup for "שייך לארגון קיים" — the COMPLETE population
// of organisations that will legitimately exist after migration:
//   * cluster canonical orgs (the Organizations-queue proposals)
//   * live GOS organisations
//   * STANDALONE legacy organisations — never clustered, or explicitly sent
//     standalone by an owner decision (`new:<legacyOrgId>`), found via the
//     snapshot label index (cheap partial match, Hebrew and English alike).
// Cluster members routed into another org / a unit / excluded will NOT exist as
// destinations and are filtered out (reported in `hiddenByDisposition`).
router.get(
  '/org-target-search',
  handle(async (req, res) => {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    if (!q) return res.json({ matches: [], truncated: false, hiddenByDisposition: 0 });

    const needle = q.toLowerCase();
    const [registry, dispositions] = await Promise.all([buildOrgTargets(prisma), buildOrgDispositionIndex(prisma)]);
    const out = [];
    for (const t of registry.proposals) {
      if (t.name?.toLowerCase().includes(needle)) out.push({ key: t.key, name: t.name, kind: 'proposal' });
    }
    for (const t of registry.gos) {
      if (t.name?.toLowerCase().includes(needle)) out.push({ key: t.key, name: t.name, kind: 'gos' });
    }
    let hiddenByDisposition = 0;
    try {
      const snap = await (await browser()).filter('pipedrive/organizations', q, { limit: limit * 3 });
      for (const m of snap.matches || []) {
        if (!standaloneEligible(dispositions, m.id)) { hiddenByDisposition++; continue; }
        out.push({ key: `new:${m.id}`, name: m.label, kind: 'legacy' });
      }
    } catch (e) {
      if (e.code !== 'NO_INDEX' && e.code !== 'NO_SNAPSHOT') throw e;
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'he'));
    res.json({ matches: out.slice(0, limit), truncated: out.length > limit, hiddenByDisposition });
  }),
);

// EXPLICIT batch approval of the deterministically-safe clusters (contacts).
// The caller cannot choose WHICH rows: only engine-marked `batchApprovable`
// pending rows qualify, each written with its own decision + audit trail.
router.post(
  '/queues/:queue/batch-approve-safe',
  handle(async (req, res) => {
    const userId = req.adminAuth?.userId || null;
    let userName = null;
    if (userId) {
      const u = await prisma.adminUser.findUnique({ where: { id: userId }, select: { username: true } });
      userName = u?.username || null;
    }
    try {
      res.json(await batchApproveSafe(prisma, { queue: req.params.queue, userId, userName }));
    } catch (e) {
      if (e.code === 'BATCH_NOT_SUPPORTED') return res.status(400).json({ error: 'batch_not_supported' });
      throw e;
    }
  }),
);

// Record SOURCE-DATA corrections for one cluster's records ("this phone belongs to
// someone else"). Stored as MigrationDecision overrides keyed by source contact.
// The snapshot is never touched and the Snapshot Browser keeps showing the original.
router.post(
  '/decisions/:id/identity',
  handle(async (req, res) => {
    const userId = req.adminAuth?.userId || null;
    let userName = null;
    if (userId) {
      const u = await prisma.adminUser.findUnique({ where: { id: userId }, select: { username: true } });
      userName = u?.username || null;
    }
    try {
      res.json(await recordIdentityEdits(prisma, {
        clusterDecisionId: req.params.id,
        edits: req.body?.edits || {},
        note: typeof req.body?.note === 'string' ? req.body.note.trim() || null : null,
        userId,
        userName,
      }));
    } catch (e) {
      if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'not_found' });
      if (e.code === 'BATCH_NOT_SUPPORTED') return res.status(400).json({ error: 'identity_edits_are_contacts_only' });
      if (e.code === 'INVALID_DECISION') return res.status(400).json({ error: 'invalid_identity_edit', problems: e.problems });
      throw e;
    }
  }),
);

// Record a human decision (approve / reject / edit) with its audit trail.
router.post(
  '/decisions/:id/decide',
  handle(async (req, res) => {
    const userId = req.adminAuth?.userId || null;
    let userName = null;
    if (userId) {
      const u = await prisma.adminUser.findUnique({ where: { id: userId }, select: { username: true } });
      userName = u?.username || null;
    }
    // A `new:<legacyOrgId>` mapping target must EXIST in the snapshot. The service
    // validates routing legality (dispositions); existence is checked here, where
    // the snapshot index lives — so a hand-crafted id cannot become a dangling
    // destination.
    const newKey = /^new:(\d+)$/.exec(String(req.body?.decision?.organization?.targetOrganizationKey || ''));
    if (newKey) {
      try {
        const rec = await (await browser()).record('pipedrive/organizations', Number(newKey[1]));
        if (!rec) return res.status(400).json({ error: 'invalid_decision', problems: [`ארגון מקור ${newKey[1]} לא קיים בצילום`] });
      } catch (e) {
        if (e.code === 'NO_INDEX' || e.code === 'NO_SNAPSHOT') {
          return res.status(503).json({ error: 'index_unavailable', message: 'לא ניתן לאמת את ארגון היעד — אינדקס הצילום אינו זמין' });
        }
        throw e;
      }
    }
    try {
      const row = await recordDecision(prisma, {
        id: req.params.id,
        action: String(req.body?.action || ''),
        decision: req.body?.decision ?? null,
        note: typeof req.body?.note === 'string' ? req.body.note.trim() || null : null,
        userId,
        userName,
      });
      res.json({ id: row.id, status: row.status, decidedByName: row.decidedByName, decidedAt: row.decidedAt });
    } catch (e) {
      if (e.code === 'INVALID_ACTION') return res.status(400).json({ error: 'invalid_action' });
      if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'not_found' });
      if (e.code === 'QUEUE_FROZEN') return res.status(409).json({ error: 'queue_frozen', message: e.message });
      if (e.code === 'INVALID_DECISION') return res.status(400).json({ error: 'invalid_decision', problems: e.problems });
      throw e;
    }
  }),
);

export default router;
