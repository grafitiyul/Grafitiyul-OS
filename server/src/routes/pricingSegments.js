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

// Update a tab's owner-set bindings. Canonical write path for the Pricing
// board's tab settings (the retired הגדרות מתקדמות screen is NOT the consumer).
// Bindings are ACTIVE pricing configuration: they are stamped as the engine
// scope of every card saved under the tab. Empty/null clears back to
// "unmapped" (cards then price as activity-wildcard).
//
// When a binding changes, PROPAGATE it to every PriceRule authored under this
// tab (matched by pricingSegmentId), so the cards' engine scope stays truthful
// and an old card never resolves differently from a new one. This is the only
// place the activity/subtype scope of card rules is rewritten in bulk.
router.put(
  '/:id',
  handle(async (req, res) => {
    const exists = await prisma.pricingSegment.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!exists) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const data = {};
    if (b.nameHe !== undefined) data.nameHe = String(b.nameHe);
    if (b.active !== undefined) data.active = b.active !== false;
    const bindingChanged =
      b.activityTypeId !== undefined || b.organizationSubtypeId !== undefined;
    if (b.activityTypeId !== undefined) data.activityTypeId = b.activityTypeId || null;
    if (b.organizationSubtypeId !== undefined)
      data.organizationSubtypeId = b.organizationSubtypeId || null;

    const segment = await prisma.$transaction(async (tx) => {
      const updated = await tx.pricingSegment.update({
        where: { id: req.params.id },
        data,
        include,
      });
      if (bindingChanged) {
        await tx.priceRule.updateMany({
          where: { pricingSegmentId: updated.id },
          data: {
            activityTypeId: updated.activityTypeId,
            organizationSubtypeId: updated.organizationSubtypeId,
          },
        });
      }
      return updated;
    });
    res.json(segment);
  }),
);

export default router;
