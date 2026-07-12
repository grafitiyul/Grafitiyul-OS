// Guide Portal → שכר. Mounted at /api/portal alongside tours/profile/gallery.
// Server-enforced by the viewPay permission (client hiding is convenience).
//
// A guide sees entries only AFTER office approval, approves each entry, or
// opens an inquiry ("יש הערה? לחץ כאן") — the entry becomes בבירור, the office
// edits if needed, and the guide approves again. Guide totals include ONLY
// entries approved by BOTH sides; everything else office-approved is
// "ממתין לאישורך".

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { resolveGuidePortalAccess } from '../tours/guidePortal/access.js';
import { emitTimelineEvent } from '../timeline/events.js';
import { PAYROLL_SUBJECT } from '../payroll/service.js';
import { guidePayEntryDto } from '../payroll/dto.js';
import { entryTotals } from '../payroll/engine.js';
import { businessToday } from '../tours/completion.js';

const router = Router();

async function payAccess(req, res) {
  const access = await resolveGuidePortalAccess(req.params.token);
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return null;
  }
  if (!access.permissions.viewPay) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return access;
}

function guideOrigin(person) {
  return {
    actorType: 'api',
    actorLabel: `מדריך: ${person.displayName}`,
    createdBy: null,
    createdByName: null,
  };
}

// Own-entry resolution used by both actions: the entry must belong to this
// guide, be active, and its activity must be office-approved and active.
async function ownEntry(req, res, access) {
  const entry = await prisma.payrollEntry.findUnique({
    where: { id: req.params.entryId },
    include: { activity: true, lines: true },
  });
  if (
    !entry ||
    entry.externalPersonId !== access.person.externalPersonId ||
    entry.state !== 'active' ||
    entry.activity.state !== 'active' ||
    entry.activity.status !== 'office_approved'
  ) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return entry;
}

// GET /api/portal/:token/pay?month=YYYY-MM
router.get(
  '/:token/pay',
  handle(async (req, res) => {
    const access = await payAccess(req, res);
    if (!access) return;
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || ''))
      ? String(req.query.month)
      : businessToday().slice(0, 7);

    const entries = await prisma.payrollEntry.findMany({
      where: {
        externalPersonId: access.person.externalPersonId,
        state: 'active',
        activity: { state: 'active', status: 'office_approved', payrollMonth: month },
      },
      include: { activity: true, lines: true },
      orderBy: { createdAt: 'asc' },
    });
    const components = await prisma.payrollComponent.findMany({
      select: { id: true, guideVisible: true },
    });
    const componentById = new Map(components.map((c) => [c.id, c]));

    let approvedMinor = 0;
    let waitingMinor = 0;
    for (const e of entries) {
      const t = entryTotals(e.lines, { vatStatus: e.vatStatusSnapshot, vatRate: e.vatRateSnapshot });
      if (e.guideStatus === 'approved') approvedMinor += t.totalMinor;
      else waitingMinor += t.totalMinor;
    }

    // Months that have anything to show — drives the picker.
    const monthRows = await prisma.payrollEntry.findMany({
      where: {
        externalPersonId: access.person.externalPersonId,
        state: 'active',
        activity: { state: 'active', status: 'office_approved' },
      },
      select: { activity: { select: { payrollMonth: true } } },
    });
    const months = [...new Set(monthRows.map((r) => r.activity.payrollMonth))].sort().reverse();

    res.json({
      month,
      months,
      totals: { approvedMinor, waitingMinor },
      entries: entries
        .sort((a, b) => String(a.activity.date || '9999').localeCompare(String(b.activity.date || '9999')))
        .map((e) => guidePayEntryDto(e, e.activity, componentById)),
    });
  }),
);

// POST /api/portal/:token/pay/entries/:entryId/approve
router.post(
  '/:token/pay/entries/:entryId/approve',
  handle(async (req, res) => {
    const access = await payAccess(req, res);
    if (!access) return;
    const entry = await ownEntry(req, res, access);
    if (!entry) return;
    if (entry.guideStatus === 'approved') return res.json({ ok: true, already: true });
    await prisma.payrollEntry.update({
      where: { id: entry.id },
      data: { guideStatus: 'approved', guideApprovedAt: new Date() },
    });
    await emitTimelineEvent(prisma, {
      subjectType: PAYROLL_SUBJECT,
      subjectId: entry.activityId,
      kind: 'payroll',
      body: `✅ ${entry.displayName} אישר/ה את רשומת השכר`,
      data: { event: 'guide_approved', entryId: entry.id },
      origin: guideOrigin(access.person),
    });
    res.json({ ok: true });
  }),
);

// POST /api/portal/:token/pay/entries/:entryId/comment  { text }
// "יש הערה? לחץ כאן" — the entry moves to בבירור and the office sees the
// comment in the activity's history.
router.post(
  '/:token/pay/entries/:entryId/comment',
  handle(async (req, res) => {
    const access = await payAccess(req, res);
    if (!access) return;
    const entry = await ownEntry(req, res, access);
    if (!entry) return;
    const text = String(req.body?.text || '').trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: 'text_required' });
    await prisma.payrollEntry.update({
      where: { id: entry.id },
      data: { guideStatus: 'inquiry', guideApprovedAt: null },
    });
    await emitTimelineEvent(prisma, {
      subjectType: PAYROLL_SUBJECT,
      subjectId: entry.activityId,
      kind: 'payroll',
      body: `💬 הערת מדריך (${entry.displayName}): ${text}`,
      data: { event: 'guide_inquiry', entryId: entry.id, text },
      origin: guideOrigin(access.person),
    });
    res.json({ ok: true });
  }),
);

export default router;
