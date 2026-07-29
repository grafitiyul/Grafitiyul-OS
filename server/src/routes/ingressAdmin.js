// Ingress Platform — admin observability + operations.
//
// Answers the three questions an operator actually has: is a source live, what
// arrived, and why did something fail. Admin-authenticated (mounted behind
// requireAdminAuth), read-only except for two explicit operator actions
// (retry / dry-run inspect), neither of which can create a duplicate.

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { ingressConfigReport, platformConfig } from '../ingress/config.js';
import { adapterStatus } from '../ingress/adapters/index.js';
import { replayEvent, dryRunBatch } from '../ingress/replay.js';

const router = Router();

// ── Deployment readiness ────────────────────────────────────────────────────
// The cutover checklist, generated from code rather than maintained by hand.
router.get(
  '/config',
  handle(async (_req, res) => {
    const report = ingressConfigReport();
    res.json({
      ...report,
      adapters: adapterStatus(),
      endpoints: {
        meta: '/api/ingress/meta',
        woocommerce_primary: '/api/ingress/woocommerce/primary',
        woocommerce_secondary: '/api/ingress/woocommerce/secondary',
        website_form: '/api/ingress/website-form/:secret/:formKey',
      },
    });
  }),
);

// ── Health / throughput ─────────────────────────────────────────────────────
router.get(
  '/stats',
  handle(async (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);

    const [byStatus, bySource, failures, total] = await Promise.all([
      prisma.ingressEvent.groupBy({ by: ['status'], _count: true, where: { receivedAt: { gte: since } } }),
      prisma.ingressEvent.groupBy({ by: ['source', 'status'], _count: true, where: { receivedAt: { gte: since } } }),
      prisma.ingressEvent.groupBy({
        by: ['failureCode'],
        _count: true,
        where: { receivedAt: { gte: since }, failureCode: { not: null } },
      }),
      prisma.ingressEvent.count({ where: { receivedAt: { gte: since } } }),
    ]);

    res.json({
      windowDays: days,
      total,
      dryRunMode: platformConfig().dryRun,
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count })),
      bySource: bySource.map((r) => ({ source: r.source, status: r.status, count: r._count })),
      topFailures: failures
        .map((r) => ({ failureCode: r.failureCode, count: r._count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    });
  }),
);

// ── Event list ──────────────────────────────────────────────────────────────
router.get(
  '/events',
  handle(async (req, res) => {
    const take = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const where = {};
    if (req.query.source) where.source = String(req.query.source);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.dealId) where.dealId = String(req.query.dealId);

    const rows = await prisma.ingressEvent.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take,
      select: {
        id: true, source: true, sourceKey: true, externalId: true, status: true,
        dryRun: true, outcome: true, dealId: true, contactId: true,
        failureCode: true, failureMessage: true, attemptCount: true,
        nextRetryAt: true, receivedAt: true, processedAt: true,
      },
    });
    res.json({ events: rows });
  }),
);

// ── One event, in full (raw payload included — this is the forensic view) ───
router.get(
  '/events/:id',
  handle(async (req, res) => {
    const row = await prisma.ingressEvent.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'not_found' });
    const attempts = await prisma.ingressAttempt.findMany({
      where: { eventId: row.id },
      orderBy: { attemptNo: 'asc' },
    });
    res.json({ event: row, attempts });
  }),
);

// ── Operator actions ────────────────────────────────────────────────────────

// Retry a failed/dead event. Safe by construction: a processed event
// short-circuits, so this can never produce a second deal.
router.post(
  '/events/:id/retry',
  handle(async (req, res) => {
    try {
      const r = await replayEvent(req.params.id, {});
      res.json({ ok: true, ...r });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.code || 'internal_error' });
    }
  }),
);

// Inspect what the CURRENT mapping would decide, writing nothing. The shadow
// comparison tool: point it at recent traffic before flipping a source over.
router.post(
  '/events/:id/dry-run',
  handle(async (req, res) => {
    try {
      const r = await replayEvent(req.params.id, { asDryRun: true });
      res.json({ ok: true, decision: r.decision || null, normalized: r.normalized || null });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.code || 'internal_error' });
    }
  }),
);

router.post(
  '/dry-run-batch',
  handle(async (req, res) => {
    const results = await dryRunBatch({
      source: req.body?.source || null,
      limit: Math.min(200, Number(req.body?.limit) || 25),
    });
    res.json({ ok: true, results });
  }),
);

export default router;
