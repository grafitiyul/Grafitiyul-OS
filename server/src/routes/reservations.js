// Travel Agency Reservations — ADMIN read surface (Slice 2: minimal read-only
// sessions list; the full review inbox + reprocess actions are a later slice).
// Sessions are immutable audit records — no mutation endpoints here.

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

const router = Router();

router.get(
  '/',
  handle(async (_req, res) => {
    const sessions = await prisma.reservationSession.findMany({
      orderBy: { submittedAt: 'desc' },
      take: 200,
      include: {
        contact: {
          select: { id: true, firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true },
        },
        organization: { select: { id: true, name: true } },
        groups: {
          orderBy: { sortOrder: 'asc' },
          include: { createdDeal: { select: { id: true, orderNo: true } } },
        },
      },
    });
    res.json(
      sessions.map((s) => ({
        id: s.id,
        sessionNo: s.sessionNo,
        source: s.source,
        status: s.status,
        language: s.language,
        submittedAt: s.submittedAt,
        processedAt: s.processedAt,
        lastError: s.lastError,
        signerName: s.signerName,
        contact: s.contact
          ? {
              id: s.contact.id,
              name:
                `${s.contact.firstNameHe || ''} ${s.contact.lastNameHe || ''}`.trim() ||
                `${s.contact.firstNameEn || ''} ${s.contact.lastNameEn || ''}`.trim(),
            }
          : null,
        organization: s.organization,
        participantsTotal: s.groups.reduce((a, g) => a + (g.participants || 0), 0),
        groups: s.groups.map((g) => ({
          id: g.id,
          groupName: g.groupName,
          locationLabel: g.locationLabel,
          productLabel: g.productLabel,
          tourDate: g.tourDate,
          tourTime: g.tourTime,
          participants: g.participants,
          tourLanguage: g.tourLanguage,
          onSiteContactName: g.onSiteContactName,
          onSiteContactPhone: g.onSiteContactPhone,
          notes: g.notes,
          status: g.status,
          lastError: g.lastError,
          deal: g.createdDeal ? { id: g.createdDeal.id, orderNo: g.createdDeal.orderNo } : null,
        })),
      })),
    );
  }),
);

export default router;
