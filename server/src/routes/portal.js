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
import { buildExpansion } from '../services/flowExpansion.js';

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
// Compute the latest FlowAnswer per stepId and surface what the
// portal needs to know: is anything rejected (needs guide action),
// what's the most recent rejection comment, how many rejections.
function summariseAnswers(attempt) {
  if (!attempt || !attempt.answers) {
    return { rejectedCount: 0, rejectionComment: null };
  }
  const latestPerStep = new Map();
  for (const ans of attempt.answers) {
    const k = ans.stepId || ans.flowNodeId; // legacy back-compat
    if (!k) continue;
    const cur = latestPerStep.get(k);
    if (!cur || (ans.version || 0) > (cur.version || 0)) {
      latestPerStep.set(k, ans);
    }
  }
  let rejectedCount = 0;
  let rejectionComment = null;
  // Iterate in version-newest order. The first comment we find is
  // the most recent rejection's note.
  for (const ans of latestPerStep.values()) {
    if (ans.status === 'rejected') {
      rejectedCount += 1;
      if (!rejectionComment && ans.adminComment) {
        rejectionComment = ans.adminComment;
      }
    }
  }
  return { rejectedCount, rejectionComment };
}

// Five-state classification, finer than the original 3-status model.
// The portal renders one section per "kind" so guides can see at a
// glance what's blocked, what's pending, and what's done.
//
//   not_started     — no attempt yet
//   in_progress     — started, not yet submitted
//   needs_correction— submitted, at least one answer was rejected
//                     by the admin (action required from the guide)
//   pending_review  — submitted, no rejections, waiting on admin
//   approved        — admin approved everything
function classifyAttempt(attempt) {
  if (!attempt) return { kind: 'not_started' };
  if (attempt.status === 'approved') return { kind: 'approved' };
  if (attempt.status === 'in_progress') return { kind: 'in_progress' };
  if (attempt.status === 'submitted') {
    const summary = summariseAnswers(attempt);
    if (summary.rejectedCount > 0) {
      return { kind: 'needs_correction', ...summary };
    }
    return { kind: 'pending_review' };
  }
  return { kind: 'in_progress' };
}

// Map a classified attempt to a coarse `status` for badge / styling
// back-compat. The new portal renders by `bucket` directly; keeping
// `status` mostly preserves the older "not_started/in_progress/
// completed" shape for any consumer that still reads it.
function statusFor(kind) {
  if (kind === 'not_started') return 'not_started';
  if (kind === 'approved' || kind === 'pending_review') return 'completed';
  return 'in_progress';
}

function badgeFor(kind) {
  if (kind === 'needs_correction')
    return { tone: 'warning', label: 'דורש תיקון' };
  if (kind === 'pending_review')
    return { tone: 'info', label: 'ממתין לבדיקה' };
  return null;
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
  // used elsewhere. Answers include adminComment so we can show the
  // most recent rejection note on the task card.
  const attempts = await prisma.attempt.findMany({
    where: {
      externalPersonId: person.externalPersonId,
      flowId: { in: visibleFlows.map((f) => f.id) },
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      answers: {
        select: {
          stepId: true,
          flowNodeId: true,
          version: true,
          status: true,
          adminComment: true,
        },
        orderBy: [{ stepId: 'asc' }, { version: 'desc' }],
      },
    },
  });
  const latestByFlow = new Map();
  for (const a of attempts) {
    if (!latestByFlow.has(a.flowId)) latestByFlow.set(a.flowId, a);
  }

  return visibleFlows.map((f) => {
    const attempt = latestByFlow.get(f.id) || null;
    const cls = classifyAttempt(attempt);
    const status = statusFor(cls.kind);
    const badge = badgeFor(cls.kind);
    return {
      id: `procedure:${f.id}`,
      type: 'procedure',
      title: f.title || '(ללא שם)',
      description: f.description || null,
      status,
      // Visual grouping in the portal feed. Five buckets so guides
      // can see review status at a glance:
      //   correction      — admin asked for changes (highest priority)
      //   todo            — needs to be started or continued
      //   available       — optional, visible for browsing
      //   pending_review  — submitted, waiting on admin
      //   approved        — done, positive feedback
      bucket: bucketFor(cls.kind, f.mandatory),
      badge,
      metadata: {
        flowId: f.id,
        attemptId: attempt?.id || null,
        mandatory: !!f.mandatory,
        submittedAt: attempt?.submittedAt || null,
        approvedAt: attempt?.approvedAt || null,
        // Surfaced only for needs_correction attempts. The portal
        // card uses these to render the urgency banner + comment
        // snippet so the guide sees what to fix without entering
        // the runtime first.
        rejectedCount: cls.rejectedCount || 0,
        rejectionComment: cls.rejectionComment || null,
      },
    };
  });
}

