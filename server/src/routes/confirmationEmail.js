import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import {
  templateShapeErrors,
  findTemplateConflicts,
  CONFIRMATION_ACTIVITY_TYPES,
} from '../confirmation/resolveTemplate.js';
import {
  AUTO_SECTIONS,
  defaultSections,
  normalizeSections,
  blockIdsInSections,
} from '../confirmation/sections.js';
import { CONFIRMATION_CONTENT_TYPES } from '../shared-content/sharedContentTypes.js';
import {
  composeConfirmationEmail,
  attachSlotTemplate,
  TOUR_DURATION_SELECT,
} from '../confirmation/composer.js';
import { normalizeOverrideState } from '../confirmation/overrides.js';
import { resolveSendAccount, cleanRecipientList } from '../email/composedSend.js';
import {
  FILLER_KINDS,
  NEW_GUIDE_DEFAULT_NOTE,
  normalizeFillers,
  validateFillers,
} from '../confirmation/fillers.js';
import { tourDurationHours, effectiveDurationHours } from '../tours/tourTime.js';
import { emitTimelineEvent, userOrigin } from '../timeline/events.js';
import { recordDealChanges, DEAL_DIFF_SELECT } from '../timeline/dealChangelog.js';

// CRM settings → מייל אישור — confirmation-email template management.
// Selection semantics (specificity → priority → REFUSE ambiguity) live in
// src/confirmation/resolveTemplate.js; this router owns CRUD + the invariants:
//   • exactly ONE default template, all-wildcard, active (the guaranteed
//     fallback — PriceList.isDefault convention);
//   • sections JSON ↔ ConfirmationTemplateBlock rows stay in sync on every
//     save (the join rows are the Restrict deletion guard on SharedContent);
//   • every list/save response carries `conflicts` (findTemplateConflicts) so
//     overlapping templates are flagged at SAVE time, before send can refuse.

const router = Router();

const MAX_RICH = 200_000;
const cleanRich = (v) => (v === undefined ? undefined : v ? String(v).slice(0, MAX_RICH) : null);
const cleanText = (v) => (v === undefined ? undefined : v ? String(v).trim() || null : null);
const cleanIdList = (v) =>
  Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x))] : [];

const TEMPLATE_INCLUDE = {
  blockLinks: {
    include: {
      sharedContent: {
        select: { id: true, type: true, internalName: true, bodyHe: true, bodyEn: true, active: true },
      },
    },
  },
};

