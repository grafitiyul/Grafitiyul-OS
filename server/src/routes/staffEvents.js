import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { diffPersonFields, recordPersonChanges } from '../timeline/personChangelog.js';
import { tryResolveHistoricalStaffLinks, normalizeEmail } from '../people/historicalStaffLinks.js';

// Recruitment-driven identity writes are attributed explicitly in the person
// changelog — nothing changes silently.
const RECRUITMENT_ORIGIN = {
  actorType: 'automation',
  actorLabel: 'סנכרון גיוס',
  createdBy: null,
  createdByName: null,
};

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
  // Phase G: becoming staff (accepted_to_team) transfers IDENTITY ownership to GOS
  // (identitySource='management'). The event payload provides the initial identity
  // captured at promotion time; afterwards GOS owns edits and the upstream pull no
  // longer overwrites it. A trainee (training_started) stays 'recruitment'-mirrored.
  const isStaff = event === 'accepted_to_team';
  const lifecycleHint = isStaff ? 'staff' : 'trainee';
  const identity = { identitySyncedAt: new Date() };
  if (displayName !== undefined) identity.displayName = String(displayName).trim();
  if (email !== undefined) identity.email = email || null;
  if (phone !== undefined) identity.phone = phone || null;

  const existing = await prisma.personRef.findUnique({ where: { externalPersonId: ext } });
  if (existing) {
    const data = { ...identity, lifecycleHint };
    // Promotion to staff → GOS now owns this person's identity.
    if (isStaff) data.identitySource = 'management';
    const person = await prisma.personRef.update({
      where: { externalPersonId: ext },
      data,
      select: { id: true, lifecycleHint: true },
    });
    // No profile field changes silently: identity updates pushed by
    // recruitment land in the same immutable person changelog admins see.
    await recordPersonChanges(prisma, {
      personRefId: existing.id,
      changes: diffPersonFields(existing, {
        ...(identity.displayName !== undefined ? { displayName: identity.displayName } : {}),
        ...(identity.email !== undefined ? { email: identity.email } : {}),
        ...(identity.phone !== undefined ? { phone: identity.phone } : {}),
      }),
      origin: RECRUITMENT_ORIGIN,
      source: 'recruitment_sync',
    });
    // If this event set/changed the email, the person may now own historical
    // imported rows keyed by that email — claim them (idempotent, non-blocking).
    if (identity.email !== undefined && normalizeEmail(identity.email) !== normalizeEmail(existing.email)) {
      await tryResolveHistoricalStaffLinks(prisma, existing.id);
    }
    return res.json({ ok: true, event, created: false, lifecycleHint: person.lifecycleHint });
  }

  if (!identity.displayName) return res.status(400).json({ error: 'displayName_required_for_create' });
  const person = await prisma.personRef.create({
    data: {
      externalPersonId: ext,
      // Staff identity is GOS-owned from the moment of acceptance; a trainee is
      // still mirrored from recruitment until (and if) they become staff.
      identitySource: isStaff ? 'management' : 'recruitment',
      portalToken: newPortalToken(),
      portalEnabled: true,
      accessGrantedAt: new Date(),
      lifecycleHint,
      ...identity,
      profile: { create: {} },
    },
    select: { id: true, lifecycleHint: true },
  });
  // A freshly-ingested person may be the canonical identity for historical rows.
  if (identity.email) await tryResolveHistoricalStaffLinks(prisma, person.id);
  res.json({ ok: true, event, created: true, lifecycleHint: person.lifecycleHint });
}));

export default router;
