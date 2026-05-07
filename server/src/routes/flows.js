import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import {
  buildExpansion,
  buildExpansionWithDiagnostics,
} from '../services/flowExpansion.js';

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
        nodes: {
          include: {
            contentItem: true,
            questionItem: true,
            bankFolder: true,
          },
        },
      },
    });
    if (!flow) return res.status(404).json({ error: 'not found' });
    res.json(flow);
  }),
);

// Live, on-demand expansion. Used by preview mode (/flow/:id?preview=1)
// where there's no Attempt to snapshot from. Returns the same `steps`
// shape the runtime consumes off Attempt.expansion, with hydrated
// content/question items so the client can render directly.
router.get(
  '/:id/expansion',
  handle(async (req, res) => {
    const flow = await prisma.flow.findUnique({
      where: { id: req.params.id },
      include: {
        nodes: { include: { bankFolder: true } },
      },
    });
    if (!flow) return res.status(404).json({ error: 'not found' });
    const expansion = await buildExpansion(prisma, flow);
    const steps = expansion.steps;
    if (steps.length === 0) {
      return res.json({ steps: [] });
    }
    const contentIds = new Set();
    const questionIds = new Set();
    for (const s of steps) {
      if (s.contentItemId) contentIds.add(s.contentItemId);
      if (s.questionItemId) questionIds.add(s.questionItemId);
    }
    const [content, questions] = await Promise.all([
      contentIds.size > 0
        ? prisma.contentItem.findMany({
            where: { id: { in: [...contentIds] } },
          })
        : Promise.resolve([]),
      questionIds.size > 0
        ? prisma.questionItem.findMany({
            where: { id: { in: [...questionIds] } },
          })
        : Promise.resolve([]),
    ]);
    const contentById = new Map(content.map((c) => [c.id, c]));
    const questionById = new Map(questions.map((q) => [q.id, q]));
    res.json({
      steps: steps.map((s) => ({
        ...s,
        contentItem: s.contentItemId
          ? contentById.get(s.contentItemId) || null
          : null,
        questionItem: s.questionItemId
          ? questionById.get(s.questionItemId) || null
          : null,
      })),
    });
  }),
);

// Diagnostic dump for a flow — raw nodes (incl. bankFolderId), live
// expansion, bank snapshot summary. Designed to be hit directly with
// curl/browser when something looks broken at runtime.
router.get(
  '/:id/debug',
  handle(async (req, res) => {
    const flow = await prisma.flow.findUnique({
      where: { id: req.params.id },
      include: {
        nodes: { include: { bankFolder: true } },
      },
    });
    if (!flow) return res.status(404).json({ error: 'not_found' });
    const diag = await buildExpansionWithDiagnostics(prisma, flow);
    res.json({
      flowId: flow.id,
      title: flow.title,
      status: flow.status,
      nodes: (flow.nodes || []).map((n) => ({
        id: n.id,
        parentId: n.parentId,
        order: n.order,
        kind: n.kind,
        bankFolderId: n.bankFolderId,
        bankFolderName: n.bankFolder?.name ?? null,
        contentItemId: n.contentItemId,
        questionItemId: n.questionItemId,
        groupTitle: n.groupTitle,
      })),
      expansion: diag.expansion,
      folderRefTrace: diag.folderRefTrace,
      bankSummary: diag.bankSummary,
    });
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
    const { title, description, status, openToAll, mandatory } = req.body;
    const data = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (status !== undefined) data.status = status;
    if (openToAll !== undefined) data.openToAll = !!openToAll;
    if (mandatory !== undefined) data.mandatory = !!mandatory;
    const flow = await prisma.flow.update({ where: { id: req.params.id }, data });
    res.json(flow);
  }),
);

// ---------- Assignment ----------
// Read the full assignment picture for a flow: flags + target team ids +
// target person ids. Returned as ids (not embedded rows) so the client
// can fetch name metadata independently.
router.get(
  '/:id/assignment',
  handle(async (req, res) => {
    const flow = await prisma.flow.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        openToAll: true,
        mandatory: true,
        targetTeams: { select: { teamRefId: true } },
        targetPeople: { select: { personRefId: true } },
      },
    });
    if (!flow) return res.status(404).json({ error: 'not found' });
    res.json({
      openToAll: flow.openToAll,
      mandatory: flow.mandatory,
      teamRefIds: flow.targetTeams.map((t) => t.teamRefId),
      personRefIds: flow.targetPeople.map((p) => p.personRefId),
    });
  }),
);

// Replace the assignment set atomically. Any of openToAll / teamRefIds /
// personRefIds can be omitted and will be left untouched.
router.put(
  '/:id/assignment',
  handle(async (req, res) => {
    const flowId = req.params.id;
    const { openToAll, mandatory, teamRefIds, personRefIds } = req.body || {};

    await prisma.$transaction(async (tx) => {
      const flowData = {};
      if (openToAll !== undefined) flowData.openToAll = !!openToAll;
      if (mandatory !== undefined) flowData.mandatory = !!mandatory;
      if (Object.keys(flowData).length) {
        await tx.flow.update({ where: { id: flowId }, data: flowData });
      }
      if (Array.isArray(teamRefIds)) {
        await tx.flowTargetTeam.deleteMany({ where: { flowId } });
        if (teamRefIds.length) {
          await tx.flowTargetTeam.createMany({
            data: teamRefIds.map((teamRefId) => ({ flowId, teamRefId })),
            skipDuplicates: true,
          });
        }
      }
      if (Array.isArray(personRefIds)) {
        await tx.flowTargetPerson.deleteMany({ where: { flowId } });
        if (personRefIds.length) {
          await tx.flowTargetPerson.createMany({
            data: personRefIds.map((personRefId) => ({ flowId, personRefId })),
            skipDuplicates: true,
          });
        }
      }
    });

    const updated = await prisma.flow.findUnique({
      where: { id: flowId },
      select: {
        id: true,
        openToAll: true,
        mandatory: true,
        targetTeams: { select: { teamRefId: true } },
        targetPeople: { select: { personRefId: true } },
      },
    });
    res.json({
      openToAll: updated.openToAll,
      mandatory: updated.mandatory,
      teamRefIds: updated.targetTeams.map((t) => t.teamRefId),
      personRefIds: updated.targetPeople.map((p) => p.personRefId),
    });
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
            bankFolderId: n.bankFolderId || null,
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
            bankFolderId: n.bankFolderId || null,
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
