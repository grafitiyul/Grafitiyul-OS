import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

const router = Router();

// Flatten a tree of flow nodes into a linear learner sequence.
// Groups are structural only — they don't produce learner steps.
export function flattenNodes(nodes, parentId = null) {
  const siblings = nodes
    .filter((n) => (n.parentId ?? null) === parentId)
    .sort((a, b) => a.order - b.order);
  const out = [];
  for (const n of siblings) {
    if (n.kind === 'group') {
      out.push(...flattenNodes(nodes, n.id));
    } else {
      out.push(n);
    }
  }
  return out;
}

// Compute the latest FlowAnswer per (attempt, flowNode). Input: all rows for
// an attempt. Returns a Map keyed by flowNodeId → latest row.
export function latestByNode(answers) {
  const byNode = new Map();
  for (const a of answers) {
    const cur = byNode.get(a.flowNodeId);
    if (!cur || a.version > cur.version) byNode.set(a.flowNodeId, a);
  }
  return byNode;
}

// List question nodes (linear order) that the learner must answer.
function questionNodes(linear) {
  return linear.filter((n) => n.kind === 'question');
}

// Which question nodes currently need (re)answering? Any question that has no
// answers yet, or whose latest answer is 'rejected'.
function outstandingQuestionIds(questions, latest) {
  const out = [];
  for (const q of questions) {
    const la = latest.get(q.id);
    if (!la || la.status === 'rejected') out.push(q.id);
  }
  return out;
}

router.post(
  '/',
  handle(async (req, res) => {
    const { flowId, learnerName, workerIdentifier } = req.body;
    if (!flowId || !learnerName) {
      return res.status(400).json({ error: 'flowId and learnerName required' });
    }
    const flow = await prisma.flow.findUnique({
      where: { id: flowId },
      include: { nodes: true },
    });
    if (!flow) return res.status(404).json({ error: 'flow not found' });

    const linear = flattenNodes(flow.nodes);
    const firstNode = linear[0] || null;

    const attempt = await prisma.attempt.create({
      data: {
        flowId,
        learnerName,
        workerIdentifier: workerIdentifier || null,
        status: 'in_progress',
        currentNodeId: firstNode ? firstNode.id : null,
      },
    });
    res.status(201).json(attempt);
  }),
);

router.get(
  '/:id',
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
    res.json(attempt);
  }),
);

// Auto-save: every learner edit on a question appends a NEW version.
// Never overwrites. Content nodes don't produce FlowAnswer rows.
router.post(
  '/:id/answer',
  handle(async (req, res) => {
    const { nodeId, openText, answerChoice, answerLabel } = req.body;
    const attempt = await prisma.attempt.findUnique({
      where: { id: req.params.id },
      include: { flow: { include: { nodes: true } } },
    });
    if (!attempt) return res.status(404).json({ error: 'attempt not found' });
    if (attempt.status === 'approved') {
      return res.status(400).json({ error: 'attempt already approved' });
    }
    const node = attempt.flow.nodes.find((n) => n.id === nodeId);
    if (!node) return res.status(400).json({ error: 'node not in flow' });
    if (node.kind !== 'question') {
      return res.status(400).json({ error: 'node is not a question' });
    }
    if (!node.questionItemId) {
      return res.status(400).json({ error: 'question node has no questionItemId' });
    }

    // Determine next version for (attempt, node).
    const last = await prisma.flowAnswer.findFirst({
      where: { attemptId: attempt.id, flowNodeId: nodeId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (last?.version ?? 0) + 1;

    const created = await prisma.flowAnswer.create({
      data: {
        attemptId: attempt.id,
        flowNodeId: nodeId,
        questionItemId: node.questionItemId,
        openText: openText ?? null,
        answerChoice: answerChoice ?? null,
        answerLabel: answerLabel ?? null,
        version: nextVersion,
        status: 'pending',
      },
    });
    res.json(created);
  }),
);

// Advance the current pointer. Unlike the old flow, advancing does NOT check
// checkpoints anymore — checkpoint review now happens only at /submit time on
// the whole attempt. Ends the attempt by setting currentNodeId=null when past
// the last node, but the attempt stays 'in_progress' until /submit.
router.post(
  '/:id/advance',
  handle(async (req, res) => {
    const attempt = await prisma.attempt.findUnique({
      where: { id: req.params.id },
      include: { flow: { include: { nodes: true } } },
    });
    if (!attempt) return res.status(404).json({ error: 'attempt not found' });
    if (attempt.status !== 'in_progress' && attempt.status !== 'submitted') {
      return res.status(400).json({ error: `cannot advance from ${attempt.status}` });
    }
    const linear = flattenNodes(attempt.flow.nodes);
    const currentIdx = linear.findIndex((n) => n.id === attempt.currentNodeId);
    const next = linear[currentIdx + 1];
    const updated = await prisma.attempt.update({
      where: { id: attempt.id },
      data: { currentNodeId: next ? next.id : null },
    });
    res.json(updated);
  }),
);

// Worker submit. Validates that every question has at least one answer, and
// that no rejected question is still missing a newer version. Idempotent:
// resubmitting after rejections also goes through here.
router.post(
  '/:id/submit',
  handle(async (req, res) => {
    const attempt = await prisma.attempt.findUnique({
      where: { id: req.params.id },
      include: {
        flow: { include: { nodes: true } },
        answers: true,
      },
    });
    if (!attempt) return res.status(404).json({ error: 'attempt not found' });
    if (attempt.status === 'approved') {
      return res.status(400).json({ error: 'already approved' });
    }
    const linear = flattenNodes(attempt.flow.nodes);
    const questions = questionNodes(linear);
    const latest = latestByNode(attempt.answers);

    const outstanding = outstandingQuestionIds(questions, latest);
    if (outstanding.length > 0) {
      return res.status(400).json({
        error: 'outstanding_questions',
        outstandingNodeIds: outstanding,
      });
    }

    const updated = await prisma.attempt.update({
      where: { id: attempt.id },
      data: {
        status: 'submitted',
        submittedAt: new Date(),
      },
    });
    res.json(updated);
  }),
);

// List outstanding question nodes for a submitted attempt that has had some
// questions rejected — used by the learner resubmit screen.
router.get(
  '/:id/outstanding',
  handle(async (req, res) => {
    const attempt = await prisma.attempt.findUnique({
      where: { id: req.params.id },
      include: {
        flow: {
          include: {
            nodes: { include: { contentItem: true, questionItem: true } },
          },
        },
        answers: true,
      },
    });
    if (!attempt) return res.status(404).json({ error: 'attempt not found' });

    const linear = flattenNodes(attempt.flow.nodes);
    const questions = questionNodes(linear);
    const latest = latestByNode(attempt.answers);
    const outstandingIds = new Set(outstandingQuestionIds(questions, latest));

    // For each outstanding question, include: question node + the content
    // nodes that precede it in the linear sequence (up to the previous
    // question), the last rejected answer, and the admin comment on it.
    const out = [];
    let precedingContent = [];
    for (const node of linear) {
      if (node.kind === 'content') {
        precedingContent.push(node);
        continue;
      }
      if (node.kind === 'question') {
        if (outstandingIds.has(node.id)) {
          const la = latest.get(node.id);
          out.push({
            node,
            precedingContent,
            lastAnswer: la || null,
          });
        }
        precedingContent = [];
      }
    }
    res.json({ attemptId: attempt.id, outstanding: out });
  }),
);

router.get(
  '/flow/:flowId',
  handle(async (req, res) => {
    const attempts = await prisma.attempt.findMany({
      where: { flowId: req.params.flowId },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(attempts);
  }),
);

export default router;
