import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { validateAnswer } from '../services/questionRequirement.js';
import { buildExpansion, stepLookup } from '../services/flowExpansion.js';

const router = Router();

// ── Step list resolution ─────────────────────────────────────────
//
// The runtime treats `attempt.expansion.steps` as the canonical visit
// order. If `expansion` is null (legacy attempts created before the
// folderRef slice), we fall back to flattening the flow's authoring
// tree just like the old runtime did. Both paths produce the same
// shape of step entry, so callers don't branch on legacy-ness.
function legacyStepsFromFlow(flow) {
  // Mirror of the old `flattenNodes(flow.nodes)` — groups are
  // structural and skipped; folderRef shouldn't exist on legacy
  // attempts but we skip it defensively too.
  const childrenByParent = new Map();
  for (const n of flow.nodes || []) {
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
          bankFolderRefId: null,
          contentItemId: node.contentItemId || null,
          questionItemId: node.questionItemId || null,
          checkpointAfter: !!node.checkpointAfter,
        });
      }
    }
  }
  visit(null);
  return steps;
}

function stepsFor(attempt) {
  if (attempt.expansion?.steps) return attempt.expansion.steps;
  if (attempt.flow?.nodes) return legacyStepsFromFlow(attempt.flow);
  return [];
}

// Hydrate a step with the live content/question item rows. Item
// CONTENT (titles, bodies, options) is intentionally NOT in the
// expansion — it's read fresh here so admin edits propagate to
// in-flight attempts.
function hydrateStep(step, contentById, questionById) {
  return {
    ...step,
    contentItem: step.contentItemId
      ? contentById.get(step.contentItemId) || null
      : null,
    questionItem: step.questionItemId
      ? questionById.get(step.questionItemId) || null
      : null,
  };
}

async function hydrateSteps(steps) {
  if (steps.length === 0) return [];
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
  return steps.map((s) => hydrateStep(s, contentById, questionById));
}

// Compute the latest FlowAnswer per (attempt, step). Input: all rows
// for an attempt. Returns Map<stepId, latest row>.
export function latestByStep(answers) {
  const byStep = new Map();
  for (const a of answers) {
    const cur = byStep.get(a.stepId);
    if (!cur || a.version > cur.version) byStep.set(a.stepId, a);
  }
  return byStep;
}

// Outstanding question stepIds — same logic as before, just keyed on
// stepId. Each step carries the live questionItem the validator needs.
function outstandingStepIds(steps, latest) {
  const out = [];
  for (const step of steps) {
    if (step.kind !== 'question') continue;
    const la = latest.get(step.stepId);
    if (la?.status === 'rejected') {
      out.push(step.stepId);
      continue;
    }
    const qi = step.questionItem;
    if (!qi) {
      if (!la) out.push(step.stepId);
      continue;
    }
    const answer = la
      ? { choice: la.answerChoice, text: la.openText }
      : { choice: null, text: null };
    const v = validateAnswer(qi, answer);
    if (!v.ok) out.push(step.stepId);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Attempt creation. Builds the expansion at this moment so in-flight
// attempts are insulated from later bank structural changes (item
// content edits still propagate live via id lookup).
// ─────────────────────────────────────────────────────────────────
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

    const expansion = await buildExpansion(prisma, flow);
    const firstStep = expansion.steps[0] || null;

    const attempt = await prisma.attempt.create({
      data: {
        flowId,
        learnerName,
        workerIdentifier: workerIdentifier || null,
        status: 'in_progress',
        expansion,
        currentStepId: firstStep ? firstStep.stepId : null,
        // Also write currentNodeId for any code paths still reading it
        // (admin views, exports, …). For folderRef-derived first steps
        // there's no real flow node, so we leave it null.
        currentNodeId: firstStep?.flowNodeId || null,
      },
    });
    res.status(201).json(attempt);
  }),
);

// ─────────────────────────────────────────────────────────────────
// GET /:id — returns the attempt with its hydrated steps. The client
// runtime renders directly from `steps`, not from `flow.nodes`.
// ─────────────────────────────────────────────────────────────────
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
        answers: { orderBy: [{ stepId: 'asc' }, { version: 'asc' }] },
      },
    });
    if (!attempt) return res.status(404).json({ error: 'not found' });

    const steps = await hydrateSteps(stepsFor(attempt));
    res.json({ ...attempt, steps });
  }),
);

