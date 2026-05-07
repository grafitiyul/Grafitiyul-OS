import { Router } from 'express';
import { prisma } from '../db.js';
import { latestByStep } from './attempts.js';
import { buildExpansion } from '../services/flowExpansion.js';
import { handle } from '../asyncHandler.js';

const router = Router();

// Local copy of the steps resolver — same shape as in attempts.js. We
// don't import the resolver from attempts.js because that would create
// a router-level cycle (attempts.js exports the router as default; the
// helpers it exports are smaller, more stable).
function legacyStepsFromFlow(flow) {
  const childrenByParent = new Map();
  for (const n of flow?.nodes || []) {
    const key = n.parentId || null;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(n);
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  const steps = [];
  function visit(parentId) {
    for (const node of childrenByParent.get(parentId) || []) {
      if (node.kind === 'group') {
        visit(node.id);
        continue;
      }
      if (node.kind === 'content' || node.kind === 'question') {
        steps.push({
          stepId: node.id,
          kind: node.kind,
          flowNodeId: node.id,
          contentItemId: node.contentItemId || null,
          questionItemId: node.questionItemId || null,
          contentItem: node.contentItem || null,
          questionItem: node.questionItem || null,
          checkpointAfter: !!node.checkpointAfter,
        });
      }
    }
  }
  visit(null);
  return steps;
}

// Hydrate steps for the review screen. For folderRef-derived steps we
// look up the live ContentItem/QuestionItem rows; for direct steps we
// already have them eager-loaded with the flow nodes.
//
// If the attempt predates the folderRef slice (`expansion=null`), we
// build a fresh expansion using the current bank state. This is a
// READ-ONLY rebuild — we don't persist back to the attempt from the
// review path; we only need a step list so the review UI can show
// answer history. Persisting is the runtime's responsibility.
async function hydrateSteps(attempt) {
  let expansion = attempt.expansion;
  if (
    !expansion ||
    !Array.isArray(expansion.steps) ||
    expansion.steps.length === 0
  ) {
    if (attempt.flow && Array.isArray(attempt.flow.nodes)) {
      expansion = await buildExpansion(prisma, attempt.flow);
    }
  }
  const raw =
    expansion?.steps && expansion.steps.length > 0
      ? expansion.steps
      : legacyStepsFromFlow(attempt.flow);
  const flowNodeById = new Map();
  for (const n of attempt.flow?.nodes || []) {
    flowNodeById.set(n.id, n);
  }

  const missingContentIds = new Set();
  const missingQuestionIds = new Set();
  for (const s of raw) {
    if (s.flowNodeId) continue; // FlowNode include carries items already
    if (s.contentItemId) missingContentIds.add(s.contentItemId);
    if (s.questionItemId) missingQuestionIds.add(s.questionItemId);
  }
  const [content, questions] = await Promise.all([
    missingContentIds.size > 0
      ? prisma.contentItem.findMany({
          where: { id: { in: [...missingContentIds] } },
        })
      : Promise.resolve([]),
    missingQuestionIds.size > 0
      ? prisma.questionItem.findMany({
          where: { id: { in: [...missingQuestionIds] } },
        })
      : Promise.resolve([]),
  ]);
  const contentById = new Map(content.map((c) => [c.id, c]));
  const questionById = new Map(questions.map((q) => [q.id, q]));

  return raw.map((s) => {
    if (s.flowNodeId) {
      const fn = flowNodeById.get(s.flowNodeId);
      return {
        ...s,
        contentItem: fn?.contentItem || null,
        questionItem: fn?.questionItem || null,
      };
    }
    return {
      ...s,
      contentItem: s.contentItemId
        ? contentById.get(s.contentItemId) || null
        : null,
      questionItem: s.questionItemId
        ? questionById.get(s.questionItemId) || null
        : null,
    };
  });
}

// Recompute derived attempt status. Called after any per-question review.
// All steps (including folderRef-expanded) must have an approved latest
// answer for the attempt to flip to 'approved'.
async function recomputeAttemptStatus(attemptId) {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      flow: { include: { nodes: true } },
      answers: true,
    },
  });
  if (!attempt) return null;
  const steps = await hydrateSteps(attempt);
  const questions = steps.filter((s) => s.kind === 'question');
  const latest = latestByStep(attempt.answers);
  if (questions.length === 0) return attempt;

  const allApproved = questions.every(
    (q) => latest.get(q.stepId)?.status === 'approved',
  );
  if (allApproved && attempt.status !== 'approved') {
    return prisma.attempt.update({
      where: { id: attempt.id },
      data: { status: 'approved', approvedAt: new Date() },
    });
  }
  return attempt;
}

