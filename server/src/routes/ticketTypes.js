import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// CRM settings → Ticket Types. The editable catalog of ticket categories
// (e.g. מבוגר / ילד) that the ticket_types pricing model uses. Adult/Child are
// seed EXAMPLES — never hard-coded in logic. Hebrew name required; English +
// descriptions optional. Drag-orderable; `active` retires a type without
// deleting history. A type referenced by any price rule is DEACTIVATED, not
// hard-deleted (the delete route blocks it). Admin-only.

const router = Router();

const DEFAULTS = [
  { id: 'tickettype_adult', nameHe: 'מבוגר', nameEn: 'Adult' },
  { id: 'tickettype_child', nameHe: 'ילד', nameEn: 'Child' },
];

router.get(
  '/',
  handle(async (_req, res) => {
    if ((await prisma.ticketType.count()) === 0) {
      await prisma.$transaction(
        DEFAULTS.map((d, i) =>
          prisma.ticketType.create({ data: { ...d, sortOrder: i } }),
        ),
      );
    }
    res.json(
      await prisma.ticketType.findMany({
        orderBy: [{ sortOrder: 'asc' }, { nameHe: 'asc' }],
      }),
    );
  }),
);

// Reorder — declared before '/:id' so "reorder" is not captured as an id.
router.put(
  '/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x) => typeof x === 'string')
      : [];
    if (!ids.length) return res.json({ ok: true });
    await prisma.$transaction(
      ids.map((id, i) =>
        prisma.ticketType.update({ where: { id }, data: { sortOrder: i } }),
      ),
    );
    res.json({ ok: true });
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const b = req.body || {};
    const nameHe = String(b.nameHe || '').trim();
    if (!nameHe) return res.status(400).json({ error: 'name_required' });
    const last = await prisma.ticketType.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const created = await prisma.ticketType.create({
      data: {
        nameHe,
        nameEn: b.nameEn ? String(b.nameEn).trim() : null,
        descriptionHe: b.descriptionHe ? String(b.descriptionHe).trim() : null,
        descriptionEn: b.descriptionEn ? String(b.descriptionEn).trim() : null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    res.status(201).json(created);
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const b = req.body || {};
    const data = {};
    if (b.nameHe !== undefined) data.nameHe = String(b.nameHe).trim();
    if (b.nameEn !== undefined) data.nameEn = b.nameEn ? String(b.nameEn).trim() : null;
    if (b.descriptionHe !== undefined) data.descriptionHe = b.descriptionHe ? String(b.descriptionHe).trim() : null;
    if (b.descriptionEn !== undefined) data.descriptionEn = b.descriptionEn ? String(b.descriptionEn).trim() : null;
    if (b.active !== undefined) data.active = !!b.active;
    if (b.sortOrder !== undefined) data.sortOrder = Number(b.sortOrder) || 0;
    const updated = await prisma.ticketType.update({ where: { id: req.params.id }, data });
    res.json(updated);
  }),
);

// Hard delete only when the type is not used by any price rule. Otherwise the
// client is told to deactivate instead (keeps existing card prices intact).
router.delete(
  '/:id',
  handle(async (req, res) => {
    const inUse = await prisma.priceRuleTicketPrice.count({
      where: { ticketTypeId: req.params.id },
    });
    if (inUse > 0) {
      return res.status(409).json({ error: 'ticket_type_in_use', usedBy: inUse });
    }
    await prisma.ticketType.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