function bucketFor(kind, mandatory) {
  if (kind === 'needs_correction') return 'correction';
  if (kind === 'approved') return 'approved';
  if (kind === 'pending_review') return 'pending_review';
  if (kind === 'in_progress') return 'todo';
  // not_started: mandatory goes to "todo" (guide must start it),
  // optional goes to "available" (the read-when-you-want shelf).
  return mandatory ? 'todo' : 'available';
}

// Sort by bucket priority, then by mandatory + recency within each.
// The client groups by `bucket` for rendering, so within-bucket order
// is what matters most; the cross-bucket order is a defensive fallback
// for any consumer that renders without sectioning.
const BUCKET_RANK = {
  correction: 0,
  todo: 1,
  available: 2,
  pending_review: 3,
  approved: 4,
};
function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const r = (BUCKET_RANK[a.bucket] ?? 99) - (BUCKET_RANK[b.bucket] ?? 99);
    if (r !== 0) return r;
    const am = a.metadata?.mandatory ? 0 : 1;
    const bm = b.metadata?.mandatory ? 0 : 1;
    if (am !== bm) return am - bm;
    const at =
      a.metadata?.submittedAt ||
      a.metadata?.approvedAt ||
      '';
    const bt =
      b.metadata?.submittedAt ||
      b.metadata?.approvedAt ||
      '';
    if (at !== bt) return bt.localeCompare(at);
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
    // Diagnostic — surfaces the bucket classification of every task
    // for this request. If the portal's review-status sections are
    // missing on the client, this log is the ground truth: it tells
    // us exactly which bucket each attempt landed in, so we can
    // distinguish "no test data exists" from "classification bug"
    // from "stale deploy" without guessing.
    console.log('[portal tasks]', {
      personId: r.person.id,
      taskCount: tasks.length,
      buckets: tasks.map((t) => ({
        id: t.id,
        bucket: t.bucket,
        status: t.status,
        rejectedCount: t.metadata?.rejectedCount || 0,
        attemptId: t.metadata?.attemptId || null,
      })),
    });
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