// ─────────────────────────────────────────────────────────────────
// POST /:id/answer — append a new versioned answer. Now keyed by
// stepId. `nodeId` is accepted as an alias for back-compat with the
// existing client; it's treated as a stepId too (legacy steps have
// stepId == flowNodeId).
// ─────────────────────────────────────────────────────────────────
router.post(
  '/:id/answer',
  handle(async (req, res) => {
    const stepId = req.body.stepId || req.body.nodeId;
    const { openText, answerChoice, answerLabel } = req.body;
    const attempt = await prisma.attempt.findUnique({
      where: { id: req.params.id },
      include: { flow: { include: { nodes: true } } },
    });
    if (!attempt) return res.status(404).json({ error: 'attempt not found' });
    if (attempt.status === 'approved') {
      return res.status(400).json({ error: 'attempt already approved' });
    }
    const steps = stepsFor(attempt);
    const step = steps.find((s) => s.stepId === stepId);
    if (!step) return res.status(400).json({ error: 'step not in attempt' });
    if (step.kind !== 'question') {
      return res.status(400).json({ error: 'step is not a question' });
    }
    if (!step.questionItemId) {
      return res.status(400).json({ error: 'question step has no questionItemId' });
    }

    // Determine next version for (attempt, step).
    const last = await prisma.flowAnswer.findFirst({
      where: { attemptId: attempt.id, stepId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (last?.version ?? 0) + 1;

    const created = await prisma.flowAnswer.create({
      data: {
        attemptId: attempt.id,
        // flowNodeId is null for folderRef-derived steps. The unique
        // constraint is on (attemptId, stepId, version); the FK on
        // flowNodeId is informational only for admin/review queries.
        flowNodeId: step.flowNodeId || null,
        stepId,
        questionItemId: step.questionItemId,
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

// ─────────────────────────────────────────────────────────────────
// POST /:id/advance — move the cursor forward in the expansion.
// Sets currentStepId=null when past the last step (attempt remains
// in_progress until /submit).
// ─────────────────────────────────────────────────────────────────
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
    const steps = stepsFor(attempt);
    const currentId = attempt.currentStepId || attempt.currentNodeId;
    const currentIdx = steps.findIndex((s) => s.stepId === currentId);
    const next = steps[currentIdx + 1];
    const updated = await prisma.attempt.update({
      where: { id: attempt.id },
      data: {
        currentStepId: next ? next.stepId : null,
        currentNodeId: next?.flowNodeId || null,
      },
    });
    res.json(updated);
  }),
);

// ─────────────────────────────────────────────────────────────────
// POST /:id/submit
// ─────────────────────────────────────────────────────────────────
router.post(
  '/:id/submit',
  handle(async (req, res) => {
    const attempt = await prisma.attempt.findUnique({
      where: { id: req.params.id },
      include: {
        flow: { include: { nodes: { include: { questionItem: true } } } },
        answers: true,
      },
    });
    if (!attempt) return res.status(404).json({ error: 'attempt not found' });
    if (attempt.status === 'approved') {
      return res.status(400).json({ error: 'already approved' });
    }
    const steps = await hydrateSteps(stepsFor(attempt));
    const latest = latestByStep(attempt.answers);

    const outstanding = outstandingStepIds(steps, latest);
    if (outstanding.length > 0) {
      return res.status(400).json({
        error: 'outstanding_questions',
        outstandingStepIds: outstanding,
        // Back-compat alias for any client still reading the old field.
        outstandingNodeIds: outstanding,
      });
    }

    const updated = await prisma.attempt.update({
      where: { id: attempt.id },
      data: { status: 'submitted', submittedAt: new Date() },
    });
    res.json(updated);
  }),
);

// ─────────────────────────────────────────────────────────────────
// GET /:id/outstanding — for the resubmit screen. Returns the steps
// that still need a fresh answer, with the content steps that
// precede each one (linear-sequence context).
// ─────────────────────────────────────────────────────────────────
router.get(
  '/:id/outstanding',
  handle(async (req, res) => {
    const attempt = await prisma.attempt.findUnique({
      where: { id: req.params.id },
      include: {
        flow: { include: { nodes: { include: { contentItem: true, questionItem: true } } } },
        answers: true,
      },
    });
    if (!attempt) return res.status(404).json({ error: 'attempt not found' });

    const steps = await hydrateSteps(stepsFor(attempt));
    const latest = latestByStep(attempt.answers);
    const outstandingIds = new Set(outstandingStepIds(steps, latest));

    const out = [];
    let precedingContent = [];
    for (const step of steps) {
      if (step.kind === 'content') {
        precedingContent.push(step);
        continue;
      }
      if (step.kind === 'question') {
        if (outstandingIds.has(step.stepId)) {
          const la = latest.get(step.stepId);
          out.push({
            step,
            // Back-compat: legacy clients expected `node`. Same shape.
            node: step,
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

// Legacy exports kept so other modules (people.js procedures bucket
// derivation, exports, etc.) still compile. New callers should prefer
// `latestByStep`.
export function flattenNodes(nodes, parentId = null) {
  const siblings = nodes
    .filter((n) => (n.parentId ?? null) === parentId)
    .sort((a, b) => a.order - b.order);
  const out = [];
  for (const n of siblings) {
    if (n.kind === 'group') {
      out.push(...flattenNodes(nodes, n.id));
    } else if (n.kind === 'content' || n.kind === 'question') {
      out.push(n);
    }
    // folderRef intentionally skipped — caller would need to expand
    // via flowExpansion to see those items.
  }
  return out;
}

export function latestByNode(answers) {
  // Compatibility shim: keys by flowNodeId where present, else by stepId.
  const byNode = new Map();
  for (const a of answers) {
    const key = a.flowNodeId || a.stepId;
    if (!key) continue;
    const cur = byNode.get(key);
    if (!cur || a.version > cur.version) byNode.set(key, a);
  }
  return byNode;
}

export default router;
