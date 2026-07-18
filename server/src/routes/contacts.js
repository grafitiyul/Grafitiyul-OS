import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { numericIdResolver } from './numericIdParam.js';
import { parseListQuery, containsI, digits } from './listPagination.js';

// Contact CRUD + phones + emails + organization memberships. Reference data for
// the future Deals/Activities workflow.
//
// Names are bilingual and REQUIRED (He + En). Full names are DERIVED here (and
// in the UI), never stored as duplicate columns. A contact may belong to zero,
// one, or many organizations (ContactOrganization), optionally to a unit.

const router = Router();

// "מספר איש קשר" URL support — /:id routes accept either the cuid or the
// public numeric contactNo (deals.js orderNo pattern; see numericIdParam.js).
router.param(
  'id',
  numericIdResolver((contactNo) =>
    prisma.contact.findUnique({ where: { contactNo }, select: { id: true } }),
  ),
);

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
  // Pure manual order (sortOrder) so a drag-reorder in the UI is WYSIWYG. The
  // primary phone/email is marked by a badge, not by position; the deals/list
  // endpoints still pick the primary via a `where isPrimary` filter, unaffected.
  phones: { orderBy: { sortOrder: 'asc' } },
  emails: { orderBy: { sortOrder: 'asc' } },
  orgLinks: {
    include: {
      organization: { select: { id: true, orgNo: true, name: true } },
      organizationUnit: { select: { id: true, name: true } },
    },
  },
};

// ---------- Contacts ----------

router.get(
  '/',
  handle(async (req, res) => {
    // The relations the list table reads (primary phone/email, org names, counts).
    const listRelations = {
      phones: { where: { isPrimary: true }, take: 1 },
      emails: { where: { isPrimary: true }, take: 1 },
      orgLinks: { orderBy: { isPrimary: 'desc' }, select: { isPrimary: true, organization: { select: { id: true, name: true } } } },
      _count: { select: { orgLinks: true, dealContacts: true } },
    };
    const orderBy = [{ lastNameHe: 'asc' }, { firstNameHe: 'asc' }];

    const { paginated, page, pageSize, skip, take, search } = parseListQuery(req.query);
    if (paginated) {
      const where = {};
      if (search) {
        // Token-AND across name fields (so "דוד כהן" matches first+last), each
        // token also allowed to hit phone / email / org / contact number.
        const tokens = search.split(/\s+/).filter(Boolean);
        where.AND = tokens.map((tok) => ({
          OR: [
            { firstNameHe: containsI(tok) }, { lastNameHe: containsI(tok) },
            { firstNameEn: containsI(tok) }, { lastNameEn: containsI(tok) },
            { phones: { some: { value: { contains: digits(tok) } } } },
            { emails: { some: { value: containsI(tok) } } },
            { orgLinks: { some: { organization: { name: containsI(tok) } } } },
            ...(/^\d+$/.test(tok) ? [{ contactNo: Number(tok) }] : []),
          ],
        }));
      }
      const [total, rows] = await Promise.all([
        prisma.contact.count({ where }),
        prisma.contact.findMany({
          where, orderBy, skip, take,
          select: {
            id: true, contactNo: true, firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true,
            createdAt: true, updatedAt: true, ...listRelations,
          },
        }),
      ]);
      return res.json({ rows: rows.map(withFullNames), total, page, pageSize });
    }

    // Legacy full-array path (pickers / cross-refs). Unchanged shape.
    const contacts = await prisma.contact.findMany({ orderBy, include: listRelations });
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
    // A contact needs at least ONE first name, in EITHER language (Hebrew or
    // English). Last names and the other-language names are all optional; stored
    // columns stay non-null (empty ''). This keeps quick capture (name + phone)
    // fast for both Hebrew and international contacts.
    if (!names.firstNameHe && !names.firstNameEn) {
      return res.status(400).json({ error: 'first_name_required' });
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
    const existing = await prisma.contact.findUnique({
      where: { id: req.params.id },
      select: { firstNameHe: true, firstNameEn: true },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const data = {};
    for (const f of ['firstNameHe', 'lastNameHe', 'firstNameEn', 'lastNameEn']) {
      if (body[f] !== undefined) data[f] = String(body[f]).trim();
    }
    // A contact needs at least ONE first name, in EITHER language. Last names and
    // the other-language name are optional (may be ''). Same rule as create — the
    // edit path must NOT require the English name when Hebrew exists (or vice
    // versa).
    const effFirstHe = data.firstNameHe !== undefined ? data.firstNameHe : existing.firstNameHe;
    const effFirstEn = data.firstNameEn !== undefined ? data.firstNameEn : existing.firstNameEn;
    if (!effFirstHe && !effFirstEn) {
      return res.status(400).json({ error: 'first_name_required' });
    }

    if (body.notes !== undefined)
      data.notes = body.notes ? String(body.notes).trim() : null;
    if (body.communicationLanguage !== undefined) {
      const v = body.communicationLanguage ? String(body.communicationLanguage).trim() : null;
      if (v && !['he', 'en'].includes(v)) return res.status(400).json({ error: 'invalid_communication_language' });
      data.communicationLanguage = v;
    }
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

// Manual reorder — `ids` is the phone id list in the desired order. Reindexes
// sortOrder 0..n, scoped to the contact (same pattern as the catalog reorders).
router.put(
  '/:id/phones/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x) => typeof x === 'string')
      : [];
    if (ids.length) {
      await prisma.$transaction(
        ids.map((pid, i) =>
          prisma.contactPhone.updateMany({
            where: { id: pid, contactId: req.params.id },
            data: { sortOrder: i },
          }),
        ),
      );
    }
    res.json(await reloadContact(req.params.id));
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

router.put(
  '/:id/emails/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x) => typeof x === 'string')
      : [];
    if (ids.length) {
      await prisma.$transaction(
        ids.map((eid, i) =>
          prisma.contactEmail.updateMany({
            where: { id: eid, contactId: req.params.id },
            data: { sortOrder: i },
          }),
        ),
      );
    }
    res.json(await reloadContact(req.params.id));
  }),
);

// ---------- Organization memberships ----------

router.post(
  '/:id/organizations',
  handle(async (req, res) => {
    const organizationId = String(req.body?.organizationId || '').trim();
    if (!organizationId)
      return res.status(400).json({ error: 'organizationId_required' });
    // A unit must belong to the linked organization — a stale/foreign unit id
    // is rejected, never silently attached.
    const organizationUnitId = req.body?.organizationUnitId || null;
    if (organizationUnitId) {
      const unit = await prisma.organizationUnit.findUnique({
        where: { id: organizationUnitId },
        select: { organizationId: true },
      });
      if (!unit || unit.organizationId !== organizationId) {
        return res.status(422).json({ error: 'unit_not_in_organization' });
      }
    }
    try {
      await prisma.contactOrganization.create({
        data: {
          contactId: req.params.id,
          organizationId,
          organizationUnitId,
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
    if (req.body?.organizationUnitId !== undefined) {
      const unitId = req.body.organizationUnitId || null;
      if (unitId) {
        const unit = await prisma.organizationUnit.findUnique({
          where: { id: unitId },
          select: { organizationId: true },
        });
        if (!unit || unit.organizationId !== link.organizationId) {
          return res.status(422).json({ error: 'unit_not_in_organization' });
        }
      }
      data.organizationUnitId = unitId;
    }
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
