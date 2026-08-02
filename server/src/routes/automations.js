// Automation Registry — admin routes.
//
// Read-only by design, with exactly TWO mutations: enable and disable. No
// definition field is writable, which is what keeps the registry generated from
// the code the runtime executes.
//
// The manual re-run endpoint was removed with the questionnaire automations: it
// could only replay a questionnaire submission, and there are no questionnaire
// automations left to replay it against.

import { Router } from 'express';
import { handle } from '../asyncHandler.js';
import { prisma } from '../db.js';
import { listView, detailView } from '../automations/view.js';
import { automationById } from '../automations/registry.js';

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

export default router;
