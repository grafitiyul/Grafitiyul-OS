import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { validateAnswer } from '../services/questionRequirement.js';
import { buildExpansion, stepLookup } from '../services/flowExpansion.js';

const router = Router();

// ── Step list resolution ─────────────────────────────────────────
//
// The runtime treats `attempt.expansion.steps` as the canonical visit
// order. Older attempts (created before the folderRef slice) have
// `expansion=null` — for those we BUILD an expansion on first read
// using the current flow + bank state, then persist it onto the
// attempt so subsequent reads stay stable. Without this auto-snapshot,
// a legacy attempt for a flow that contains only folderRef nodes
// would have no steps at all and the runtime would jump straight to
// the SubmitScreen — the bug this fix targets.

// Fast path used by sync callers AFTER ensureExpansion has been awaited.
function stepsFor(attempt) {
  return attempt.expansion?.steps || [];
}

// Make sure `attempt.expansion` is populated. Mutates the in-memory
// attempt object so callers can keep using sync `stepsFor()` after
// awaiting this. For in-progress attempts, also persists the result
// (and re-syncs the cursor: a legacy `currentNodeId` becomes the new
// `currentStepId`; a stale cursor that no longer maps to any step is
// reset to the first step).
async function ensureExpansion(attempt) {
  const hasExpansion =
    attempt.expansion &&
    Array.isArray(attempt.expansion.steps) &&
    attempt.expansion.steps.length > 0;
  if (hasExpansion) return;
  if (!attempt.flow || !Array.isArray(attempt.flow.nodes)) return;

  const fresh = await buildExpansion(prisma, attempt.flow);
  attempt.expansion = fresh;

  // Only persist for in-progress attempts. Submitted/approved attempts
  // are read-only from a structural standpoint; we can compute on
  // every read without writing back. (Reviews still operate on the
  // existing FlowAnswer rows.)
  if (attempt.status !== 'in_progress') return;

  const updates = { expansion: fresh };

  // Reconcile the cursor. Legacy attempts have currentNodeId but no
  // currentStepId. For non-folderRef steps, stepId == flowNodeId, so
  // a legacy currentNodeId IS a valid stepId in the new expansion.
  // If the cursor no longer maps to any step (e.g. the admin removed
  // the original node, or the legacy cursor pointed at a folderRef
  // that's now expanded into multiple steps), reset to the first step.
  const cursor = attempt.currentStepId || attempt.currentNodeId || null;
  const cursorExists =
    cursor && fresh.steps.some((s) => s.stepId === cursor);
  if (cursorExists) {
    if (!attempt.currentStepId) {
      attempt.currentStepId = cursor;
      updates.currentStepId = cursor;
    }
  } else {
    const firstStep = fresh.steps[0] || null;
    attempt.currentStepId = firstStep ? firstStep.stepId : null;
    attempt.currentNodeId = firstStep?.flowNodeId || null;
    updates.currentStepId = attempt.currentStepId;
    updates.currentNodeId = attempt.currentNodeId;
  }

  try {
    await prisma.attempt.update({ where: { id: attempt.id }, data: updates });
  } catch (e) {
    // Persistence failure isn't fatal — the in-memory expansion is
    // already attached, so the current request renders correctly.
    // Surface in logs so repeated failures are visible.
    console.warn('[attempts] ensureExpansion persist failed', {
      attemptId: attempt.id,
      message: e?.message,
    });
  }
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

    await ensureExpansion(attempt);
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
    await ensureExpansion(attempt);
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
    await ensureExpansion(attempt);
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
    await ensureExpansion(attempt);
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

    await ensureExpansion(attempt);
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

// ─────────────────────────────────────────────────────────────────
// DELETE /:id — admin reset. Removes the attempt row entirely; the
// schema cascades to FlowAnswer rows, so the guide is left in a
// clean "not_started" state for this flow. The guide's portal task
// flips back to "התחל" on their next view.
//
// We chose hard-delete over an "archive" / "soft reset" because:
//   * It IS the cleanest cleartesting state.
//   * Audit history isn't a goal yet (the system has no audit log).
//   * Reopening a submitted/approved attempt for re-work has the
//     same effect as starting over from the guide's POV — a fresh
//     attempt with a fresh expansion is created on next start.
// If we later need an audit trail of past attempts, the archive
// path can be added without breaking this contract.
// ─────────────────────────────────────────────────────────────────
router.delete(
  '/:id',
  handle(async (req, res) => {
    const attempt = await prisma.attempt.findUnique({
      where: { id: req.params.id },
      select: { id: true, flowId: true, externalPersonId: true },
    });
    if (!attempt) return res.status(404).json({ error: 'not_found' });
    await prisma.attempt.delete({ where: { id: attempt.id } });
    res.json({
      ok: true,
      attemptId: attempt.id,
      flowId: attempt.flowId,
      externalPersonId: attempt.externalPersonId,
    });
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