async function listPayload(tx = prisma) {
  const templates = await tx.confirmationEmailTemplate.findMany({
    include: TEMPLATE_INCLUDE,
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  return { templates, conflicts: findTemplateConflicts(templates) };
}

// GET / — templates + save-time conflict report + the section/type vocabulary
// (the client renders labels from here, never from a hardcoded mirror).
router.get(
  '/',
  handle(async (_req, res) => {
    const payload = await listPayload();
    res.json({
      ...payload,
      meta: {
        autoSections: AUTO_SECTIONS,
        blockTypes: CONFIRMATION_CONTENT_TYPES,
        activityTypes: CONFIRMATION_ACTIVITY_TYPES,
      },
    });
  }),
);

// POST / — create. The FIRST template becomes the default automatically (the
// system must always have its all-wildcard fallback).
router.post(
  '/',
  handle(async (req, res) => {
    const internalName = String(req.body?.internalName || '').trim();
    if (!internalName) return res.status(400).json({ error: 'internalName_required' });
    const count = await prisma.confirmationEmailTemplate.count();
    const row = await prisma.confirmationEmailTemplate.create({
      data: {
        internalName,
        isDefault: count === 0,
        sections: defaultSections(),
      },
      include: TEMPLATE_INCLUDE,
    });
    res.status(201).json(row);
  }),
);

// PUT /:id — update. Scoping edits on the default template are rejected
// (default_must_be_wildcard); turning the default off/inactive directly is
// rejected — promote ANOTHER template to default instead (default_required).
router.put(
  '/:id',
  handle(async (req, res) => {
    const existing = await prisma.confirmationEmailTemplate.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) return res.status(404).json({ error: 'template_not_found' });

    const b = req.body || {};
    const data = {};
    if (b.internalName !== undefined) {
      const v = String(b.internalName).trim();
      if (!v) return res.status(400).json({ error: 'internalName_required' });
      data.internalName = v;
    }
    for (const k of ['productIds', 'activityTypes', 'orgTypeIds']) {
      if (b[k] !== undefined) data[k] = cleanIdList(b[k]);
    }
    if (b.priority !== undefined) data.priority = Number(b.priority) || 0;
    for (const k of ['subjectHe', 'subjectEn']) {
      if (b[k] !== undefined) data[k] = cleanText(b[k]);
    }
    for (const k of ['greetingHe', 'greetingEn', 'closingHe', 'closingEn']) {
      if (b[k] !== undefined) data[k] = cleanRich(b[k]);
    }

    // The default must stay the guaranteed fallback: always exactly one,
    // always active. Demotion happens only by promoting another template.
    const willBeDefault = b.isDefault !== undefined ? !!b.isDefault : existing.isDefault;
    if (existing.isDefault && !willBeDefault) {
      return res.status(409).json({ error: 'default_required' });
    }
    if (b.active !== undefined) {
      if (willBeDefault && !b.active) return res.status(409).json({ error: 'default_must_stay_active' });
      data.active = !!b.active;
    }
    if (b.isDefault !== undefined) data.isDefault = willBeDefault;

    const shapeCheck = { ...existing, ...data };
    const shapeErrs = templateShapeErrors(shapeCheck);
    if (shapeErrs.length) {
      return res.status(400).json({ error: 'invalid_template', details: shapeErrs });
    }

    // Sections: validate block refs against ACTIVE confirmation-type library
    // rows, then sync the join rows to exactly the referenced ids.
    let nextSections;
    if (b.sections !== undefined) {
      const validBlocks = await prisma.sharedContent.findMany({
        where: { type: { in: CONFIRMATION_CONTENT_TYPES }, active: true },
        select: { id: true },
      });
      nextSections = normalizeSections(b.sections, validBlocks.map((r) => r.id));
      data.sections = nextSections;
    }

    const row = await prisma.$transaction(async (tx) => {
      if (data.isDefault && !existing.isDefault) {
        await tx.confirmationEmailTemplate.updateMany({
          where: { isDefault: true, id: { not: existing.id } },
          data: { isDefault: false },
        });
      }
      const updated = await tx.confirmationEmailTemplate.update({
        where: { id: existing.id },
        data,
      });
      if (nextSections !== undefined) {
        const wanted = new Set(blockIdsInSections(nextSections));
        await tx.confirmationTemplateBlock.deleteMany({
          where: { templateId: existing.id, sharedContentId: { notIn: [...wanted] } },
        });
        const have = await tx.confirmationTemplateBlock.findMany({
          where: { templateId: existing.id },
          select: { sharedContentId: true },
        });
        const haveSet = new Set(have.map((r) => r.sharedContentId));
        const missing = [...wanted].filter((id) => !haveSet.has(id));
        if (missing.length) {
          await tx.confirmationTemplateBlock.createMany({
            data: missing.map((sharedContentId) => ({ templateId: existing.id, sharedContentId })),
          });
        }
      }
      return tx.confirmationEmailTemplate.findUnique({
        where: { id: existing.id },
        include: TEMPLATE_INCLUDE,
      });
    });

    const { conflicts } = await listPayload();
    res.json({ template: row, conflicts });
  }),
);

// Duration context for the deal-card editor: the tour (or product×city
// variant) the canonical chain reads from. The slot template is a LOOSE ref —
// attachSlotTemplate loads it; it must never appear inside an include.
async function dealDurationTour(deal) {
  const tour = await attachSlotTemplate(prisma, deal.bookings?.[0]?.tourEvent || null);
  if (tour) return tour;
  if (!deal.productId || !deal.locationId) return null;
  return {
    productVariant: await prisma.productVariant.findFirst({
      where: { productId: deal.productId, locationId: deal.locationId },
      select: { durationHours: true },
    }),
  };
}

export const DEAL_STATE_INCLUDE = {
  confirmation: true,
  bookings: {
    where: { status: 'active' },
    include: {
      tourEvent: { select: TOUR_DURATION_SELECT },
    },
  },
};

// GET /deal/:dealId/state — the deal card's working set: active fillers,
// duration context, the predefined cancellation policies, and the filler
// vocabulary (labels + the editable new-guide default wording).
router.get(
  '/deal/:dealId/state',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({
      where: { id: req.params.dealId },
      include: DEAL_STATE_INCLUDE,
    });
    if (!deal) return res.status(404).json({ error: 'deal_not_found' });
    const tour = await dealDurationTour(deal);
    const fillers = normalizeFillers(deal.confirmation?.fillers);
    const policies = await prisma.sharedContent.findMany({
      where: { type: 'confirmation_cancellation_policy', active: true },
      select: { id: true, internalName: true, bodyHe: true, bodyEn: true },
      orderBy: [{ sortOrder: 'asc' }, { internalName: 'asc' }],
    });
    res.json({
      fillers,
      hasFillers: fillers.length > 0,
      overrideState: deal.confirmation?.overrideState || null,
      durationInfo: {
        canonicalHours: tourDurationHours(tour),
        effectiveHours: effectiveDurationHours(deal, tour),
        overridden: deal.durationHours != null,
      },
      policies,
      meta: {
        fillerKinds: FILLER_KINDS.map((f) => ({ kind: f.kind, labelHe: f.labelHe })),
        newGuideDefaultNote: NEW_GUIDE_DEFAULT_NOTE,
      },
    });
  }),
);

