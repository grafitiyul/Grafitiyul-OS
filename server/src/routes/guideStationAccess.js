import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Admin management of guide → Station permissions (מערכי הדרכה). Mounted at
// /api/people behind requireAdminAuth, alongside the people router.
//
// Contract (Gmail-selection semantics): the EXPLICIT GuideStationAccess rows
// are the only truth. "Select all in tour" / "clear all" are bulk row
// creates/deletes through the same endpoint; individual chips keep toggling
// freely afterwards.

const router = Router();

// Full permission map for one person: every ACTIVE content Tour with its
// active Stations, each flagged `granted`.
router.get(
  '/:id/station-access',
  handle(async (req, res) => {
    const person = await prisma.personRef.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!person) return res.status(404).json({ error: 'not_found' });
    const [tours, grants] = await Promise.all([
      prisma.tour.findMany({
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          titleHe: true,
          stations: {
            where: { active: true },
            orderBy: { sortOrder: 'asc' },
            select: { id: true, titleHe: true, kind: true },
          },
        },
      }),
      prisma.guideStationAccess.findMany({
        where: { personRefId: person.id },
        select: { stationId: true },
      }),
    ]);
    const granted = new Set(grants.map((g) => g.stationId));
    res.json({
      tours: tours
        .filter((t) => t.stations.length > 0)
        .map((t) => ({
          id: t.id,
          titleHe: t.titleHe,
          stations: t.stations.map((s) => ({ ...s, granted: granted.has(s.id) })),
        })),
    });
  }),
);

// Grant/revoke station permissions — single chips and bulk tour actions both
// land here. Station ids are validated against ACTIVE stations so a crafted
// request can't create rows for foreign/inactive content.
router.put(
  '/:id/station-access',
  handle(async (req, res) => {
    const person = await prisma.personRef.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!person) return res.status(404).json({ error: 'not_found' });
    const grant = Array.isArray(req.body?.grant) ? req.body.grant.map(String) : [];
    const revoke = Array.isArray(req.body?.revoke) ? req.body.revoke.map(String) : [];
    if (grant.length === 0 && revoke.length === 0) {
      return res.status(400).json({ error: 'no_station_ids' });
    }

    let grantedCount = 0;
    if (grant.length > 0) {
      const valid = await prisma.tourStation.findMany({
        where: { id: { in: grant }, active: true },
        select: { id: true },
      });
      if (valid.length > 0) {
        const created = await prisma.guideStationAccess.createMany({
          data: valid.map((s) => ({ stationId: s.id, personRefId: person.id })),
          skipDuplicates: true,
        });
        grantedCount = created.count;
      }
    }
    let revokedCount = 0;
    if (revoke.length > 0) {
      const deleted = await prisma.guideStationAccess.deleteMany({
        where: { personRefId: person.id, stationId: { in: revoke } },
      });
      revokedCount = deleted.count;
    }
    res.json({ ok: true, granted: grantedCount, revoked: revokedCount });
  }),
);

export default router;
