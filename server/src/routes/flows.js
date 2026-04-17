import { Router } from 'express';
import { prisma } from '../db.js';

const router = Router();

router.get('/', async (_req, res) => {
  const flows = await prisma.flow.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { attempts: true, nodes: true } } },
  });
  res.json(flows);
});

router.get('/:id', async (req, res) => {
  const flow = await prisma.flow.findUnique({
    where: { id: req.params.id },
    include: {
      nodes: {
        include: { contentItem: true, questionItem: true },
      },
    },
  });
  if (!flow) return res.status(404).json({ error: 'not found' });
  res.json(flow);
});

router.post('/', async (req, res) => {
  const { title = 'Untitled Flow', description = null } = req.body;
  const flow = await prisma.flow.create({ data: { title, description } });
  res.status(201).json(flow);
});

router.put('/:id', async (req, res) => {
  const { title, description, status } = req.body;
  const data = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (status !== undefined) data.status = status;
  const flow = await prisma.flow.update({ where: { id: req.params.id }, data });
  res.json(flow);
});

router.delete('/:id', async (req, res) => {
  await prisma.flow.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// Replace the flow's node tree.
// Client sends every node with a stable id (existing DB id or a client-generated id).
// Server upserts and deletes anything not in the incoming list.
router.put('/:id/nodes', async (req, res) => {
  const { nodes } = req.body;
  if (!Array.isArray(nodes)) return res.status(400).json({ error: 'nodes must be array' });
  const flowId = req.params.id;

  const incomingIds = nodes.map((n) => n.id).filter(Boolean);

  await prisma.$transaction(async (tx) => {
    // Delete nodes that are no longer present.
    await tx.flowNode.deleteMany({
      where: {
        flowId,
        id: { notIn: incomingIds.length ? incomingIds : ['__none__'] },
      },
    });

    // Pass 1: upsert with parentId cleared (avoids FK issues when parent order shifts).
    for (const n of nodes) {
      await tx.flowNode.upsert({
        where: { id: n.id },
        update: {
          order: n.order,
          kind: n.kind,
          contentItemId: n.contentItemId || null,
          questionItemId: n.questionItemId || null,
          groupTitle: n.groupTitle || null,
          checkpointAfter: !!n.checkpointAfter,
          parentId: null,
        },
        create: {
          id: n.id,
          flowId,
          order: n.order,
          kind: n.kind,
          contentItemId: n.contentItemId || null,
          questionItemId: n.questionItemId || null,
          groupTitle: n.groupTitle || null,
          checkpointAfter: !!n.checkpointAfter,
        },
      });
    }

    // Pass 2: set parent relationships.
    for (const n of nodes) {
      if (n.parentId) {
        await tx.flowNode.update({
          where: { id: n.id },
          data: { parentId: n.parentId },
        });
      }
    }

    await tx.flow.update({ where: { id: flowId }, data: { updatedAt: new Date() } });
  });

  const updated = await prisma.flow.findUnique({
    where: { id: flowId },
    include: {
      nodes: { include: { contentItem: true, questionItem: true } },
    },
  });
  res.json(updated);
});

export default router;
