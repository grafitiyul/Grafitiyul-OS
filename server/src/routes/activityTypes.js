import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Activity types — seeded public / private / business. priceModel drives
// Slice-2 pricing (per_head vs tiered). Read-only catalog for now; lazy-seeded
// on first list so the set always exists.

const router = Router();

// Display names are editable data, not enum keys. The `public` row is presented
// to the business as "קבוצתי" (see Slice C terminology cleanup); the internal
// key stays 'public' so nothing downstream breaks.
const DEFAULTS = [
  { key: 'public', nameHe: 'קבוצתי', nameEn: 'Group', priceModel: 'per_head' },
  { key: 'private', nameHe: 'פרטי', nameEn: 'Private', priceModel: 'tiered' },
  { key: 'business', nameHe: 'עסקי', nameEn: 'Business', priceModel: 'tiered' },
];

router.get(
  '/',
  handle(async (_req, res) => {
    if ((await prisma.activityType.count()) === 0) {
      await prisma.$transaction(
        DEFAULTS.map((d, i) =>
          prisma.activityType.create({ data: { ...d, sortOrder: i } }),
        ),
      );
    }
    res.json(
      await prisma.activityType.findMany({ orderBy: { sortOrder: 'asc' } }),
    );
  }),
);

export default router;
