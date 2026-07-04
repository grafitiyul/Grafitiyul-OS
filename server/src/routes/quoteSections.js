import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// CRM settings → Quote Content Sections. Reusable fixed content blocks that a
// future quote template can include. Content only — quote GENERATION is not
// built yet. Each section has a He/En title and He/En rich HTML (from the
// shared RichEditor). Hebrew title is required; everything else is optional.
// Drag-orderable; `active` controls availability without deleting.

const router = Router();

// Rich HTML can be large-ish; the shared editor produces sanitised HTML on
// paste, but we still cap stored length defensively. null clears the field.
const MAX_RICH = 200_000;
function cleanRich(v) {
  if (v === undefined) return undefined;
  if (!v) return null;
  return String(v).slice(0, MAX_RICH);
}

// Which quote SECTION a content row belongs to. This is the link the composer uses
// to render FAQ / Cancellation / Participant-policy blocks. null = unassigned (the
// row exists but appears in no quote section). Unknown values are coerced to null.
const QUOTE_SECTION_CATEGORIES = new Set(['faq', 'cancellation', 'participant_policy']);
function cleanCategory(v) {
  if (v === undefined) return undefined;
  if (!v) return null;
  return QUOTE_SECTION_CATEGORIES.has(String(v)) ? String(v) : null;
}

router.get(
  '/',
  handle(async (_req, res) => {
    const sections = await prisma.quoteSection.findMany({
      orderBy: [{ sortOrder: 'asc' }, { titleHe: 'asc' }],
    });
    res.json(sections);
  }),
);

// Reorder — declared before '/:id'.
router.put(
  '/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x) => typeof x === 'string')
      : [];
    if (!ids.length) return res.json({ ok: true });
    await prisma.$transaction(
      ids.map((id, i) =>
        prisma.quoteSection.update({ where: { id }, data: { sortOrder: i } }),
      ),
    );
    res.json({ ok: true });
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const { titleHe, titleEn, richTextHe, richTextEn, category } = req.body || {};
    const cleanHe = String(titleHe || '').trim();
    if (!cleanHe) return res.status(400).json({ error: 'title_required' });
    const last = await prisma.quoteSection.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const section = await prisma.quoteSection.create({
      data: {
        titleHe: cleanHe,
        titleEn: titleEn ? String(titleEn).trim() : null,
        richTextHe: cleanRich(richTextHe) ?? null,
        richTextEn: cleanRich(richTextEn) ?? null,
        category: cleanCategory(category) ?? null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    res.status(201).json(section);
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const { titleHe, titleEn, richTextHe, richTextEn, active, sortOrder, category } =
      req.body || {};
    const data = {};
    if (titleHe !== undefined) data.titleHe = String(titleHe).trim();
    if (titleEn !== undefined)
      data.titleEn = titleEn ? String(titleEn).trim() : null;
    const rhe = cleanRich(richTextHe);
    if (rhe !== undefined) data.richTextHe = rhe;
    const ren = cleanRich(richTextEn);
    if (ren !== undefined) data.richTextEn = ren;
    if (category !== undefined) data.category = cleanCategory(category);
    if (active !== undefined) data.active = !!active;
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0;
    const section = await prisma.quoteSection.update({
      where: { id: req.params.id },
      data,
    });
    res.json(section);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    await prisma.quoteSection.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
