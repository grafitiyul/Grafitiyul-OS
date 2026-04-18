import { Router } from 'express';
import { prisma } from '../db.js';
import { flattenNodes, latestByNode } from './attempts.js';
import { handle } from '../asyncHandler.js';

const router = Router();

// Recompute derived attempt status. Called after any per-question review.
// Rules:
//   - If every question's latest FlowAnswer.status === 'approved'     → attempt 'approved'
//   - Otherwise the attempt stays wherever it was (should be 'submitted' here)
async function recomputeAttemptStatus(attemptId) {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      flow: { include: { nodes: true } },
      answers: true,
    },
  });
  if (!attempt) return null;
  const linear = flattenNodes(attempt.flow.nodes);
  const questions = linear.filter((n) => n.kind === 'question');
  const latest = latestByNode(attempt.answers);
  if (questions.length === 0) return attempt;

  const allApproved = questions.every((q) => latest.get(q.id)?.status === 'approved');
  if (allApproved && attempt.status !== 'approved') {
    return prisma.attempt.update({
      where: { id: attempt.id },
      data: { status: 'approved', approvedAt: new Date() },
    });
  }
  // No demotion: if admin rejects a question on an already-approved attempt
  // (shouldn't happen in practice — UI blocks review of approved attempts),
  // we leave the attempt as-is rather than silently demoting it.
  return attempt;
}

// Full review payload for a single attempt. Groups data for the admin
// approval screen: questions in linear order, each with its full version
// history + the content nodes that precede it.
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
        answers: { orderBy: [{ flowNodeId: 'asc' }, { version: 'asc' }] },
      },
    });
    if (!attempt) return res.status(404).json({ error: 'not found' });

    const linear = flattenNodes(attempt.flow.nodes);
    const answersByNode = new Map();
    for (const a of attempt.answers) {
      const arr = answersByNode.get(a.flowNodeId) || [];
      arr.push(a);
      answersByNode.set(a.flowNodeId, arr);
    }

    // Build per-question blocks with preceding content.
    const blocks = [];
    let precedingContent = [];
    for (const node of linear) {
      if (node.kind === 'content') {
        precedingContent.push(node);
        continue;
      }
      if (node.kind === 'question') {
        const history = answersByNode.get(node.id) || [];
        const latest = history.length ? history[history.length - 1] : null;
        blocks.push({
          node,
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
router.post(
  '/attempts/:id/questions/:flowNodeId/approve',
  handle(async (req, res) => {
    const { id, flowNodeId } = req.params;
    const latest = await prisma.flowAnswer.findFirst({
      where: { attemptId: id, flowNodeId },
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
    const { id, flowNodeId } = req.params;
    const { comment } = req.body || {};
    if (!comment || !String(comment).trim()) {
      return res.status(400).json({ error: 'comment required' });
    }
    const latest = await prisma.flowAnswer.findFirst({
      where: { attemptId: id, flowNodeId },
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

// List attempts for admin views. Filter by status (default 'submitted'),
// optional flowId and workerIdentifier. Ordering: newest submission first.
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
        answers: { select: { flowNodeId: true, version: true, status: true } },
      },
    });
    // Summarise latest-version status counts per attempt.
    const summarised = attempts.map((a) => {
      const latest = latestByNode(a.answers);
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