// Full review payload for a single attempt. Builds question blocks in
// runtime visit order — directly mirrors what the learner saw.
router.get(
  '/attempts/:id',
  handle(async (req, res) => {
    const attempt = await prisma.attempt.findUnique({
      where: { id: req.params.id },
      include: {
        flow: {
          include: {
            nodes: { include: { contentItem: true, questionItem: true } },
          },
        },
        answers: { orderBy: [{ stepId: 'asc' }, { version: 'asc' }] },
      },
    });
    if (!attempt) return res.status(404).json({ error: 'not found' });

    const steps = await hydrateSteps(attempt);
    const answersByStep = new Map();
    for (const a of attempt.answers) {
      const arr = answersByStep.get(a.stepId) || [];
      arr.push(a);
      answersByStep.set(a.stepId, arr);
    }

    const blocks = [];
    let precedingContent = [];
    for (const step of steps) {
      if (step.kind === 'content') {
        precedingContent.push(step);
        continue;
      }
      if (step.kind === 'question') {
        const history = answersByStep.get(step.stepId) || [];
        const latest = history.length ? history[history.length - 1] : null;
        blocks.push({
          step,
          // Back-compat: legacy clients expected `node`.
          node: step,
          precedingContent,
          history,
          latest,
        });
        precedingContent = [];
      }
    }

    res.json({
      attempt: {
        id: attempt.id,
        flowId: attempt.flowId,
        learnerName: attempt.learnerName,
        workerIdentifier: attempt.workerIdentifier,
        status: attempt.status,
        submittedAt: attempt.submittedAt,
        approvedAt: attempt.approvedAt,
        createdAt: attempt.createdAt,
        updatedAt: attempt.updatedAt,
      },
      flow: { id: attempt.flow.id, title: attempt.flow.title },
      blocks,
    });
  }),
);

// Approve the latest version of a specific question on an attempt.
// URL param historically called :flowNodeId — kept for client back-
// compat, but it's now treated as a stepId (which equals flowNodeId
// for non-folderRef answers, the only kind that existed pre-slice).
router.post(
  '/attempts/:id/questions/:flowNodeId/approve',
  handle(async (req, res) => {
    const { id, flowNodeId: stepId } = req.params;
    const latest = await prisma.flowAnswer.findFirst({
      where: { attemptId: id, stepId },
      orderBy: { version: 'desc' },
    });
    if (!latest) return res.status(404).json({ error: 'no answer to approve' });
    if (latest.status === 'approved') return res.json(latest);

    const updated = await prisma.flowAnswer.update({
      where: { id: latest.id },
      data: {
        status: 'approved',
        adminComment: null,
        reviewedAt: new Date(),
      },
    });
    await recomputeAttemptStatus(id);
    res.json(updated);
  }),
);

// Reject the latest version of a specific question with a comment.
router.post(
  '/attempts/:id/questions/:flowNodeId/reject',
  handle(async (req, res) => {
    const { id, flowNodeId: stepId } = req.params;
    const { comment } = req.body || {};
    if (!comment || !String(comment).trim()) {
      return res.status(400).json({ error: 'comment required' });
    }
    const latest = await prisma.flowAnswer.findFirst({
      where: { attemptId: id, stepId },
      orderBy: { version: 'desc' },
    });
    if (!latest) return res.status(404).json({ error: 'no answer to reject' });

    const updated = await prisma.flowAnswer.update({
      where: { id: latest.id },
      data: {
        status: 'rejected',
        adminComment: String(comment).trim(),
        reviewedAt: new Date(),
      },
    });
    res.json(updated);
  }),
);

// List attempts for admin views. Counts are over latest-per-step.
router.get(
  '/attempts',
  handle(async (req, res) => {
    const { status, flowId, workerIdentifier } = req.query;
    const where = {};
    if (status) where.status = String(status);
    if (flowId) where.flowId = String(flowId);
    if (workerIdentifier) where.workerIdentifier = String(workerIdentifier);

    const attempts = await prisma.attempt.findMany({
      where,
      orderBy: [{ submittedAt: 'desc' }, { updatedAt: 'desc' }],
      include: {
        flow: { select: { id: true, title: true } },
        answers: { select: { stepId: true, version: true, status: true } },
      },
    });
    const summarised = attempts.map((a) => {
      const latest = latestByStep(a.answers);
      let pending = 0;
      let approved = 0;
      let rejected = 0;
      for (const la of latest.values()) {
        if (la.status === 'approved') approved++;
        else if (la.status === 'rejected') rejected++;
        else pending++;
      }
      return {
        id: a.id,
        flowId: a.flowId,
        flowTitle: a.flow.title,
        learnerName: a.learnerName,
        workerIdentifier: a.workerIdentifier,
        status: a.status,
        submittedAt: a.submittedAt,
        approvedAt: a.approvedAt,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        counts: { pending, approved, rejected },
      };
    });
    res.json(summarised);
  }),
);

export default router;
