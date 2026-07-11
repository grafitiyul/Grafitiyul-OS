import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { emitTimelineEvent, userOrigin } from '../timeline/events.js';

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

    const stationLabel = (s) =>
      s.tour?.titleHe ? `${s.titleHe} (${s.tour.titleHe})` : s.titleHe;

    // Grants: resolve which VALID stations are actually NEW (so history
    // records only real changes, not re-grants).
    let grantedStations = [];
    if (grant.length > 0) {
      const valid = await prisma.tourStation.findMany({
        where: { id: { in: grant }, active: true },
        select: { id: true, titleHe: true, tour: { select: { titleHe: true } } },
      });
      if (valid.length > 0) {
        const already = await prisma.guideStationAccess.findMany({
          where: { personRefId: person.id, stationId: { in: valid.map((s) => s.id) } },
          select: { stationId: true },
        });
        const alreadySet = new Set(already.map((r) => r.stationId));
        grantedStations = valid.filter((s) => !alreadySet.has(s.id));
        if (grantedStations.length > 0) {
          await prisma.guideStationAccess.createMany({
            data: grantedStations.map((s) => ({ stationId: s.id, personRefId: person.id })),
            skipDuplicates: true,
          });
        }
      }
    }

    // Revokes: capture the rows that actually exist before deleting.
    let revokedStations = [];
    if (revoke.length > 0) {
      const rows = await prisma.guideStationAccess.findMany({
        where: { personRefId: person.id, stationId: { in: revoke } },
        select: {
          station: { select: { id: true, titleHe: true, tour: { select: { titleHe: true } } } },
        },
      });
      revokedStations = rows.map((r) => r.station);
      if (revokedStations.length > 0) {
        await prisma.guideStationAccess.deleteMany({
          where: { personRefId: person.id, stationId: { in: revokedStations.map((s) => s.id) } },
        });
      }
    }

    // Immutable audit: who granted/removed which stations, when, from where.
    // Same shared timeline mechanism as the profile changelog (kind is
    // 'station_access'; the admin history section renders both).
    if (grantedStations.length > 0 || revokedStations.length > 0) {
      await emitTimelineEvent(prisma, {
        subjectType: 'person',
        subjectId: person.id,
        kind: 'station_access',
        data: {
          source: 'admin',
          granted: grantedStations.map(stationLabel),
          revoked: revokedStations.map(stationLabel),
        },
        origin: await userOrigin(req.adminAuth?.userId),
      });
    }

    res.json({
      ok: true,
      granted: grantedStations.length,
      revoked: revokedStations.length,
    });
  }),
);

export default router;
