import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

const router = Router();

router.get(
  '/',
  handle(async (_req, res) => {
    const flows = await prisma.flow.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { attempts: true, nodes: true } } },
    });
    res.json(flows);
  }),
);

// Atomic reorder. Declared before /:id routes — Express matches in order.
router.put(
  '/reorder',
  handle(async (req, res) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids_array_required' });
    }
    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.flow.updateMany({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    res.json({ ok: true });
  }),
);

router.get(
  '/:id',
  handle(async (req, res) => {
    const flow = await prisma.flow.findUnique({
      where: { id: req.params.id },
      include: {
        nodes: { include: { contentItem: true, questionItem: true } },
      },
    });
    if (!flow) return res.status(404).json({ error: 'not found' });
    res.json(flow);
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const { title = 'Untitled Flow', description = null } = req.body;
    // Append new flows at the bottom of the list (max sortOrder + 1).
    const top = await prisma.flow.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const sortOrder = (top?.sortOrder ?? -1) + 1;
    const flow = await prisma.flow.create({
      data: { title, description, sortOrder },
    });
    res.status(201).json(flow);
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const { title, description, status } = req.body;
    const data = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (status !== undefined) data.status = status;
    const flow = await prisma.flow.update({ where: { id: req.params.id }, data });
    res.json(flow);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    await prisma.flow.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// Replace the flow's node tree (stable ids come from the client).
router.put(
  '/:id/nodes',
  handle(async (req, res) => {
    const { nodes } = req.body;
    if (!Array.isArray(nodes)) return res.status(400).json({ error: 'nodes must be array' });
    const flowId = req.params.id;
    const incomingIds = nodes.map((n) => n.id).filter(Boolean);

    await prisma.$transaction(async (tx) => {
      await tx.flowNode.deleteMany({
        where: { flowId, id: { notIn: incomingIds.length ? incomingIds : ['__none__'] } },
      });
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
      for (const n of nodes) {
        if (n.parentId) {
          await tx.flowNode.update({ where: { id: n.id }, data: { parentId: n.parentId } });
        }
      }
      await tx.flow.update({ where: { id: flowId }, data: { updatedAt: new Date() } });
    });

    const updated = await prisma.flow.findUnique({
      where: { id: flowId },
      include: { nodes: { include: { contentItem: true, questionItem: true } } },
    });
    res.json(updated);
  }),
);

export default router;
