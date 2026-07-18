import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// "מידע ממערכת קודמת" — the permanent legacy-info card (READ-ONLY).
//
// LegacyRecord.cardData holds the curated label→value pairs shaped at import
// time; this route surfaces them for the entity pages (Deal / Contact /
// Organization / TourEvent) via the loose (entityType, entityId) link.
//
// Boundary rules honoured here:
//   • READS ONLY — legacyRecord.findMany and nothing else. The crosswalk is
//     written exclusively by the migration import engine.
//   • cardData ONLY — the raw `payload` (Legacy Archive) is never selected,
//     matching the search rule in src/search/lookups.js (lookupLegacy).

const router = Router();

// The loose-link vocabulary (see LegacyRecord.entityType in schema.prisma).
export const VALID_ENTITY_TYPES = ['Deal', 'Contact', 'Organization', 'TourEvent'];

// Parse + validate the query — pure, so the route test needs no HTTP harness.
// Returns { entityType, entityId } or { error } (→ 400).
export function parseLegacyCardQuery(query) {
  const entityType = String(query?.entityType || '').trim();
  const entityId = String(query?.entityId || '').trim();
  if (!VALID_ENTITY_TYPES.includes(entityType)) return { error: 'invalid_entity_type' };
  if (!entityId) return { error: 'invalid_entity_id' };
  return { entityType, entityId };
}

// The response row shape — an explicit whitelist so the raw payload (or any
// future column) can never leak by accident.
export function legacyRecordDto(row) {
  return {
    sourceSystem: row.sourceSystem,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    cardData: row.cardData,
  };
}

// GET /api/legacy-card?entityType=&entityId= → { records: [...] }.
// Empty array when the entity has no curated legacy data — the client renders
// nothing in that case.
router.get(
  '/',
  handle(async (req, res) => {
    const parsed = parseLegacyCardQuery(req.query);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const rows = await prisma.legacyRecord.findMany({
      where: {
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        // Exclude rows without curated card data (DB NULL or JSON null).
        cardData: { not: Prisma.AnyNull },
      },
      select: { sourceSystem: true, sourceType: true, sourceId: true, cardData: true },
      orderBy: [{ sourceSystem: 'asc' }, { sourceType: 'asc' }, { sourceId: 'asc' }],
    });
    res.json({ records: rows.map(legacyRecordDto) });
  }),
);

export default router;
