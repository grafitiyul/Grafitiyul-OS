// WhatsApp + Email Queue — read-only aggregation, plus the "זמני שליחה" config.
//
// There is no send, cancel or reschedule endpoint here on purpose: those belong
// to the subsystems that own each row, and duplicating them would create a
// second write path into queues that already guarantee exactly-once delivery.

import { Router } from 'express';
import { handle } from '../asyncHandler.js';
import { prisma } from '../db.js';
import { loadQueue, queueOverview } from '../queue/service.js';
import {
  policyMatrix, AUDIENCE_KINDS, POLICY_CHANNELS, AUDIENCE_KIND_LABELS_HE,
} from '../communication/sendingPolicy.js';

const router = Router();

async function actingAdmin(req) {
  const userId = req.adminAuth?.userId || null;
  if (!userId) return { id: null, name: null };
  const u = await prisma.adminUser.findUnique({
    where: { id: userId },
    select: { username: true, displayName: true },
  });
  return { id: userId, name: u?.displayName || u?.username || null };
}

router.get('/overview', handle(async (_req, res) => {
  res.json(await queueOverview());
}));

router.get('/', handle(async (req, res) => {
  const channel = req.query.channel === 'email' ? 'email' : 'whatsapp';
  const scope = req.query.scope === 'history' ? 'history' : 'pending';
  res.json(await loadQueue({ channel, scope, limit: scope === 'history' ? 100 : 500 }));
}));

// ── זמני שליחה ───────────────────────────────────────────────────────────────

router.get('/policies', handle(async (_req, res) => {
  const [policies, windows] = await Promise.all([
    policyMatrix(),
    prisma.communicationSendingWindow.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, description: true, rules: true },
    }),
  ]);
  res.json({
    policies,
    windows,
    audienceKinds: AUDIENCE_KINDS.map((k) => ({ key: k, labelHe: AUDIENCE_KIND_LABELS_HE[k] })),
    channels: POLICY_CHANNELS,
  });
}));

router.put('/policies/:audienceKind/:channel', handle(async (req, res) => {
  const { audienceKind, channel } = req.params;
  if (!AUDIENCE_KINDS.includes(audienceKind)) return res.status(400).json({ error: 'invalid_audience' });
  if (!POLICY_CHANNELS.includes(channel)) return res.status(400).json({ error: 'invalid_channel' });

  const body = req.body || {};
  const enabled = !!body.enabled;
  const windowId = body.windowId || null;
  // Enabling without a window would fail CLOSED at send time (nothing goes
  // out). Refusing here turns a silent stoppage into an obvious form error.
  if (enabled && !windowId) return res.status(422).json({ error: 'window_required' });

  const user = await actingAdmin(req);
  await prisma.sendingWindowPolicy.upsert({
    where: { audienceKind_channel: { audienceKind, channel } },
    create: { audienceKind, channel, enabled, windowId, updatedBy: user.id, updatedByName: user.name },
    update: { enabled, windowId, updatedBy: user.id, updatedByName: user.name },
  });
  res.json({ policies: await policyMatrix() });
}));

export default router;
