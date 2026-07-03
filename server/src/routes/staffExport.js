import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// ── Staff roster export (GOS → recruitment READ) ─────────────────────────────────
//
// GOS is the source of truth for the active staff roster. Recruitment consumes the
// roster here instead of deriving "who is staff" from its own phase='team' /
// team_members. Secret-gated (STAFF_EVENT_SECRET), server-to-server, read-only.

const router = Router();

router.use((req, res, next) => {
  const expected = process.env.STAFF_EVENT_SECRET;
  if (!expected) return res.status(500).json({ error: 'staff_event_secret_not_configured' });
  const provided = req.header('x-staff-event-secret') || '';
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(provided ? 403 : 401).json({ error: 'invalid_staff_event_secret' });
  }
  next();
});

// GET /roster — active staff (lifecycle='staff'); ?includeFormer=true adds 'former'.
// Keyed by externalPersonId so the consumer maps to its own ids.
router.get('/roster', handle(async (req, res) => {
  const includeFormer = req.query.includeFormer === 'true';
  const where = includeFormer
    ? { lifecycleHint: { in: ['staff', 'former'] } }
    : { lifecycleHint: 'staff' };

  const people = await prisma.personRef.findMany({
    where,
    select: {
      externalPersonId: true,
      displayName: true,
      email: true,
      phone: true,
      lifecycleHint: true,
      portalEnabled: true,
      status: true,
      accessGrantedAt: true,
      accessRevokedAt: true,
      team: { select: { displayName: true } },
    },
    orderBy: [{ lifecycleHint: 'asc' }, { displayName: 'asc' }],
  });

  res.json({
    items: people.map((p) => ({
      externalPersonId: p.externalPersonId,
      displayName: p.displayName,
      email: p.email,
      phone: p.phone,
      lifecycle: p.lifecycleHint, // 'staff' | 'former'
      portalEnabled: p.portalEnabled,
      status: p.status,
      teamName: p.team?.displayName || null,
      accessGrantedAt: p.accessGrantedAt,
      accessRevokedAt: p.accessRevokedAt,
    })),
    _meta: { source: 'GOS', count: people.length, includeFormer },
  });
}));

export default router;
