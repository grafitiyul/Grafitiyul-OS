// Automation Registry — admin routes.
//
// Read-only by design, with exactly THREE mutations: enable, disable, and a
// manual re-run. No definition field is writable, which is what keeps the
// registry generated from the code the runtime executes.

import { Router } from 'express';
import { handle } from '../asyncHandler.js';
import { prisma } from '../db.js';
import { listView, detailView } from '../automations/view.js';
import { automationById } from '../automations/registry.js';
import { runAutomation } from '../automations/runtime.js';
import { resolveSubjectRefs, answersOf } from '../automations/sources/questionnaire.js';

const router = Router();
const h = (fn) => handle(fn);

// Acting admin, same convention as the control routes.
async function actingAdmin(req) {
  const userId = req.adminAuth?.userId || null;
  if (!userId) return { id: null, name: null };
  const u = await prisma.adminUser.findUnique({
    where: { id: userId },
    select: { username: true, displayName: true },
  });
  return { id: userId, name: u?.displayName || u?.username || null };
}

router.get('/', h(async (_req, res) => {
  res.json({ automations: await listView() });
}));

router.get('/:autId', h(async (req, res) => {
  const view = await detailView(req.params.autId);
  if (!view) return res.status(404).json({ error: 'automation_not_found' });
  res.json(view);
}));

// Enable / disable. The definition's defaultEnabled stays the fallback; this
// records an explicit operator override plus a change-history row.
router.put('/:autId/enabled', h(async (req, res) => {
  const { autId } = req.params;
  if (!automationById(autId)) return res.status(404).json({ error: 'automation_not_found' });
  const enabled = !!(req.body || {}).enabled;
  const user = await actingAdmin(req);

  await prisma.automationState.upsert({
    where: { autId },
    create: { autId, enabled, updatedBy: user.id, updatedByName: user.name },
    update: { enabled, updatedBy: user.id, updatedByName: user.name },
  });
  await prisma.automationChange.create({
    data: {
      autId,
      kind: enabled ? 'enabled' : 'disabled',
      summaryHe: enabled ? 'האוטומציה הופעלה' : 'האוטומציה הושבתה',
      actorId: user.id,
      actorName: user.name,
    },
  });
  res.json(await detailView(autId));
}));

/**
 * Manual re-run against one submission. Safe by construction: it goes through
 * the SAME runtime, so the idempotency key is the same and a submission that
 * already ran is a no-op rather than a second send.
 */
router.post('/:autId/rerun', h(async (req, res) => {
  const { autId } = req.params;
  const def = automationById(autId);
  if (!def) return res.status(404).json({ error: 'automation_not_found' });

  const submissionId = String((req.body || {}).submissionId || '').trim();
  if (!submissionId) return res.status(400).json({ error: 'submission_id_required' });

  const submission = await prisma.questionnaireSubmission.findUnique({
    where: { id: submissionId },
    include: {
      answers: true,
      template: { select: { id: true, key: true, internalName: true, purpose: true } },
    },
  });
  if (!submission) return res.status(404).json({ error: 'submission_not_found' });
  if (submission.template?.key !== def.trigger?.templateKey) {
    return res.status(422).json({ error: 'submission_template_mismatch' });
  }

  const refs = await resolveSubjectRefs(submission);
  const result = await runAutomation(def, {
    submission,
    answers: answersOf(submission),
    refs,
    firstSubmit: true,
  });
  res.json({ result, detail: await detailView(autId) });
}));

export default router;
