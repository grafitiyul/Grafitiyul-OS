import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// ── Staff lifecycle events (recruitment → GOS ingest) ────────────────────────────
//
// Recruitment pushes lifecycle events here as people move through its pipeline.
// GOS reacts; it never records rejection state. Secret-gated (STAFF_EVENT_SECRET),
// server-to-server — NOT cookie-gated.
//
//   training_started  → upsert PersonRef, lifecycle = 'trainee'   (temporary op access)
//   accepted_to_team  → upsert PersonRef, lifecycle = 'staff'
//   training_rejected → revoke access + HARD DELETE the PersonRef. No 'rejected'
//                       status in GOS — a rejected trainee belongs to recruitment.
//
// Idempotent + no duplicates (unique externalPersonId). GOS is unaware of
// recruitment beyond this inbound surface.

const router = Router();

function newPortalToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// Fail-closed secret gate.
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

const EVENTS = new Set(['training_started', 'accepted_to_team', 'training_rejected']);

router.post('/', handle(async (req, res) => {
  const { externalPersonId, event, displayName, email, phone } = req.body || {};
  const ext = String(externalPersonId || '').trim();
  if (!ext) return res.status(400).json({ error: 'externalPersonId_required' });
  if (!EVENTS.has(event)) return res.status(400).json({ error: 'invalid_event', allowed: [...EVENTS] });

  // ── Rejection: revoke + hard delete (no GOS rejected status; not a graveyard) ──
  if (event === 'training_rejected') {
    const existing = await prisma.personRef.findUnique({ where: { externalPersonId: ext }, select: { id: true } });
    if (!existing) return res.json({ ok: true, event, deleted: false }); // idempotent
    // Revoke first (belt-and-suspenders), then remove entirely.
    await prisma.personRef.update({ where: { id: existing.id }, data: { portalEnabled: false, accessRevokedAt: new Date() } });
    await prisma.personRef.delete({ where: { id: existing.id } });
    return res.json({ ok: true, event, deleted: true });
  }

  // ── training_started → trainee | accepted_to_team → staff (upsert) ─────────────
  const lifecycleHint = event === 'accepted_to_team' ? 'staff' : 'trainee';
  const identity = { identitySyncedAt: new Date() };
  if (displayName !== undefined) identity.displayName = String(displayName).trim();
  if (email !== undefined) identity.email = email || null;
  if (phone !== undefined) identity.phone = phone || null;

  const existing = await prisma.personRef.findUnique({ where: { externalPersonId: ext } });
  if (existing) {
    const person = await prisma.personRef.update({
      where: { externalPersonId: ext },
      data: { ...identity, lifecycleHint },
      select: { id: true, lifecycleHint: true },
    });
    return res.json({ ok: true, event, created: false, lifecycleHint: person.lifecycleHint });
  }

  if (!identity.displayName) return res.status(400).json({ error: 'displayName_required_for_create' });
  const person = await prisma.personRef.create({
    data: {
      externalPersonId: ext,
      identitySource: 'recruitment',
      portalToken: newPortalToken(),
      portalEnabled: true,
      accessGrantedAt: new Date(),
      lifecycleHint,
      ...identity,
      profile: { create: {} },
    },
    select: { id: true, lifecycleHint: true },
  });
  res.json({ ok: true, event, created: true, lifecycleHint: person.lifecycleHint });
}));

export default router;
