// Travel Agency Reservations — admin management of the permanent per-agent
// reservation link, surfaced on the Contact page. Mounted under /api/contacts
// (dealTasks-on-/api/deals pattern), admin-auth enforced at mount.
//
//   GET    /:contactId/reservation-link          state + live eligibility
//   POST   /:contactId/reservation-link          mint (idempotent)
//   POST   /:contactId/reservation-link/rotate   revoke + mint new token
//   POST   /:contactId/reservation-link/revoke   revoke without replacement
//   PUT    /:contactId/reservation-link          isEnabled / label / defaultLanguage
//
// The public form route itself is Slice 2 — this file only manages links.

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { resolvePublicOrigin } from '../dealPayment.js';
import {
  ELIGIBILITY_INCLUDE,
  eligibleAgencyOrg,
  activeLinkForContact,
  mintLinkForContact,
  rotateLinkForContact,
  revokeLinkForContact,
} from '../reservations/links.js';

const router = Router();

function linkDto(req, link) {
  if (!link) return null;
  return {
    id: link.id,
    // Admin-facing: the full URL is shown/copied on the Contact page. Only the
    // token is stored; the origin comes from PUBLIC_ORIGIN at request time.
    url: `${resolvePublicOrigin(req)}/r/${link.token}`,
    status: link.status,
    isEnabled: link.isEnabled,
    label: link.label,
    defaultLanguage: link.defaultLanguage,
    lastUsedAt: link.lastUsedAt,
    createdAt: link.createdAt,
  };
}

// Live eligibility for the contact + the current active link (if any).
async function contactState(req, contactId) {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: ELIGIBILITY_INCLUDE,
  });
  if (!contact) return null;
  const organization = eligibleAgencyOrg(contact);
  const link = await activeLinkForContact(contactId);
  return {
    eligible: !!organization,
    organization: organization
      ? {
          id: organization.id,
          name: organization.name,
          typeLabel: organization.organizationType?.label || null,
        }
      : null,
    link: linkDto(req, link),
  };
}

router.get(
  '/:contactId/reservation-link',
  handle(async (req, res) => {
    const state = await contactState(req, req.params.contactId);
    if (!state) return res.status(404).json({ error: 'not_found' });
    res.json(state);
  }),
);

router.post(
  '/:contactId/reservation-link',
  handle(async (req, res) => {
    const contactId = req.params.contactId;
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      include: ELIGIBILITY_INCLUDE,
    });
    if (!contact) return res.status(404).json({ error: 'not_found' });
    // Minting requires CURRENT eligibility — an admin cannot hand a
    // reservation link to a contact outside a qualifying agency.
    if (!eligibleAgencyOrg(contact)) {
      return res.status(422).json({ error: 'not_eligible' });
    }
    const { defaultLanguage, label } = req.body || {};
    const { link, created } = await mintLinkForContact({
      contactId,
      createdById: req.adminAuth?.userId || null,
      label: label ? String(label).trim() : null,
      defaultLanguage,
    });
    res.status(created ? 201 : 200).json({ link: linkDto(req, link), created });
  }),
);

router.post(
  '/:contactId/reservation-link/rotate',
  handle(async (req, res) => {
    const r = await rotateLinkForContact({
      contactId: req.params.contactId,
      createdById: req.adminAuth?.userId || null,
    });
    if (r.error) return res.status(409).json({ error: r.error });
    res.json({ link: linkDto(req, r.link) });
  }),
);

router.post(
  '/:contactId/reservation-link/revoke',
  handle(async (req, res) => {
    const r = await revokeLinkForContact(req.params.contactId);
    if (r.error) return res.status(409).json({ error: r.error });
    res.json({ ok: true });
  }),
);

router.put(
  '/:contactId/reservation-link',
  handle(async (req, res) => {
    const link = await activeLinkForContact(req.params.contactId);
    if (!link) return res.status(404).json({ error: 'not_found' });
    const { isEnabled, label, defaultLanguage } = req.body || {};
    const data = {};
    if (isEnabled !== undefined) data.isEnabled = !!isEnabled;
    if (label !== undefined) data.label = label ? String(label).trim() : null;
    if (defaultLanguage !== undefined)
      data.defaultLanguage = defaultLanguage === 'en' ? 'en' : 'he';
    const updated = await prisma.agentReservationLink.update({
      where: { id: link.id },
      data,
    });
    res.json({ link: linkDto(req, updated) });
  }),
);

export default router;
