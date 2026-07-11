import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { getGuidePortalSettings } from '../tours/guidePortal/access.js';

// Settings → Tours → "הרשאות מדריכים" — the server-backed singleton behind the
// Guide Portal permissions. Admin-only (requireAdminAuth at mount).
// Gallery delete/share stay on /api/tour-gallery/settings (their SSOT).

const router = Router();

const BOOL_KEYS = [
  'viewTeam',
  'viewParticipantPhone',
  'viewParticipantEmail',
  'viewCustomerInfo',
  'viewFieldRep',
  'fillTourSummary',
  'useTourGallery',
  'useCoordinationForms',
  'viewPastTours',
  'viewPay',
  'viewProcedures',
  'viewTraining',
  'editPersonalProfile',
];

router.get(
  '/',
  handle(async (_req, res) => {
    res.json(await getGuidePortalSettings(prisma));
  }),
);

router.put(
  '/',
  handle(async (req, res) => {
    const data = {};
    for (const key of BOOL_KEYS) {
      if (req.body?.[key] !== undefined) data[key] = !!req.body[key];
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'no_valid_fields' });
    }
    await getGuidePortalSettings(prisma); // ensure the singleton row exists
    const updated = await prisma.guidePortalSettings.update({
      where: { id: 'singleton' },
      data,
    });
    res.json(updated);
  }),
);

export default router;