// ── GET /api/portal/:token/attempts/:attemptId/review-status ──────
//
// Lightweight, polling-friendly view of an attempt's per-question
// review state. Used by the runtime's review-status bar and the
// portal-home summary. Intentionally separate from the heavy
// /api/attempts/:id payload so the runtime can poll every 10s and
// refresh after focus/visibility changes WITHOUT triggering the
// full attempt remount (which would reset scroll, blow away in-flight
// answer drafts, and re-fire the step animation).
//
// Authz: token resolves a PersonRef; the attempt must belong to the
// same external person. We never expose other people's attempts even
// if the attemptId is guessed correctly.
//
// Response shape:
//   {
//     attemptId,
//     attemptStatus,                  // 'in_progress' | 'submitted' | 'approved'
//     counts: { pending, approved, rejected },
//     questions: [
//       { stepId, title, status, adminComment }
//     ]
//   }
//
// `status` is the latest FlowAnswer's status per question step, with
// 'unanswered' for question steps that have no answer yet (so the
// modal can render every question even before the learner answers).
router.get(
  '/:token/attempts/:attemptId/review-status',
  handle(async (req, res) => {
    const r = await resolvePerson(req.params.token);
    if (r.error === 'not_found') return notFound(res);
    if (r.error === 'disabled') return disabled(res);
    const person = r.person;

    const attempt = await prisma.attempt.findUnique({
      where: { id: req.params.attemptId },
      include: {
        flow: { include: { nodes: true } },
        answers: {
          select: {
            stepId: true,
            flowNodeId: true,
            version: true,
            status: true,
            adminComment: true,
            answerChoice: true,
            answerLabel: true,
            openText: true,
          },
        },
      },
    });
    if (!attempt) return notFound(res);
    if (attempt.externalPersonId !== person.externalPersonId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    // Reuse the persisted expansion when present; fall back to a fresh
    // build for legacy attempts that were created before the
    // expansion column existed. Read-only path — never persists.
    const steps =
      attempt.expansion?.steps && attempt.expansion.steps.length > 0
        ? attempt.expansion.steps
        : (await buildExpansion(prisma, attempt.flow)).steps;

    const questionSteps = steps.filter((s) => s.kind === 'question');

    // Hydrate question titles in a single round-trip.
    const questionIds = [
      ...new Set(
        questionSteps
          .map((s) => s.questionItemId)
          .filter((id) => typeof id === 'string'),
      ),
    ];
    const questionItems =
      questionIds.length > 0
        ? await prisma.questionItem.findMany({
            where: { id: { in: questionIds } },
            select: { id: true, title: true },
          })
        : [];
    const titleById = new Map(questionItems.map((q) => [q.id, q.title || '']));

    // Latest answer per stepId.
    const latestByStep = new Map();
    for (const a of attempt.answers) {
      const k = a.stepId || a.flowNodeId;
      if (!k) continue;
      const cur = latestByStep.get(k);
      if (!cur || (a.version || 0) > (cur.version || 0)) {
        latestByStep.set(k, a);
      }
    }

    let pending = 0;
    let approved = 0;
    let rejected = 0;
    const questions = questionSteps.map((s) => {
      const la = latestByStep.get(s.stepId);
      let status;
      if (!la) status = 'unanswered';
      else if (la.status === 'approved') status = 'approved';
      else if (la.status === 'rejected') status = 'rejected';
      else status = 'pending';
      if (status === 'pending') pending += 1;
      else if (status === 'approved') approved += 1;
      else if (status === 'rejected') rejected += 1;
      return {
        stepId: s.stepId,
        title: titleById.get(s.questionItemId) || '',
        status,
        adminComment: la?.adminComment || null,
      };
    });

    res.set('Cache-Control', 'no-store');
    res.json({
      attemptId: attempt.id,
      attemptStatus: attempt.status,
      counts: { pending, approved, rejected },
      questions,
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

    // Resume any active attempt (in_progress / submitted). For an
    // approved attempt we DON'T resume — the user is clicking התחל
    // (or המשך) on a task card that may have been (mis-)labelled, and
    // the safer behaviour is to start a fresh run rather than send
    // them to a read-only ApprovedBrowser they didn't ask for. Future
    // UX could expose explicit "view past attempt" links; today the
    // sectioned task feed surfaces approvals separately under
    // "הושלמו".
    const existing = await prisma.attempt.findFirst({
      where: {
        flowId: flow.id,
        externalPersonId: person.externalPersonId,
        status: { in: ['in_progress', 'submitted'] },
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (existing) {
      return res.json({ attemptId: existing.id, resumed: true });
    }

    // Snapshot the flow's structure (incl. folderRef expansions) at
    // attempt creation. In-flight attempts stay stable; new attempts
    // pick up the latest bank state on every fresh start.
    const expansion = await buildExpansion(prisma, flow);
    const firstStep = expansion.steps[0] || null;
    console.log('[portal] new attempt creation', {
      flowId: flow.id,
      personId: person.id,
      stepCount: expansion.steps.length,
      firstStepId: firstStep?.stepId || null,
      firstStepKind: firstStep?.kind || null,
    });
    const created = await prisma.attempt.create({
      data: {
        flowId: flow.id,
        learnerName: person.displayName,
        externalPersonId: person.externalPersonId,
        status: 'in_progress',
        expansion,
        currentStepId: firstStep ? firstStep.stepId : null,
        currentNodeId: firstStep?.flowNodeId || null,
      },
      select: { id: true },
    });
    res.status(201).json({ attemptId: created.id, resumed: false });
  }),
);

export default router;
