import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Contact CRUD + phones + emails + organization memberships. Reference data for
// the future Deals/Activities workflow.
//
// Names are bilingual and REQUIRED (He + En). Full names are DERIVED here (and
// in the UI), never stored as duplicate columns. A contact may belong to zero,
// one, or many organizations (ContactOrganization), optionally to a unit.

const router = Router();

// Derive the convenience full-name fields without persisting them.
function withFullNames(contact) {
  if (!contact) return contact;
  return {
    ...contact,
    fullNameHe: `${contact.firstNameHe || ''} ${contact.lastNameHe || ''}`.trim(),
    fullNameEn: `${contact.firstNameEn || ''} ${contact.lastNameEn || ''}`.trim(),
  };
}

const CONTACT_INCLUDE = {
  phones: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
  emails: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
  orgLinks: {
    include: {
      organization: { select: { id: true, name: true } },
      organizationUnit: { select: { id: true, name: true } },
    },
  },
};

// ---------- Contacts ----------

router.get(
  '/',
  handle(async (_req, res) => {
    const contacts = await prisma.contact.findMany({
      orderBy: [{ lastNameHe: 'asc' }, { firstNameHe: 'asc' }],
      include: {
        phones: { where: { isPrimary: true }, take: 1 },
        emails: { where: { isPrimary: true }, take: 1 },
        _count: { select: { orgLinks: true } },
      },
    });
    res.json(contacts.map(withFullNames));
  }),
);

