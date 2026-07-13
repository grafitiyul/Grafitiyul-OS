import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { ACTIVE_STATUSES, resolveIssue } from '../control/issueService.js';
import { buildIssueActions, issueTypeDef } from '../control/registry.js';
import { setRequirementState, refreshIssueClosure } from '../control/issueRequirements.js';
import { sendNotification, evaluateCustomerNotification, recipientsFor, defaultMessage } from '../control/issueNotifications.js';

// בקרה (Operations Control) API — read the canonical issue list, acknowledge,
// re-check one issue against live state, and dispatch server-side actions.
// Mutations that already have endpoints (WhatsApp reschedule/cancel, deal
// apply/discard tour update…) are NOT duplicated here — the client calls the
// existing endpoint and then POSTs /recheck so the card resolves immediately.

const router = Router();

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };

function toClientIssue(issue) {
  // Requirements of the CURRENT revision only (older revisions stay as audit).
  const reqs = (issue.requirements || []).filter((r) => !issue.revision || r.revision === issue.revision);
  const requirements = reqs.map((r) => ({ id: r.id, kind: r.kind, state: r.state, note: r.note }));
  const done = requirements.filter((r) => r.state === 'completed' || r.state === 'waived').length;
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
    revision: issue.revision || null,
    requirements,
    requirementSummary: { total: requirements.length, done, pending: requirements.length - done },
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
        include: { requirements: true },
      }),
      prisma.operationalIssue.findMany({
        where: { status: 'resolved' },
        orderBy: { resolvedAt: 'desc' },
        take: 20,
        include: { requirements: true },
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

// ── Part 4: impact requirements + customer notification ─────────────────────

// Full detail: the issue with its current-revision requirements, each
// requirement's per-recipient notifications, the recipients, and a default
// editable message (the עדכן לקוחות panel reads this).
router.get(
  '/issues/:id/detail',
  handle(async (req, res) => {
    const issue = await prisma.operationalIssue.findUnique({
      where: { id: req.params.id },
      include: { requirements: { include: { notifications: true } } },
    });
    if (!issue) return res.status(404).json({ error: 'not_found' });
    const reqs = (issue.requirements || []).filter((r) => !issue.revision || r.revision === issue.revision);
    res.set('Cache-Control', 'no-store');
    res.json({
      issue: toClientIssue(issue),
      requirements: reqs.map((r) => ({
        id: r.id, kind: r.kind, state: r.state, note: r.note, resolvedByName: r.resolvedByName, resolvedAt: r.resolvedAt,
        notifications: (r.notifications || []).map((n) => ({
          id: n.id, recipientKey: n.recipientKey, recipientName: n.recipientName, address: n.address, phone: n.phone,
          channel: n.channel, status: n.status, sentAt: n.sentAt, attempts: n.attempts, subject: n.subject, body: n.body,
          providerResult: n.providerResult, retryHistory: n.retryHistory,
        })),
      })),
      recipients: recipientsFor(issue),
      defaultMessage: defaultMessage(issue),
    });
  }),
);

// עדכן לקוחות — send the (editable) message to the selected recipients over the
// chosen channels, reusing the existing email + WhatsApp pipelines. Records a
// per-recipient notification (retry updates the same row) and re-evaluates the
// customer_notification requirement + parent closure. Partial success keeps the
// issue open.
router.post(
  '/issues/:id/notify',
  handle(async (req, res) => {
    const issue = await prisma.operationalIssue.findUnique({
      where: { id: req.params.id },
      include: { requirements: true },
    });
    if (!issue) return res.status(404).json({ error: 'not_found' });
    const requirement = (issue.requirements || []).find(
      (r) => r.kind === 'customer_notification' && (!issue.revision || r.revision === issue.revision),
    );
    if (!requirement) return res.status(400).json({ error: 'no_customer_requirement' });

    const { subject, body } = req.body || {};
    if (!subject || !body) return res.status(400).json({ error: 'missing_message' });
    const channels = Array.isArray(req.body.channels) && req.body.channels.length ? req.body.channels : ['email'];
    const all = recipientsFor(issue);
    const chosen = Array.isArray(req.body.recipientKeys) && req.body.recipientKeys.length
      ? all.filter((r) => req.body.recipientKeys.includes(r.recipientKey))
      : all;

    const results = [];
    for (const recipient of chosen) {
      for (const channel of channels) {
        const row = await sendNotification(prisma, { requirement, recipient, channel, subject, body });
        results.push({ recipientKey: recipient.recipientKey, channel, status: row.status });
      }
    }
    await evaluateCustomerNotification(prisma, requirement.id);
    const sent = results.filter((r) => r.status === 'sent').length;
    res.json({ ok: true, sent, failed: results.length - sent, results });
  }),
);

// Retry the FAILED notifications of a customer_notification requirement (updates
// the same rows).
router.post(
  '/issues/:id/notify/retry',
  handle(async (req, res) => {
    const issue = await prisma.operationalIssue.findUnique({
      where: { id: req.params.id },
      include: { requirements: { include: { notifications: true } } },
    });
    if (!issue) return res.status(404).json({ error: 'not_found' });
    const requirement = (issue.requirements || []).find(
      (r) => r.kind === 'customer_notification' && (!issue.revision || r.revision === issue.revision),
    );
    if (!requirement) return res.status(400).json({ error: 'no_customer_requirement' });
    const recipients = recipientsFor(issue);
    const byKey = new Map(recipients.map((r) => [r.recipientKey, r]));
    const failed = (requirement.notifications || []).filter((n) => n.status === 'failed');
    for (const n of failed) {
      const recipient = byKey.get(n.recipientKey);
      if (!recipient) continue;
      await sendNotification(prisma, { requirement, recipient, channel: n.channel, subject: n.subject, body: n.body });
    }
    await evaluateCustomerNotification(prisma, requirement.id);
    res.json({ ok: true, retried: failed.length });
  }),
);

// Resolve ONE requirement: manual completion / waive (note REQUIRED), or mark
// in_progress. Reverting the change resolves a requirement too (state='waived'
// with the revert note). Re-evaluates parent closure.
router.post(
  '/issues/:id/requirements/:reqId/resolve',
  handle(async (req, res) => {
    const { userId, username } = await actingAdmin(req);
    const state = String(req.body?.state || 'completed');
    const manual = req.body?.manual !== false; // operator action ⇒ manual by default
    try {
      const requirement = await setRequirementState(prisma, req.params.reqId, state, {
        note: req.body?.note ?? null,
        resolvedBy: userId,
        resolvedByName: username,
        manual,
      });
      const issue = await prisma.operationalIssue.findUnique({ where: { id: requirement.issueId } });
      res.json({ ok: true, requirement: { id: requirement.id, kind: requirement.kind, state: requirement.state }, issueStatus: issue?.status });
    } catch (e) {
      if (e.code === 'note_required') return res.status(400).json({ error: 'note_required' });
      throw e;
    }
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
    // Requirement-driven issues (Part 4) close only when every sub-requirement is
    // resolved — re-derive sync requirements + closure rather than a type recheck.
    if (issue.revision) {
      const closed = await refreshIssueClosure(prisma, issue.id);
      return res.json({ resolved: closed });
    }
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
