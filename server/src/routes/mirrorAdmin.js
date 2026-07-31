// Legacy Mirror — the operator surface.
//
// Read-only status plus two write actions (replay, resolve). Admin-guarded like
// every other admin router. Nothing here can write to a legacy system.

import { Router } from 'express';
import { handle } from '../asyncHandler.js';
import { prisma } from '../db.js';
import { mirrorHealth } from '../mirror/worker.js';
import { processEvent } from '../mirror/pipeline.js';
import { registryStatus, validateRegistry } from '../mirror/sourceRegistry.js';
import { resolveConflict, CHOICES } from '../mirror/resolve.js';
import { mirrorAdapterFactory } from '../mirror/adapters.js';
import { OWNERSHIP, writableFields } from '../mirror/ownership.js';
import { openStream } from '../realtime/sse.js';
import { MIRROR_CHANNEL } from '../mirror/events.js';

const router = Router();

// GET /api/mirror-admin/stream — SSE invalidation hints (shared realtime hub;
// same contract as /api/tasks/stream). Admin-guarded at the mount site.
router.get('/stream', (req, res) => {
  openStream(req, res, { channel: MIRROR_CHANNEL, scope: 'admin' });
});
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const adapterFactory = mirrorAdapterFactory;

/** Overall health: cursors, backlog, conflicts, source-registry violations. */
router.get('/status', handle(async (_req, res) => {
  const health = await mirrorHealth(prisma);
  const registry = registryStatus();
  const validation = validateRegistry();
  const byOutcome = await prisma.mirrorEvent.groupBy({ by: ['outcome'], _count: { _all: true } }).catch(() => []);
  res.json({
    enabled: String(process.env.MIRROR_ENABLED || '').toLowerCase() === 'true',
    health,
    registry,
    registryOk: validation.ok,
    registryViolations: validation.violations,
    outcomes: byOutcome.map((r) => ({ outcome: r.outcome, count: r._count._all })),
  });
}));

/** The ownership contract, as the code actually enforces it. */
router.get('/ownership', handle(async (_req, res) => {
  res.json({
    entities: Object.entries(OWNERSHIP).map(([entity, spec]) => ({
      entity,
      system: spec.system,
      scope: spec.scope || 'all',
      writable: writableFields(entity),
      fields: spec.fields.map((f) => ({ field: f.name, class: f.cls, merge: f.merge, guard: f.guard || null })),
    })),
  });
}));

/** Recent events, filterable — the audit spine. */
router.get('/events', handle(async (req, res) => {
  const where = {};
  if (req.query.status) where.status = String(req.query.status);
  if (req.query.outcome) where.outcome = String(req.query.outcome);
  if (req.query.entity) where.entity = String(req.query.entity);
  const rows = await prisma.mirrorEvent.findMany({
    where,
    orderBy: { receivedAt: 'desc' },
    take: Math.min(Number(req.query.limit) || 50, 200),
    select: {
      id: true, system: true, entity: true, externalId: true, changeKind: true, transport: true,
      status: true, outcome: true, gosEntityId: true, fieldsWritten: true, conflicts: true,
      failureCode: true, failureMessage: true, attemptCount: true, receivedAt: true, processedAt: true,
    },
  });
  res.json({ events: rows });
}));

/**
 * Replay one event from its stored raw payload.
 * The whole reason the payload is persisted before processing.
 */
router.post('/events/:id/replay', handle(async (req, res) => {
  const row = await prisma.mirrorEvent.findUnique({ where: { id: req.params.id }, select: { system: true, entity: true } });
  if (!row) return res.status(404).json({ error: 'not_found' });
  const adapter = adapterFactory(row.system, row.entity);
  if (!adapter) return res.status(400).json({ error: 'no_adapter' });
  // Reset terminal state so the pipeline re-evaluates from source truth.
  await prisma.mirrorEvent.update({
    where: { id: req.params.id },
    data: { status: 'pending', failureCode: null, failureMessage: null, nextRetryAt: null },
  });
  const result = await processEvent(prisma, req.params.id, adapter);
  res.json(result);
}));

/**
 * Resolve a conflict. Writes (or does not) AND advances the baseline in one
 * action — doing only one of those is how a conflict screen loses trust.
 */
router.post('/conflicts/:issueId/resolve', handle(async (req, res) => {
  const choice = String(req.body?.choice || '');
  if (!CHOICES.includes(choice)) return res.status(400).json({ error: 'bad_choice', allowed: CHOICES });

  const issue = await prisma.operationalIssue.findUnique({ where: { id: req.params.issueId } });
  if (!issue) return res.status(404).json({ error: 'not_found' });
  if (issue.type !== 'legacy_sync_conflict') return res.status(400).json({ error: 'not_a_sync_conflict' });

  const entity = issue.data?.entity;
  const adapter = adapterFactory(issue.data?.system, entity);
  if (!adapter) return res.status(400).json({ error: 'no_adapter' });

  const result = await resolveConflict(prisma, {
    issue,
    choice,
    sourceType: adapter.sourceType,
    apply: adapter.applyGos,
    resolvedBy: req.adminUser?.id || null,
    resolvedByName: req.adminUser?.displayName || req.adminUser?.username || null,
  });
  res.json(result);
}));

export default router;
