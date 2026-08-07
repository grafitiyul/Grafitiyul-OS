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
import { sendConfirmationEmail } from '../confirmation/sendService.js';
import { resolveDelivery } from '../email/deliveryState.js';
import { resolveConfirmationReview } from '../confirmation/wonHook.js';
import {
  FILLER_KINDS,
  normalizeFillers,
  validateFillers,
  fillerSpecialTextCategory,
} from '../confirmation/fillers.js';
import {
  listConfirmationVariables,
  CONFIRMATION_VARIABLE_CATEGORIES,
} from '../confirmation/variables.js';
import {
  SPECIAL_TEXT_CATEGORIES,
  isValidSpecialTextCategory,
} from '../confirmation/specialTexts.js';
import { tourDurationHours, effectiveDurationHours } from '../tours/tourTime.js';
import { emitTimelineEvent, userOrigin } from '../timeline/events.js';
import { recordDealChanges, DEAL_DIFF_SELECT } from '../timeline/dealChangelog.js';
import { registerDealOrderNoParam } from './dealParam.js';

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

// Deal-scoped routes accept orderNo OR cuid — the shared resolver. The Deal
// page's route param IS the orderNo; before this, the direct "שליחת מייל
// אישור" action failed with deal_not_found on every deal (#26340) while the
// preview modal (which passes the cuid) worked.
registerDealOrderNoParam(router, 'dealId');

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
        // THE customer-facing variable catalog — same list the composer
        // resolves; the client registers these for the editor picker.
        variables: listConfirmationVariables(),
        variableCategories: CONFIRMATION_VARIABLE_CATEGORIES,
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
  // The deal-card editors show ONE language — the customer's communication
  // language (Hebrew fallback), resolved exactly like the composer does.
  contacts: {
    include: {
      contact: { select: { communicationLanguage: true, emails: { select: { id: true } } } },
    },
    orderBy: { isPrimary: 'desc' },
  },
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
    // The office picks by internal name + explanation; customer text never
    // renders in the deal card. Grouped by category so EVERY special-text
    // filler (cancellation, new guide, future ones) gets its options.
    const specialRows = await prisma.confirmationSpecialText.findMany({
      where: { active: true },
      select: { id: true, category: true, internalName: true, internalNote: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { internalName: 'asc' }],
    });
    const specialTexts = {};
    for (const c of SPECIAL_TEXT_CATEGORIES) {
      specialTexts[c.key] = specialRows.filter((r) => r.category === c.key);
    }
    // Same recipient pick as the composer: first contact WITH an email, else
    // the first contact — so the card edits the language the send will use.
    const recipientContact =
      (deal.contacts.find((dc) => (dc.contact?.emails || []).length) || deal.contacts[0])?.contact;
    const language = recipientContact?.communicationLanguage === 'en' ? 'en' : 'he';
    res.json({
      fillers,
      hasFillers: fillers.length > 0,
      language,
      overrideState: deal.confirmation?.overrideState || null,
      durationInfo: {
        canonicalHours: tourDurationHours(tour),
        effectiveHours: effectiveDurationHours(deal, tour),
        overridden: deal.durationHours != null,
      },
      specialTexts,
      meta: {
        // specialTextCategory tells the card which kinds use the
        // default/predefined/override picker instead of a plain note.
        fillerKinds: FILLER_KINDS.map((f) => ({
          kind: f.kind,
          labelHe: f.labelHe,
          specialTextCategory: fillerSpecialTextCategory(f.kind),
        })),
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

// POST /deal/:dealId/send — thin HTTP shell over confirmation/sendService.js,
// THE one send path (also used by the automatic WON hook and the tour-update
// resend). Validation, first-vs-repeat subject, queue row + immutable
// snapshot and the timeline entry all live in the service.
router.post(
  '/deal/:dealId/send',
  handle(async (req, res) => {
    const out = await sendConfirmationEmail({
      dealId: req.params.dealId,
      language: req.body?.language,
      overrideOverlay: req.body?.overrideOverlay || null,
      to: req.body?.to,
      subject: req.body?.subject,
      test: !!req.body?.test,
      acknowledgeWarnings: !!req.body?.acknowledgeWarnings,
      trigger: req.body?.test ? 'test' : 'manual',
      actorUserId: req.adminAuth?.userId || null,
      languageOverridden: !!req.body?.languageOverridden,
      contactLanguageUpdated: !!req.body?.contactLanguageUpdated,
    });
    if (out.error === 'deal_not_found') return res.status(404).json({ error: out.error });
    if (out.error === 'duplicate_send') return res.status(409).json({ error: out.error });
    if (out.error) {
      return res.status(422).json({ error: out.error, ...(out.meta || {}), ...(out.warnings ? { warnings: out.warnings } : {}), ...(out.status ? { status: out.status } : {}) });
    }
    // A real send closes any open "review this confirmation email" card.
    if (!req.body?.test) await resolveConfirmationReview(out.sendId, req.params.dealId, req.adminAuth);
    // The response carries the CANONICAL delivery state, not a `queued:true`
    // flag the client has to interpret. At this instant it is 'queued' — the
    // toast says exactly that and nothing more (#27099/#27100).
    const delivery = await resolveDelivery(out.scheduledEmailId);
    res.json({
      ok: true,
      sendId: out.sendId,
      scheduledEmailId: out.scheduledEmailId,
      delivery,
      subject: out.subject,
      sendKind: out.sendKind,
      windowHold: out.windowHold || null,
    });
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

// ── Special texts (CRM Settings) — office-curated per-deal wording options.
// Category-generic (registry: confirmation/specialTexts.js); cancellation
// policies are the first category. Exactly ONE active default per category:
// the first row auto-defaults, promotion unsets the previous, the default is
// undeletable / undemotable / must stay active.

router.get(
  '/special-texts',
  handle(async (_req, res) => {
    const texts = await prisma.confirmationSpecialText.findMany({
      orderBy: [{ category: 'asc' }, { isDefault: 'desc' }, { sortOrder: 'asc' }, { internalName: 'asc' }],
    });
    res.json({ categories: SPECIAL_TEXT_CATEGORIES, texts });
  }),
);

router.post(
  '/special-texts',
  handle(async (req, res) => {
    const category = String(req.body?.category || '');
    if (!isValidSpecialTextCategory(category)) return res.status(400).json({ error: 'invalid_category' });
    const internalName = String(req.body?.internalName || '').trim();
    if (!internalName) return res.status(400).json({ error: 'internalName_required' });
    const count = await prisma.confirmationSpecialText.count({ where: { category } });
    const row = await prisma.confirmationSpecialText.create({
      data: {
        category,
        internalName,
        internalNote: String(req.body?.internalNote || '').trim() || null,
        bodyHe: cleanRich(req.body?.bodyHe) ?? null,
        bodyEn: cleanRich(req.body?.bodyEn) ?? null,
        isDefault: count === 0, // the category always has its guaranteed default
      },
    });
    res.status(201).json(row);
  }),
);

router.put(
  '/special-texts/:id',
  handle(async (req, res) => {
    const existing = await prisma.confirmationSpecialText.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const data = {};
    if (b.internalName !== undefined) {
      const v = String(b.internalName).trim();
      if (!v) return res.status(400).json({ error: 'internalName_required' });
      data.internalName = v;
    }
    if (b.internalNote !== undefined) data.internalNote = String(b.internalNote).trim() || null;
    const he = cleanRich(b.bodyHe);
    if (he !== undefined) data.bodyHe = he;
    const en = cleanRich(b.bodyEn);
    if (en !== undefined) data.bodyEn = en;

    const willBeDefault = b.isDefault !== undefined ? !!b.isDefault : existing.isDefault;
    if (existing.isDefault && !willBeDefault) return res.status(409).json({ error: 'default_required' });
    if (b.active !== undefined) {
      if (willBeDefault && !b.active) return res.status(409).json({ error: 'default_must_stay_active' });
      data.active = !!b.active;
    }
    if (b.isDefault !== undefined) data.isDefault = willBeDefault;

    const row = await prisma.$transaction(async (tx) => {
      if (data.isDefault && !existing.isDefault) {
        await tx.confirmationSpecialText.updateMany({
          where: { category: existing.category, isDefault: true, id: { not: existing.id } },
          data: { isDefault: false },
        });
      }
      return tx.confirmationSpecialText.update({ where: { id: existing.id }, data });
    });
    res.json(row);
  }),
);

router.delete(
  '/special-texts/:id',
  handle(async (req, res) => {
    const existing = await prisma.confirmationSpecialText.findUnique({
      where: { id: req.params.id },
      select: { isDefault: true },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (existing.isDefault) return res.status(409).json({ error: 'default_undeletable' });
    await prisma.confirmationSpecialText.delete({ where: { id: req.params.id } });
    res.status(204).end();
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
    // Delivery comes from THE canonical reader — the archive must never invent
    // its own reading of the queue row.
    const delivery = await resolveDelivery(snap.scheduledEmailId);
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
