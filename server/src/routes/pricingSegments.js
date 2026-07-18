import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Pricing Segments (Slice A) — the 6 business-facing pricing tabs
// (קבוצתי / פרטי / עסקי / בית ספר / סוכנים / מפיקים). AUTHORING catalog only:
// it buckets pricing cards into tabs and lets the owner bind each tab to an
// ActivityType and/or OrganizationSubtype. NO hard-coded org mappings — bindings
// are null until set here. Resolution never reads this table.
//
// Lazy-seeded on first list (names only, no bindings) so the set always exists
// even if the migration seed hasn't run. Admin-only.

const router = Router();

const DEFAULTS = [
  { key: 'group', nameHe: 'קבוצתי', nameEn: 'Group' },
  { key: 'private', nameHe: 'פרטי', nameEn: 'Private' },
  { key: 'business', nameHe: 'עסקי', nameEn: 'Business' },
  { key: 'school', nameHe: 'בית ספר', nameEn: 'School' },
  { key: 'agents', nameHe: 'סוכנים', nameEn: 'Agents' },
  { key: 'producers', nameHe: 'מפיקים', nameEn: 'Producers' },
];

const include = {
  activityType: { select: { id: true, nameHe: true, nameEn: true, key: true } },
  organizationSubtype: { select: { id: true, label: true, labelEn: true, key: true } },
};

router.get(
  '/',
  handle(async (_req, res) => {
    if ((await prisma.pricingSegment.count()) === 0) {
      await prisma.$transaction(
        DEFAULTS.map((d, i) =>
          prisma.pricingSegment.create({ data: { ...d, sortOrder: i } }),
        ),
      );
    }
    res.json(
      await prisma.pricingSegment.findMany({
        orderBy: { sortOrder: 'asc' },
        include,
      }),
    );
  }),
);

// Dead-code removal (הגדרות מתקדמות cleanup): the PUT binding editor (with its
// bulk scope propagation onto the tab's PriceRules) served ONLY the retired
// advanced pricing screen and was removed with it. The stored bindings
// (activityTypeId / organizationSubtypeId) remain and are still copied onto new
// cards by the business editor — configuration data untouched, editor gone
// (recoverable from git history if binding management ever returns).

export default router;