router.get(
  '/:id',
  handle(async (req, res) => {
    const contact = await prisma.contact.findUnique({
      where: { id: req.params.id },
      include: CONTACT_INCLUDE,
    });
    if (!contact) return res.status(404).json({ error: 'not_found' });
    res.json(withFullNames(contact));
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const { firstNameHe, lastNameHe, firstNameEn, lastNameEn, notes } =
      req.body || {};
    const names = {
      firstNameHe: String(firstNameHe || '').trim(),
      lastNameHe: String(lastNameHe || '').trim(),
      firstNameEn: String(firstNameEn || '').trim(),
      lastNameEn: String(lastNameEn || '').trim(),
    };
    if (
      !names.firstNameHe ||
      !names.lastNameHe ||
      !names.firstNameEn ||
      !names.lastNameEn
    ) {
      return res.status(400).json({ error: 'all_names_required' });
    }
    const contact = await prisma.contact.create({
      data: { ...names, notes: notes ? String(notes).trim() : null },
      include: CONTACT_INCLUDE,
    });
    res.status(201).json(withFullNames(contact));
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const body = req.body || {};
    const data = {};
    for (const f of ['firstNameHe', 'lastNameHe', 'firstNameEn', 'lastNameEn']) {
      if (body[f] !== undefined) {
        const v = String(body[f]).trim();
        if (!v) return res.status(400).json({ error: `${f}_required` });
        data[f] = v;
      }
    }
    if (body.notes !== undefined)
      data.notes = body.notes ? String(body.notes).trim() : null;
    const contact = await prisma.contact.update({
      where: { id: req.params.id },
      data,
      include: CONTACT_INCLUDE,
    });
    res.json(withFullNames(contact));
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    // Phones, emails and org links cascade. Organizations are NOT deleted.
    await prisma.contact.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ---------- Phones ----------
// "One primary" is enforced here: setting a phone primary clears the flag on the
// contact's other phones in the same transaction. The first phone added becomes
// primary automatically.

async function reloadContact(id) {
  const contact = await prisma.contact.findUnique({
    where: { id },
    include: CONTACT_INCLUDE,
  });
  return withFullNames(contact);
}

router.post(
  '/:id/phones',
  handle(async (req, res) => {
    const value = String(req.body?.value || '').trim();
    if (!value) return res.status(400).json({ error: 'value_required' });
    const existing = await prisma.contactPhone.count({
      where: { contactId: req.params.id },
    });
    const makePrimary = !!req.body?.isPrimary || existing === 0;
    await prisma.$transaction(async (tx) => {
      if (makePrimary) {
        await tx.contactPhone.updateMany({
          where: { contactId: req.params.id, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      await tx.contactPhone.create({
        data: {
          contactId: req.params.id,
          value,
          label: req.body?.label ? String(req.body.label).trim() : null,
          isPrimary: makePrimary,
          sortOrder: Number(req.body?.sortOrder) || existing,
        },
      });
    });
    res.status(201).json(await reloadContact(req.params.id));
  }),
);

router.put(
  '/phones/:phoneId',
  handle(async (req, res) => {
    const phone = await prisma.contactPhone.findUnique({
      where: { id: req.params.phoneId },
    });
    if (!phone) return res.status(404).json({ error: 'not_found' });
    const data = {};
    if (req.body?.value !== undefined) {
      const v = String(req.body.value).trim();
      if (!v) return res.status(400).json({ error: 'value_required' });
      data.value = v;
    }
    if (req.body?.label !== undefined)
      data.label = req.body.label ? String(req.body.label).trim() : null;
    await prisma.$transaction(async (tx) => {
      if (req.body?.isPrimary === true) {
        await tx.contactPhone.updateMany({
          where: { contactId: phone.contactId, isPrimary: true },
          data: { isPrimary: false },
        });
        data.isPrimary = true;
      }
      await tx.contactPhone.update({ where: { id: phone.id }, data });
    });
    res.json(await reloadContact(phone.contactId));
  }),
);

router.delete(
  '/phones/:phoneId',
  handle(async (req, res) => {
    const phone = await prisma.contactPhone.findUnique({
      where: { id: req.params.phoneId },
    });
    if (!phone) return res.status(404).json({ error: 'not_found' });
    await prisma.contactPhone.delete({ where: { id: phone.id } });
    res.json(await reloadContact(phone.contactId));
  }),
);

// ---------- Emails (same "one primary" semantics) ----------

router.post(
  '/:id/emails',
  handle(async (req, res) => {
    const value = String(req.body?.value || '').trim();
    if (!value) return res.status(400).json({ error: 'value_required' });
    const existing = await prisma.contactEmail.count({
      where: { contactId: req.params.id },
    });
    const makePrimary = !!req.body?.isPrimary || existing === 0;
    await prisma.$transaction(async (tx) => {
      if (makePrimary) {
        await tx.contactEmail.updateMany({
          where: { contactId: req.params.id, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      await tx.contactEmail.create({
        data: {
          contactId: req.params.id,
          value,
          label: req.body?.label ? String(req.body.label).trim() : null,
          isPrimary: makePrimary,
          sortOrder: Number(req.body?.sortOrder) || existing,
        },
      });
    });
    res.status(201).json(await reloadContact(req.params.id));
  }),
);

router.put(
  '/emails/:emailId',
  handle(async (req, res) => {
    const email = await prisma.contactEmail.findUnique({
      where: { id: req.params.emailId },
    });
    if (!email) return res.status(404).json({ error: 'not_found' });
    const data = {};
    if (req.body?.value !== undefined) {
      const v = String(req.body.value).trim();
      if (!v) return res.status(400).json({ error: 'value_required' });
      data.value = v;
    }
    if (req.body?.label !== undefined)
      data.label = req.body.label ? String(req.body.label).trim() : null;
    await prisma.$transaction(async (tx) => {
      if (req.body?.isPrimary === true) {
        await tx.contactEmail.updateMany({
          where: { contactId: email.contactId, isPrimary: true },
          data: { isPrimary: false },
        });
        data.isPrimary = true;
      }
      await tx.contactEmail.update({ where: { id: email.id }, data });
    });
    res.json(await reloadContact(email.contactId));
  }),
);

router.delete(
  '/emails/:emailId',
  handle(async (req, res) => {
    const email = await prisma.contactEmail.findUnique({
      where: { id: req.params.emailId },
    });
    if (!email) return res.status(404).json({ error: 'not_found' });
    await prisma.contactEmail.delete({ where: { id: email.id } });
    res.json(await reloadContact(email.contactId));
  }),
);

// ---------- Organization memberships ----------

router.post(
  '/:id/organizations',
  handle(async (req, res) => {
    const organizationId = String(req.body?.organizationId || '').trim();
    if (!organizationId)
      return res.status(400).json({ error: 'organizationId_required' });
    try {
      await prisma.contactOrganization.create({
        data: {
          contactId: req.params.id,
          organizationId,
          organizationUnitId: req.body?.organizationUnitId || null,
          role: req.body?.role ? String(req.body.role).trim() : null,
          isPrimary: !!req.body?.isPrimary,
        },
      });
    } catch (e) {
      if (e.code === 'P2002')
        return res.status(409).json({ error: 'membership_exists' });
      throw e;
    }
    res.status(201).json(await reloadContact(req.params.id));
  }),
);

router.put(
  '/organizations/:linkId',
  handle(async (req, res) => {
    const link = await prisma.contactOrganization.findUnique({
      where: { id: req.params.linkId },
    });
    if (!link) return res.status(404).json({ error: 'not_found' });
    const data = {};
    if (req.body?.organizationUnitId !== undefined)
      data.organizationUnitId = req.body.organizationUnitId || null;
    if (req.body?.role !== undefined)
      data.role = req.body.role ? String(req.body.role).trim() : null;
    if (req.body?.isPrimary !== undefined) data.isPrimary = !!req.body.isPrimary;
    await prisma.contactOrganization.update({ where: { id: link.id }, data });
    res.json(await reloadContact(link.contactId));
  }),
);

router.delete(
  '/organizations/:linkId',
  handle(async (req, res) => {
    const link = await prisma.contactOrganization.findUnique({
      where: { id: req.params.linkId },
    });
    if (!link) return res.status(404).json({ error: 'not_found' });
    await prisma.contactOrganization.delete({ where: { id: link.id } });
    res.json(await reloadContact(link.contactId));
  }),
);

export default router;
