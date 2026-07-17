// Variant channel listings — the owner-configurable commercial catalogue per
// sales channel (travel agents today; more channels later). Admin-only.
// PRESENTATION ONLY: rows point at canonical ProductVariants; nothing here
// duplicates products, variants, pricing or operational data.
//
//   GET /api/channel-listings?channel=agent
//     → every business-bookable variant with its listing (or null), so the
//       settings screen is a complete checklist of what CAN be exposed.
//   PUT /api/channel-listings/:variantId  { channel, ...presentation }
//     → upsert the (variant, channel) listing. Making a listing visible
//       requires a display name + commercial city — a half-configured row
//       can never leak an internal name to agents.

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

const router = Router();

const KNOWN_CHANNELS = ['agent']; // extend as channels launch — data model is generic

function cleanChannel(v) {
  const c = String(v || '').trim();
  return KNOWN_CHANNELS.includes(c) ? c : null;
}

router.get(
  '/',
  handle(async (req, res) => {
    const channel = cleanChannel(req.query.channel) || 'agent';
    const variants = await prisma.productVariant.findMany({
      where: {
        active: true,
        availableBusiness: true,
        product: { active: true },
        location: { active: true },
      },
      orderBy: [{ location: { sortOrder: 'asc' } }, { product: { sortOrder: 'asc' } }],
      select: {
        id: true,
        product: { select: { nameHe: true } },
        location: { select: { nameHe: true } },
        channelListings: { where: { channel } },
      },
    });
    res.json(
      variants.map((v) => ({
        variantId: v.id,
        internalProduct: v.product.nameHe,
        internalLocation: v.location.nameHe,
        listing: v.channelListings[0] || null,
      })),
    );
  }),
);

router.put(
  '/:variantId',
  handle(async (req, res) => {
    const channel = cleanChannel(req.body?.channel);
    if (!channel) return res.status(400).json({ error: 'channel_required' });
    const variant = await prisma.productVariant.findUnique({
      where: { id: req.params.variantId },
      select: { id: true },
    });
    if (!variant) return res.status(404).json({ error: 'not_found' });

    const b = req.body || {};
    const str = (v) => (v ? String(v).trim() : null);
    const data = {
      visible: !!b.visible,
      displayName: str(b.displayName) || '',
      displayNameEn: str(b.displayNameEn),
      description: str(b.description),
      commercialCity: str(b.commercialCity) || '',
      commercialCityEn: str(b.commercialCityEn),
      sortOrder: Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0,
    };
    // A visible listing must be fully presentable — never leak internals.
    if (data.visible && (!data.displayName || !data.commercialCity)) {
      return res.status(422).json({ error: 'display_fields_required' });
    }
    const listing = await prisma.variantChannelListing.upsert({
      where: { productVariantId_channel: { productVariantId: variant.id, channel } },
      create: { productVariantId: variant.id, channel, ...data },
      update: data,
    });
    res.json(listing);
  }),
);

export default router;
