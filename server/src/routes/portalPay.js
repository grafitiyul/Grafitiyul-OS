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
import { emitPayrollChanged, openPayrollStream } from '../payroll/events.js';
import { guidePayEntryDto, guideConversationDto } from '../payroll/dto.js';
import { entryTotals } from '../payroll/engine.js';
import { businessToday } from '../tours/completion.js';

const router = Router();

async function payAccess(req, res) {
  // Signature matters: resolveGuidePortalAccess(client, { portalToken }) —
  // the other portal routers' exact call shape. Passing the token positionally
  // made the resolver throw before ANY payroll query ran (the "שגיאה בטעינת
  // נתוני השכר" bug after office approval).
  const access = await resolveGuidePortalAccess(prisma, { portalToken: req.params.token });
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
// guide, be active, and be OFFICE-APPROVED — the entry-level truth. In a
// partially approved activity each guide sees exactly their own approved
// entry and nothing about anyone else's approval state.
async function ownEntry(req, res, access) {
  const entry = await prisma.payrollEntry.findUnique({
    where: { id: req.params.entryId },
    include: { activity: true, lines: true },
  });
  if (
    !entry ||
    entry.externalPersonId !== access.person.externalPersonId ||
    entry.state !== 'active' ||
    entry.officeStatus !== 'approved' ||
    entry.activity.state !== 'active'
  ) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return entry;
}

// GET /api/portal/:token/pay/events — the guide's real-time invalidation
// stream (SSE). Access is the canonical resolveGuidePortalAccess flow
// (portalEnabled/status + viewPay), and the subscription scope is pinned to
// the RESOLVED externalPersonId — a guide cannot subscribe to anyone else's
// events by crafting parameters. Events carry no amounts/comments/identities;
// the portal refetches its permission-gated DTO on receipt.
router.get(
  '/:token/pay/events',
  handle(async (req, res) => {
    const access = await payAccess(req, res);
    if (!access) return;
    openPayrollStream(req, res, {
      scope: 'guide',
      externalPersonId: access.person.externalPersonId,
    });
  }),
);

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
        officeStatus: 'approved', // entry-level office approval — THE gate
        activity: { state: 'active', payrollMonth: month },
      },
      include: { activity: true, lines: true },
      orderBy: { createdAt: 'asc' },
    });
    const components = await prisma.payrollComponent.findMany({
      select: { id: true, guideVisible: true },
    });
    const componentById = new Map(components.map((c) => [c.id, c]));
    // Configurable unit noun per general-activity type (one query for the
    // month's general activities) → keyed by generalActivityId. Tours have no
    // general activity, so their lines carry no unit label. This is the ONLY
    // source of the noun — the DTO never guesses it.
    const generalActivityIds = [
      ...new Set(entries.map((e) => e.activity.generalActivityId).filter(Boolean)),
    ];
    const generals = generalActivityIds.length
      ? await prisma.generalActivity.findMany({
          where: { id: { in: generalActivityIds } },
          select: { id: true, type: { select: { unitLabelSingularHe: true, unitLabelPluralHe: true } } },
        })
      : [];
    const unitLabelsByGeneralId = new Map(
      generals.map((g) => [
        g.id,
        { singular: g.type?.unitLabelSingularHe || null, plural: g.type?.unitLabelPluralHe || null },
      ]),
    );
    // Conversation rows for the guide's own entries (one query; the DTO
    // filters strictly per entryId — no other staff member's thread leaks).
    const activityIds = [...new Set(entries.map((e) => e.activityId))];
    const timelineRows = activityIds.length
      ? await prisma.timelineEntry.findMany({
          where: { subjectType: 'payroll_activity', subjectId: { in: activityIds }, kind: 'payroll', deletedAt: null },
          select: { id: true, kind: true, data: true, createdAt: true },
        })
      : [];

    // Summary semantics (product rule): the top card never aggregates
    // UNapproved amounts — it shows the NUMBER of activities awaiting the
    // guide's action (incl. entries in inquiry/re-review). Amounts join
    // "אושר על ידך" only after the guide approves. Per-entry amounts remain
    // visible inside each card — the guide reviews them there.
    let approvedMinor = 0;
    let pendingCount = 0;
    for (const e of entries) {
      if (e.guideStatus === 'approved') {
        const t = entryTotals(e.lines, { vatStatus: e.vatStatusSnapshot, vatRate: e.vatRateSnapshot });
        approvedMinor += t.totalMinor;
      } else {
        pendingCount += 1; // one per payroll activity entry, never per line
      }
    }

    // Months that have anything to show — drives the picker.
    const monthRows = await prisma.payrollEntry.findMany({
      where: {
        externalPersonId: access.person.externalPersonId,
        state: 'active',
        officeStatus: 'approved',
        activity: { state: 'active' },
      },
      select: { activity: { select: { payrollMonth: true } } },
    });
    const months = [...new Set(monthRows.map((r) => r.activity.payrollMonth))].sort().reverse();

    res.json({
      month,
      months,
      totals: { approvedMinor, pendingCount },
      entries: entries
        .sort((a, b) => String(a.activity.date || '9999').localeCompare(String(b.activity.date || '9999')))
        .map((e) =>
          guidePayEntryDto(
            e,
            e.activity,
            componentById,
            guideConversationDto(timelineRows, e.id),
            e.activity.generalActivityId ? unitLabelsByGeneralId.get(e.activity.generalActivityId) || null : null,
          ),
        ),
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
    emitPayrollChanged(prisma, {
      activityId: entry.activityId,
      entryId: entry.id,
      externalPersonId: entry.externalPersonId,
      reason: 'guide_approved',
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
    // First comment OPENS the inquiry (a comment after a resolution REopens
    // it); further messages while it is open just extend the conversation —
    // no status churn, no duplicate events. Approval stays a separate field.
    const opensInquiry = entry.inquiryStatus !== 'open';
    if (opensInquiry) {
      await prisma.payrollEntry.update({
        where: { id: entry.id },
        data: {
          inquiryStatus: 'open',
          inquiryResolvedAt: null,
          inquiryResolvedBy: null,
          guideStatus: 'pending',
          guideApprovedAt: null,
        },
      });
    }
    await emitTimelineEvent(prisma, {
      subjectType: PAYROLL_SUBJECT,
      subjectId: entry.activityId,
      kind: 'payroll',
      body: `💬 ${opensInquiry ? 'הערת מדריך' : 'הודעת מדריך'} (${entry.displayName}): ${text}`,
      data: { event: opensInquiry ? 'guide_inquiry' : 'guide_message', entryId: entry.id, text },
      origin: guideOrigin(access.person),
    });
    emitPayrollChanged(prisma, {
      activityId: entry.activityId,
      entryId: entry.id,
      externalPersonId: entry.externalPersonId,
      reason: opensInquiry ? 'inquiry_opened' : 'guide_message',
    });
    res.json({ ok: true });
  }),
);

export default router;