// PUT /deal/:dealId/state — save the filler set. The activity_duration filler
// ALSO writes Deal.durationHours (structured, changelog-tracked); removing it
// clears the override. One timeline entry summarizes the filler set change.
router.put(
  '/deal/:dealId/state',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({
      where: { id: req.params.dealId },
      include: { confirmation: true },
    });
    if (!deal) return res.status(404).json({ error: 'deal_not_found' });

    const fillers = normalizeFillers(req.body?.fillers);
    const problems = validateFillers(fillers);
    if (problems.length) return res.status(400).json({ error: 'invalid_fillers', problems });

    const origin = await userOrigin(req.adminAuth?.userId);
    const durationFiller = fillers.find((f) => f.kind === 'activity_duration');
    const nextDuration = durationFiller ? durationFiller.durationHours : null;

    const before = await prisma.deal.findUnique({
      where: { id: deal.id },
      select: DEAL_DIFF_SELECT,
    });
    const prevKinds = normalizeFillers(deal.confirmation?.fillers).map((f) => f.kind);
    const nextKinds = fillers.map((f) => f.kind);

    await prisma.$transaction(async (tx) => {
      await tx.deal.update({ where: { id: deal.id }, data: { durationHours: nextDuration } });
      await tx.dealConfirmation.upsert({
        where: { dealId: deal.id },
        create: { dealId: deal.id, fillers, updatedById: req.adminAuth?.userId || null },
        update: { fillers, updatedById: req.adminAuth?.userId || null },
      });
      const added = nextKinds.filter((k) => !prevKinds.includes(k));
      const removed = prevKinds.filter((k) => !nextKinds.includes(k));
      if (added.length || removed.length) {
        const label = (k) => FILLER_KINDS.find((f) => f.kind === k)?.labelHe || k;
        await emitTimelineEvent(tx, {
          subjectId: deal.id,
          kind: 'change',
          origin,
          data: {
            title: 'תנאי עסקה מיוחדים (פילרים)',
            changes: [
              ...added.map((k) => ({ fieldKey: `filler:${k}`, labelHe: label(k), oldDisplay: null, newDisplay: 'פעיל' })),
              ...removed.map((k) => ({ fieldKey: `filler:${k}`, labelHe: label(k), oldDisplay: 'פעיל', newDisplay: null })),
            ],
          },
        }); // emitTimelineEvent touches lastMeaningfulActivityAt itself
      }
    });
    const after = await prisma.deal.findUnique({ where: { id: deal.id }, select: DEAL_DIFF_SELECT });
    await recordDealChanges(prisma, { dealId: deal.id, before, after, origin });

    res.json({ ok: true, fillers, hasFillers: fillers.length > 0 });
  }),
);

