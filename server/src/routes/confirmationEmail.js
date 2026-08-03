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
