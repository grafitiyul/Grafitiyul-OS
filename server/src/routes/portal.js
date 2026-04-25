// Guide Portal — token-gated, mobile-first task feed.
//
// One module today (procedures), but the WIRE shape is intentionally
// generic so future task types — training plans, tours, feedback,
// payments — can be appended without breaking the client.
//
// Task shape:
//   {
//     id:          string                    // '<type>:<refId>'
//     type:        'procedure'               // future: 'training_plan' | …
//     title:       string
//     description: string | null
//     status:      'not_started' | 'in_progress' | 'completed'
//     badge:       { tone: 'info' | 'warning', label } | null
//     metadata:    type-specific bag (procedure: flowId, attemptId, …)
//   }
//
// Auth model (V1): token in URL = identity. No login. `portalEnabled`
// on the PersonRef is the kill switch — when false, the portal is 403
// regardless of token correctness.

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { flattenNodes } from './attempts.js';

const router = Router();

// ── Resolve token → PersonRef ──────────────────────────────────────
//
// Returns 404 (not 403) on bad token to avoid leaking the existence
// of a token-shaped value. Returns 403 only when the token IS valid
// but the portal is disabled — that's an intentional admin signal
// the user should see ("your portal access has been turned off") so
// the lockout is debuggable without leaking why.
async function resolvePerson(token) {
  if (!token || typeof token !== 'string') return { error: 'not_found' };
  const person = await prisma.personRef.findUnique({
    where: { portalToken: token },
  });
  if (!person) return { error: 'not_found' };
  if (!person.portalEnabled) return { error: 'disabled', person };
  if (person.status === 'blocked') return { error: 'disabled', person };
  return { person };
}

function notFound(res) {
  return res.status(404).json({ error: 'not_found' });
}
function disabled(res) {
  return res.status(403).json({ error: 'portal_disabled' });
}

// ── State derivation ───────────────────────────────────────────────
// Same logic as people.js procedures endpoint. Folded into the wire
// shape (status / badge) per the V1 spec: from the guide's POV,
// "submitted but not approved" reads as completed-with-a-hint, and
// "needs correction" reads as in-progress-with-a-warning.
function deriveTaskState(attempt) {
  if (!attempt) {
    return { status: 'not_started', badge: null };
  }
  if (attempt.status === 'in_progress') {
    return { status: 'in_progress', badge: null };
  }
  if (attempt.status === 'approved') {
    return { status: 'completed', badge: null };
  }
  if (attempt.status === 'submitted') {
    const latestPerNode = new Map();
    for (const ans of attempt.answers || []) {
      if (!latestPerNode.has(ans.flowNodeId)) {
        latestPerNode.set(ans.flowNodeId, ans);
      }
    }
    let rejected = false;
    for (const ans of latestPerNode.values()) {
      if (ans.status === 'rejected') {
        rejected = true;
        break;
      }
    }
    if (rejected) {
      return {
        status: 'in_progress',
        badge: { tone: 'warning', label: 'דורש תיקון' },
      };
    }
    return {
      status: 'completed',
      badge: { tone: 'info', label: 'ממתין לאישור' },
    };
  }
  return { status: 'in_progress', badge: null };
}

// ── Procedure-task collector ──────────────────────────────────────
//
// Today this is the only collector. When the next task type lands
// (training plans, tours, …), add its own collector and concat the
// results into the same `tasks` array — no client-side change needed.
async function collectProcedureTasks(person) {
  const visibleFlows = await prisma.flow.findMany({
    where: {
      status: 'published',
      OR: [
        { openToAll: true },
        person.teamRefId
          ? { targetTeams: { some: { teamRefId: person.teamRefId } } }
          : { id: '__never_match__' },
        { targetPeople: { some: { personRefId: person.id } } },
      ],
    },
    select: {
      id: true,
      title: true,
      description: true,
      mandatory: true,
      updatedAt: true,
    },
    orderBy: [{ mandatory: 'desc' }, { updatedAt: 'desc' }],
  });
  if (visibleFlows.length === 0) return [];

  // All attempts (latest per flow). Match by externalPersonId so the
  // link survives PersonRef row reshuffles, mirroring the convention
  // used elsewhere.
  const attempts = await prisma.attempt.findMany({
    where: {
      externalPersonId: person.externalPersonId,
      flowId: { in: visibleFlows.map((f) => f.id) },
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      answers: {
        select: { flowNodeId: true, version: true, status: true },
        orderBy: [{ flowNodeId: 'asc' }, { version: 'desc' }],
      },
    },
  });
  const latestByFlow = new Map();
  for (const a of attempts) {
    if (!latestByFlow.has(a.flowId)) latestByFlow.set(a.flowId, a);
  }

  return visibleFlows.map((f) => {
    const attempt = latestByFlow.get(f.id) || null;
    const { status, badge } = deriveTaskState(attempt);
    return {
      id: `procedure:${f.id}`,
      type: 'procedure',
      title: f.title || '(ללא שם)',
      description: f.description || null,
      status,
      badge,
      metadata: {
        flowId: f.id,
        attemptId: attempt?.id || null,
        mandatory: !!f.mandatory,
        submittedAt: attempt?.submittedAt || null,
        approvedAt: attempt?.approvedAt || null,
      },
    };
  });
}

