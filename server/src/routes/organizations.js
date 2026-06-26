import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Organization + Organization Unit CRUD. Reference data for the future
// Deals/Activities workflow — NOT a daily working screen.
//
// Model: Organization is the parent; OrganizationUnit (department/division)
// children belong to it; an Organization may have ZERO units. Finance fields
// exist on both to support the future Deal→Unit→Organization→Type resolution
// (not implemented in Phase 1).

const router = Router();

// Whitelisted optional finance/identity fields shared by Organization and Unit.
const FINANCE_FIELDS = [
  'taxId',
  'address',
  'financeContactName',
  'financePhone',
  'financeEmail',
];

function pickFinance(body, data) {
  for (const f of FINANCE_FIELDS) {
    if (body[f] !== undefined) data[f] = body[f] ? String(body[f]).trim() : null;
  }
}

// ---------- Organizations ----------

router.get(
  '/',
  handle(async (_req, res) => {
    const orgs = await prisma.organization.findMany({
      orderBy: { name: 'asc' },
      include: {
        organizationType: { select: { id: true, label: true } },
        _count: { select: { units: true, contactLinks: true } },
      },
    });
    res.json(orgs);
  }),
);

router.get(
  '/:id',
  handle(async (req, res) => {
    const org = await prisma.organization.findUnique({
      where: { id: req.params.id },
      include: {
        organizationType: true,
        units: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
        contactLinks: {
          include: {
            contact: {
              select: {
                id: true,
                firstNameHe: true,
                lastNameHe: true,
                firstNameEn: true,
                lastNameEn: true,
              },
            },
            organizationUnit: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!org) return res.status(404).json({ error: 'not_found' });
    res.json(org);
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const { name, organizationTypeId, notes } = req.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName) return res.status(400).json({ error: 'name_required' });
    const data = {
      name: cleanName,
      organizationTypeId: organizationTypeId || null,
      notes: notes ? String(notes).trim() : null,
    };
    pickFinance(req.body || {}, data);
    const org = await prisma.organization.create({ data });
    res.status(201).json(org);
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const body = req.body || {};
    const data = {};
    if (body.name !== undefined) {
      const cleanName = String(body.name).trim();
      if (!cleanName) return res.status(400).json({ error: 'name_required' });
      data.name = cleanName;
    }
    if (body.organizationTypeId !== undefined)
      data.organizationTypeId = body.organizationTypeId || null;
    if (body.notes !== undefined)
      data.notes = body.notes ? String(body.notes).trim() : null;
    pickFinance(body, data);
    const org = await prisma.organization.update({
      where: { id: req.params.id },
      data,
    });
    res.json(org);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    // Units cascade (OrganizationUnit.onDelete:Cascade); ContactOrganization
    // links to this org also cascade. Contacts themselves are NOT deleted.
    await prisma.organization.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ---------- Organization Units ----------

router.post(
  '/:id/units',
  handle(async (req, res) => {
    const org = await prisma.organization.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!org) return res.status(404).json({ error: 'organization_not_found' });
    const cleanName = String(req.body?.name || '').trim();
    if (!cleanName) return res.status(400).json({ error: 'name_required' });
    const data = {
      organizationId: org.id,
      name: cleanName,
      sortOrder: Number(req.body?.sortOrder) || 0,
    };
    pickFinance(req.body || {}, data);
    const unit = await prisma.organizationUnit.create({ data });
    res.status(201).json(unit);
  }),
);

router.put(
  '/units/:unitId',
  handle(async (req, res) => {
    const body = req.body || {};
    const data = {};
    if (body.name !== undefined) {
      const cleanName = String(body.name).trim();
      if (!cleanName) return res.status(400).json({ error: 'name_required' });
      data.name = cleanName;
    }
    if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder) || 0;
    pickFinance(body, data);
    const unit = await prisma.organizationUnit.update({
      where: { id: req.params.unitId },
      data,
    });
    res.json(unit);
  }),
);

router.delete(
  '/units/:unitId',
  handle(async (req, res) => {
    // ContactOrganization.organizationUnitId is onDelete:SetNull — deleting a
    // unit detaches its contact links to the org level rather than removing them.
    await prisma.organizationUnit.delete({ where: { id: req.params.unitId } });
    res.status(204).end();
  }),
);

export default router;
