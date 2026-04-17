import { Router } from 'express';
import { prisma } from '../db.js';

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

// Create attempt
router.post('/', async (req, res) => {
  const { flowId, learnerName } = req.body;
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
      status: firstNode ? 'in_progress' : 'completed',
      currentNodeId: firstNode ? firstNode.id : null,
    },
  });
  res.status(201).json(attempt);
});

// Get attempt (full state for learner runtime)
router.get('/:id', async (req, res) => {
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
  if (!attempt) return res.status(404).json({ error: 'not found' });
  res.json(attempt);
});

// Submit an answer (question nodes only)
router.post('/:id/answer', async (req, res) => {
  const { nodeId, openText, selectedOption } = req.body;
  const attempt = await prisma.attempt.findUnique({ where: { id: req.params.id } });
  if (!attempt) return res.status(404).json({ error: 'attempt not found' });

  await prisma.answer.upsert({
    where: { attemptId_flowNodeId: { attemptId: attempt.id, flowNodeId: nodeId } },
    update: {
      openText: openText ?? null,
      selectedOption: selectedOption ?? null,
      reviewStatus: 'pending',
      submittedAt: new Date(),
      reviewedAt: null,
    },
    create: {
      attemptId: attempt.id,
      flowNodeId: nodeId,
      openText: openText ?? null,
      selectedOption: selectedOption ?? null,
    },
  });
  res.json({ ok: true });
});

// Advance to the next node. Triggers checkpoint (awaiting_review) or completion.
router.post('/:id/advance', async (req, res) => {
  const attempt = await prisma.attempt.findUnique({
    where: { id: req.params.id },
    include: { flow: { include: { nodes: true } } },
  });
  if (!attempt) return res.status(404).json({ error: 'attempt not found' });
  if (attempt.status !== 'in_progress') {
    return res.status(400).json({ error: `cannot advance from ${attempt.status}` });
  }

  const linear = flattenNodes(attempt.flow.nodes);
  const currentIdx = linear.findIndex((n) => n.id === attempt.currentNodeId);
  const currentNode = linear[currentIdx];

  if (currentNode && currentNode.checkpointAfter) {
    const updated = await prisma.attempt.update({
      where: { id: attempt.id },
      data: { status: 'awaiting_review' },
    });
    return res.json(updated);
  }

  const next = linear[currentIdx + 1];
  if (!next) {
    const updated = await prisma.attempt.update({
      where: { id: attempt.id },
      data: { status: 'completed', currentNodeId: null },
    });
    return res.json(updated);
  }

  const updated = await prisma.attempt.update({
    where: { id: attempt.id },
    data: { currentNodeId: next.id },
  });
  res.json(updated);
});

// Learner resumes after the admin returned their segment for correction.
router.post('/:id/resume', async (req, res) => {
  const attempt = await prisma.attempt.findUnique({ where: { id: req.params.id } });
  if (!attempt) return res.status(404).json({ error: 'not found' });
  if (attempt.status !== 'returned') {
    return res.status(400).json({ error: `cannot resume from ${attempt.status}` });
  }
  const updated = await prisma.attempt.update({
    where: { id: attempt.id },
    data: { status: 'in_progress' },
  });
  res.json(updated);
});

// List attempts for a flow (admin review list)
router.get('/flow/:flowId', async (req, res) => {
  const attempts = await prisma.attempt.findMany({
    where: { flowId: req.params.flowId },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(attempts);
});

export default router;