// ── Sort: actionable first, then completed ─────────────────────────
//
// Sort key:
//   1. status: in_progress → not_started → completed
//   2. within in_progress: warning badges first (needs_correction)
//   3. within not_started: mandatory first
//   4. within completed: most recently approved/submitted first
function sortTasks(tasks) {
  const statusRank = { in_progress: 0, not_started: 1, completed: 2 };
  return [...tasks].sort((a, b) => {
    const r = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    if (r !== 0) return r;
    if (a.status === 'in_progress') {
      const aw = a.badge?.tone === 'warning' ? 0 : 1;
      const bw = b.badge?.tone === 'warning' ? 0 : 1;
      if (aw !== bw) return aw - bw;
    }
    if (a.status === 'not_started') {
      const am = a.metadata?.mandatory ? 0 : 1;
      const bm = b.metadata?.mandatory ? 0 : 1;
      if (am !== bm) return am - bm;
    }
    if (a.status === 'completed') {
      const at =
        a.metadata?.approvedAt ||
        a.metadata?.submittedAt ||
        '';
      const bt =
        b.metadata?.approvedAt ||
        b.metadata?.submittedAt ||
        '';
      if (at !== bt) return bt.localeCompare(at);
    }
    return (a.title || '').localeCompare(b.title || '', 'he');
  });
}

// ── GET /api/portal/:token ─────────────────────────────────────────
router.get(
  '/:token',
  handle(async (req, res) => {
    const r = await resolvePerson(req.params.token);
    if (r.error === 'not_found') return notFound(res);
    if (r.error === 'disabled') return disabled(res);
    const procedureTasks = await collectProcedureTasks(r.person);
    const tasks = sortTasks(procedureTasks);
    res.json({
      person: {
        displayName: r.person.displayName,
        // No id / externalPersonId leaked. The token is the only
        // identity the portal exposes.
      },
      tasks,
    });
  }),
);

// ── POST /api/portal/:token/tasks/:taskId/start ────────────────────
//
// Resolves the task id (`procedure:<flowId>` for now), reuses any
// existing attempt for that flow + person, or creates a new one with
// `externalPersonId` populated. Returns the attempt id so the client
// can navigate straight to /attempt/:attemptId — bypassing the name
// gate the public /flow/:id entry uses for unauthenticated users.
router.post(
  '/:token/tasks/:taskId/start',
  handle(async (req, res) => {
    const r = await resolvePerson(req.params.token);
    if (r.error === 'not_found') return notFound(res);
    if (r.error === 'disabled') return disabled(res);
    const person = r.person;

    const taskId = String(req.params.taskId || '');
    const sep = taskId.indexOf(':');
    if (sep < 0) {
      return res.status(400).json({ error: 'bad_task_id' });
    }
    const taskType = taskId.slice(0, sep);
    const refId = taskId.slice(sep + 1);

    if (taskType !== 'procedure') {
      return res.status(400).json({ error: 'unsupported_task_type' });
    }

    const flow = await prisma.flow.findUnique({
      where: { id: refId },
      include: { nodes: true },
    });
    if (!flow) return notFound(res);

    // Visibility re-check at start time. The list could have been
    // stale; we don't trust the client's claim that this task is
    // visible. The same OR set as collectProcedureTasks.
    const visible =
      flow.openToAll ||
      (await prisma.flowTargetPerson.findUnique({
        where: {
          flowId_personRefId: { flowId: flow.id, personRefId: person.id },
        },
      })) ||
      (person.teamRefId &&
        (await prisma.flowTargetTeam.findUnique({
          where: {
            flowId_teamRefId: {
              flowId: flow.id,
              teamRefId: person.teamRefId,
            },
          },
        })));
    if (!visible || flow.status !== 'published') {
      return res.status(403).json({ error: 'not_visible' });
    }

    // Reuse the most recent attempt regardless of status:
    //   * in_progress / submitted → resume / correct
    //   * approved → read-only view (the runtime already handles this)
    const existing = await prisma.attempt.findFirst({
      where: {
        flowId: flow.id,
        externalPersonId: person.externalPersonId,
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (existing) {
      return res.json({ attemptId: existing.id, resumed: true });
    }

    const linear = flattenNodes(flow.nodes);
    const firstNode = linear[0] || null;
    const created = await prisma.attempt.create({
      data: {
        flowId: flow.id,
        learnerName: person.displayName,
        externalPersonId: person.externalPersonId,
        status: 'in_progress',
        currentNodeId: firstNode ? firstNode.id : null,
      },
      select: { id: true },
    });
    res.status(201).json({ attemptId: created.id, resumed: false });
  }),
);

export default router;
