import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { dealCollection, collectionDeals } from '../collection.js';

// Collection (גבייה) endpoints — thin HTTP layer over collection.js, the
// single source of truth for paid/balance math. Two routers because the
// surfaces live under different mounts:
//
//   dealCollectionRouter  → /api/deals/:id/collection   (the Deal card)
//   collectionRouter      → /api/collection/deals       (the Collection screen)

export const dealCollectionRouter = Router();
dealCollectionRouter.get(
  '/:id/collection',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({
      where: { id: req.params.id },
      select: { id: true, valueMinor: true, currency: true },
    });
    if (!deal) return res.status(404).json({ error: 'not_found' });
    res.json(await dealCollection(prisma, deal));
  }),
);

export const collectionRouter = Router();
collectionRouter.get(
  '/deals',
  handle(async (_req, res) => {
    res.json({ deals: await collectionDeals(prisma) });
  }),
);