// PUT /deal/:dealId/overrides — save the PERSISTENT per-deal override layer
// (the preview's "החל גם על מיילים עתידיים" checkbox). The temporary layer is
// never stored — it rides the compose/send request bodies only.
router.put(
  '/deal/:dealId/overrides',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({ where: { id: req.params.dealId }, select: { id: true } });
    if (!deal) return res.status(404).json({ error: 'deal_not_found' });
    const overrideState = normalizeOverrideState(req.body?.overrideState);
    await prisma.dealConfirmation.upsert({
      where: { dealId: deal.id },
      create: { dealId: deal.id, overrideState, updatedById: req.adminAuth?.userId || null },
      update: { overrideState, updatedById: req.adminAuth?.userId || null },
    });
    res.json({ ok: true, overrideState });
  }),
);

// Warnings that BLOCK a send unless the operator explicitly approved them in
// the preview (acknowledgeWarnings). Recipient/subject are hard requirements
// and are never acknowledgeable — they must be provided or exist.
const ACKNOWLEDGEABLE = new Set(['missing_content', 'missing_policy', 'no_tour']);

// POST /deal/:dealId/send — compose (same pipeline as preview), validate,
// hand ONE email to the canonical queue (ScheduledEmail, scheduledAt=now) and
// write the immutable ConfirmationEmailSend snapshot. The queue owns delivery:
// connected Gmail account frozen at enqueue, retries, connection-deferral,
// customer×email sending windows, thread mirror + CRM linking.
router.post(
  '/deal/:dealId/send',
  handle(async (req, res) => {
    const composed = await composeConfirmationEmail(prisma, req.params.dealId, {
      language: req.body?.language,
      overrideOverlay: req.body?.overrideOverlay || null,
    });
    if (composed.error === 'deal_not_found') return res.status(404).json({ error: composed.error });
    if (composed.error) return res.status(422).json({ error: composed.error, ...composed.meta });

    // Test send (QA): the EXACT same composer/resolver/queue pipeline — the
    // only differences are the recipient, a '[בדיקה]' subject prefix, no
    // deal/contact thread linking and no timeline entry (a QA probe is not
    // customer communication). Everything else, including sending windows and
    // the snapshot, is production behavior.
    const isTest = !!req.body?.test;

    // Operator-edited recipient/subject from the send step win over composed.
    const to = cleanRecipientList([
      { email: req.body?.to || composed.recipient?.email, name: isTest ? null : composed.recipient?.name },
    ]);
    const baseSubject = String(req.body?.subject ?? composed.subject ?? '').trim();
    const subject = isTest && baseSubject ? `[בדיקה] ${baseSubject}` : baseSubject;
    if (!to.length) return res.status(422).json({ error: 'no_recipient_email' });
    if (!subject) return res.status(422).json({ error: 'missing_subject' });

    const blocking = composed.warnings.filter((w) => ACKNOWLEDGEABLE.has(w.code));
    if (blocking.length && !req.body?.acknowledgeWarnings) {
      return res.status(422).json({ error: 'send_blocked', warnings: blocking });
    }

    // Double-click guard: a second send for the same deal within 10s is a
    // duplicate, not a decision. Deliberate resends after that are allowed.
    const recent = await prisma.confirmationEmailSend.findFirst({
      where: { dealId: composed.dealId, createdAt: { gt: new Date(Date.now() - 10_000) } },
      select: { id: true },
    });
    if (recent) return res.status(409).json({ error: 'duplicate_send' });

    // ONE derivation: the composer already assembled + sanitized the exact
    // body (composed.emailHtml) — the preview's final view showed this string.
    const bodyHtml = composed.emailHtml;
    if (!bodyHtml) return res.status(422).json({ error: 'empty_body' });

    // Freeze the sending account NOW (the queue contract) — fails with
    // no_connected_account before anything is written.
    let account;
    try {
      account = await resolveSendAccount(null);
    } catch (e) {
      return res.status(422).json({ error: e.code || 'no_connected_account' });
    }

    const origin = await userOrigin(req.adminAuth?.userId);
    const { scheduled, snapshot } = await prisma.$transaction(async (tx) => {
      const scheduled = await tx.scheduledEmail.create({
        data: {
          accountId: account.id,
          toJson: to,
          subject,
          bodyHtml,
          dealId: isTest ? null : composed.dealId,
          contactId: isTest ? null : composed.recipient?.contactId || null,
          scheduledAt: new Date(),
          createdById: req.adminAuth?.userId || null,
        },
      });
      const snapshot = await tx.confirmationEmailSend.create({
        data: {
          dealId: composed.dealId,
          templateId: composed.template.id,
          templateName: composed.template.internalName,
          language: composed.language,
          recipientSnapshot: {
            ...to[0],
            contactId: isTest ? null : composed.recipient?.contactId || null,
            ...(isTest ? { test: true } : {}),
          },
          subject,
          bodyHtml,
          fillersSnapshot: composed.fillers,
          overridesSnapshot: req.body?.overrideOverlay || null,
          imagesSnapshot: composed.sections
            .filter((s) => s.key === 'meeting_point_image' && s.data?.url)
            .map((s) => ({ role: 'meeting_point', url: s.data.url })),
          // Frozen "generated from" — the archive's debugging answer even
          // after the template/blocks are edited or deleted.
          generationMeta: {
            templateName: composed.template.internalName,
            language: composed.language,
            blocks: composed.sections
              .filter((s) => s.kind === 'block')
              .map((s) => ({ id: s.id.replace(/^block:/, ''), internalName: s.title, type: s.type })),
            fillers: composed.fillers.map((f) => f.kind),
            ...(isTest ? { test: true } : {}),
          },
          scheduledEmailId: scheduled.id,
          createdById: req.adminAuth?.userId || null,
        },
      });
      if (!isTest) {
        await emitTimelineEvent(tx, {
          subjectId: composed.dealId,
          kind: 'communication',
          origin,
          data: {
            event: 'confirmation_email_queued',
            sendId: snapshot.id,
            channel: 'email',
            language: composed.language,
            recipientName: to[0].name || to[0].email,
            subject,
            eventName: 'מייל אישור',
            messageName: composed.template.internalName,
          },
        });
      }
      return { scheduled, snapshot };
    });

    res.json({ ok: true, sendId: snapshot.id, scheduledEmailId: scheduled.id, queued: true });
  }),
);

