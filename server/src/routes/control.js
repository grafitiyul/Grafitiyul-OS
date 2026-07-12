import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { ACTIVE_STATUSES, resolveIssue } from '../control/issueService.js';
import { buildIssueActions, issueTypeDef } from '../control/registry.js';

// בקרה (Operations Control) API — read the canonical issue list, acknowledge,
// re-check one issue against live state, and dispatch server-side actions.
// Mutations that already have endpoints (WhatsApp reschedule/cancel, deal
// apply/discard tour update…) are NOT duplicated here — the client calls the
// existing endpoint and then POSTs /recheck so the card resolves immediately.

const router = Router();

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };

function toClientIssue(issue) {
  return {
    id: issue.id,
    type: issue.type,
    severity: issue.severity,
    sourceModule: issue.sourceModule,
    title: issue.title,
    explanation: issue.explanation,
    entityRefs: issue.entityRefs || [],
    data: issue.data || null,
    status: issue.status,
    detectedAt: issue.detectedAt,
    lastSeenAt: issue.lastSeenAt,
    acknowledgedAt: issue.acknowledgedAt,
    resolvedAt: issue.resolvedAt,
    resolvedByName: issue.resolvedByName,
    resolution: issue.resolution,
    actions: buildIssueActions(issue),
  };
}

async function actingAdmin(req) {
  const userId = req.adminAuth?.userId || null;
  if (!userId) return { userId: null, username: null };
  const u = await prisma.adminUser.findUnique({ where: { id: userId }, select: { username: true } });
  return { userId, username: u?.username || null };
}

// The dashboard read: active issues (open + acknowledged) sorted by severity
// then recency, per-severity counts, and the most recently resolved rows so
// the operator can see what was just taken care of.
router.get(
  '/issues',
  handle(async (req, res) => {
    const [active, resolvedRecent] = await Promise.all([
      prisma.operationalIssue.findMany({
        where: { status: { in: ACTIVE_STATUSES } },
        orderBy: { detectedAt: 'desc' },
      }),
      prisma.operationalIssue.findMany({
        where: { status: 'resolved' },
        orderBy: { resolvedAt: 'desc' },
        take: 20,
      }),
    ]);
    active.sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
        new Date(b.detectedAt) - new Date(a.detectedAt),
    );
    const counts = { critical: 0, warning: 0, info: 0 };
    for (const i of active) if (counts[i.severity] !== undefined) counts[i.severity] += 1;
    res.set('Cache-Control', 'no-store');
    res.json({
      issues: active.map(toClientIssue),
      counts,
      resolvedRecent: resolvedRecent.map(toClientIssue),
    });
  }),
);

// Dismiss / acknowledge — the issue stays real (and keeps auto-resolving when
// fixed) but moves out of the operator's way. Reversible.
router.post(
  '/issues/:id/acknowledge',
  handle(async (req, res) => {
    const { userId } = await actingAdmin(req);
    const updated = await prisma.operationalIssue.updateMany({
      where: { id: req.params.id, status: 'open' },
      data: { status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedBy: userId },
    });
    if (updated.count === 0) return res.status(409).json({ error: 'not_open' });
    res.json({ ok: true });
  }),
);

router.post(
  '/issues/:id/unacknowledge',
  handle(async (req, res) => {
    const updated = await prisma.operationalIssue.updateMany({
      where: { id: req.params.id, status: 'acknowledged' },
      data: { status: 'open', acknowledgedAt: null, acknowledgedBy: null },
    });
    if (updated.count === 0) return res.status(409).json({ error: 'not_acknowledged' });
    res.json({ ok: true });
  }),
);

// Re-check ONE issue against live domain state. Called by the client right
// after it executed an 'api' action so the card reflects reality immediately
// (the sweep would catch it within a minute anyway — this is UX, not truth).
router.post(
  '/issues/:id/recheck',
  handle(async (req, res) => {
    const issue = await prisma.operationalIssue.findUnique({ where: { id: req.params.id } });
    if (!issue) return res.status(404).json({ error: 'not_found' });
    if (issue.status === 'resolved') return res.json({ resolved: true });
    const def = issueTypeDef(issue.type);
    if (!def?.recheck) return res.json({ resolved: false });
    const stillPresent = await def.recheck(prisma, issue);
    if (!stillPresent) {
      await resolveIssue(prisma, { id: issue.id, resolution: 'auto' });
      return res.json({ resolved: true });
    }
    res.json({ resolved: false });
  }),
);

// Dispatch a server-side action (operations with no pre-existing endpoint —
// e.g. approving a gallery purge). The type's handler owns the semantics and
// returns { ok, message?, resolve?: { resolution } }.
router.post(
  '/issues/:id/actions/:key',
  handle(async (req, res) => {
    const issue = await prisma.operationalIssue.findUnique({ where: { id: req.params.id } });
    if (!issue) return res.status(404).json({ error: 'not_found' });
    if (issue.status === 'resolved') return res.status(409).json({ error: 'already_resolved' });
    const def = issueTypeDef(issue.type);
    const action = def?.serverActions?.[req.params.key];
    if (!action) return res.status(404).json({ error: 'unknown_action' });
    const { userId, username } = await actingAdmin(req);
    const result = await action(prisma, issue, { userId, username, body: req.body || {} });
    if (!result.ok) {
      return res.status(result.status || 409).json({ error: result.error || 'action_failed' });
    }
    if (result.resolve) {
      await resolveIssue(prisma, {
        id: issue.id,
        resolution: result.resolve.resolution || req.params.key,
        resolvedBy: userId,
        resolvedByName: username,
      });
    }
    res.json({ ok: true, resolved: Boolean(result.resolve), ...(result.payload || {}) });
  }),
);

export default router;
