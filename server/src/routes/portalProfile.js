import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { resolveGuidePortalAccess } from '../tours/guidePortal/access.js';

// Guide Portal → פרטים אישיים. Same portal-token credential; a guide can
// VIEW their own operational identity and — when the editPersonalProfile
// permission is on — update their contact details.
//
// Deliberately narrow:
//   * exposed: displayName, email, phone, profile image, role hint
//   * editable: phone + email only (identity name stays office-managed)
//   * NOT exposed: internal notes, bankDetails, admin-only profile fields
//
// Caveat (documented, accepted): PersonRef identity mirrors recruitment for
// some staff — a later lifecycle push may refresh these fields.

const router = Router();

function fail(res, r) {
  return res.status(r.status).json({ error: r.error });
}

const LIFECYCLE_LABELS = {
  trainee: 'מתלמד',
  staff: 'צוות',
  evaluator: 'מעריך',
};

router.get(
  '/:token/profile',
  handle(async (req, res) => {
    const access = await resolveGuidePortalAccess(prisma, {
      portalToken: req.params.token,
    });
    if (!access.ok) return fail(res, access);
    const profile = await prisma.personProfile.findUnique({
      where: { personRefId: access.person.id },
      select: { imageUrl: true },
    });
    res.set('Cache-Control', 'no-store');
    res.json({
      displayName: access.person.displayName,
      email: access.person.email || null,
      phone: access.person.phone || null,
      imageUrl: profile?.imageUrl || null,
      lifecycleLabel: LIFECYCLE_LABELS[access.person.lifecycleHint] || null,
      canEdit: access.permissions.editPersonalProfile,
    });
  }),
);

router.put(
  '/:token/profile',
  handle(async (req, res) => {
    const access = await resolveGuidePortalAccess(prisma, {
      portalToken: req.params.token,
    });
    if (!access.ok) return fail(res, access);
    if (!access.permissions.editPersonalProfile) {
      return res.status(403).json({ error: 'not_allowed' });
    }
    const data = {};
    if (req.body?.phone !== undefined) {
      const phone = String(req.body.phone || '').trim();
      if (phone && !/^[+\d][\d\s\-()]{5,19}$/.test(phone)) {
        return res.status(400).json({ error: 'invalid_phone' });
      }
      data.phone = phone || null;
    }
    if (req.body?.email !== undefined) {
      const email = String(req.body.email || '').trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'invalid_email' });
      }
      data.email = email || null;
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'no_valid_fields' });
    }
    const updated = await prisma.personRef.update({
      where: { id: access.person.id },
      data,
      select: { email: true, phone: true },
    });
    res.json({ ok: true, ...updated });
  }),
);

export default router;