// POST /deal/:dealId/compose — the preview/compose endpoint. One pipeline for
// preview AND send; accepts a one-shot overrideOverlay (never stored) and an
// explicit language override for admin inspection. Template-resolution
// failures are 422 with the tied template ids — the client names them.
router.post(
  '/deal/:dealId/compose',
  handle(async (req, res) => {
    const result = await composeConfirmationEmail(prisma, req.params.dealId, {
      language: req.body?.language,
      overrideOverlay: req.body?.overrideOverlay || null,
    });
    if (result.error === 'deal_not_found') return res.status(404).json({ error: result.error });
    if (result.error) return res.status(422).json({ error: result.error, ...result.meta });
    res.json(result);
  }),
);

// GET /sends/:id — one immutable snapshot (the archive viewer). Read-only by
// construction: content fields are never updated after creation; delivery
// outcome is read live off the linked queue row.
router.get(
  '/sends/:id',
  handle(async (req, res) => {
    const snap = await prisma.confirmationEmailSend.findUnique({ where: { id: req.params.id } });
    if (!snap) return res.status(404).json({ error: 'send_not_found' });
    const delivery = snap.scheduledEmailId
      ? await prisma.scheduledEmail.findUnique({
        where: { id: snap.scheduledEmailId },
        select: { status: true, sentAt: true, failureReason: true, waitReason: true, attemptCount: true },
      })
      : null;
    res.json({ ...snap, delivery });
  }),
);

// DELETE /:id — the default is undeletable (promote another first). Block
// links cascade with the template; library content is never touched.
router.delete(
  '/:id',
  handle(async (req, res) => {
    const existing = await prisma.confirmationEmailTemplate.findUnique({
      where: { id: req.params.id },
      select: { isDefault: true },
    });
    if (!existing) return res.status(404).json({ error: 'template_not_found' });
    if (existing.isDefault) return res.status(409).json({ error: 'default_template_undeletable' });
    await prisma.confirmationEmailTemplate.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
