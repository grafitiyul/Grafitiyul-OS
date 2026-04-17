import { Router } from 'express';
import { prisma } from '../db.js';
import { flattenNodes } from './attempts.js';
import { handle } from '../asyncHandler.js';

const router = Router();

router.post(
  '/attempts/:id/approve',
  handle(async (req, res) => {
    const attempt = await prisma.attempt.findUnique({
      where: { id: req.params.id },
      include: { flow: { include: { nodes: true } } },
    });
    if (!attempt) return res.status(404).json({ error: 'not found' });
    if (attempt.status !== 'awaiting_review') {
      return res.status(400).json({ error: `cannot approve from ${attempt.status}` });
    }

    const linear = flattenNodes(attempt.flow.nodes);
    const idx = linear.findIndex((n) => n.id === attempt.currentNodeId);
    const next = linear[idx + 1];

    await prisma.answer.updateMany({
      where: { attemptId: attempt.id, reviewStatus: 'pending' },
      data: { reviewStatus: 'approved', reviewedAt: new Date() },
    });

    const updated = await prisma.attempt.update({
      where: { id: attempt.id },
      data: {
        status: next ? 'in_progress' : 'completed',
        currentNodeId: next ? next.id : null,
        reviewNote: null,
      },
    });
    res.json(updated);
  }),
);

router.post(
  '/attempts/:id/return',
  handle(async (req, res) => {
    const { note } = req.body;
    const attempt = await prisma.attempt.findUnique({
      where: { id: req.params.id },
      include: { flow: { include: { nodes: true } } },
    });
    if (!attempt) return res.status(404).json({ error: 'not found' });
    if (attempt.status !== 'awaiting_review') {
      return res.status(400).json({ error: `cannot return from ${attempt.status}` });
    }

    const linear = flattenNodes(attempt.flow.nodes);
    const currentIdx = linear.findIndex((n) => n.id === attempt.currentNodeId);

    let segmentStart = 0;
    for (let i = currentIdx - 1; i >= 0; i--) {
      if (linear[i].checkpointAfter) {
        segmentStart = i + 1;
        break;
      }
    }

    await prisma.answer.updateMany({
      where: { attemptId: attempt.id, reviewStatus: 'pending' },
      data: { reviewStatus: 'returned', reviewedAt: new Date() },
    });

    const updated = await prisma.attempt.update({
      where: { id: attempt.id },
      data: {
        status: 'returned',
        currentNodeId: linear[segmentStart]?.id || null,
        reviewNote: note || null,
      },
    });
    res.json(updated);
  }),
);

export default router;
