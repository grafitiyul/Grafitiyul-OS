// PUBLIC (unauthenticated) travel-agent reservation form — token-gated, same
// philosophy as the public questionnaire: the high-entropy
// AgentReservationLink.token is the whole capability; no id enumeration, no
// admin data, `/api` is already no-store. The subject (agent Contact, agency
// Organization) ALWAYS comes from the link row — never from request input.
// Eligibility is re-checked on EVERY request (BINDING #3): a contact detached
// from a qualifying agency gets a safe 403.
//
// Slice 2: intake only — persisting a ReservationSession IS the submission.
// Deal numbers appear on the status endpoint once Slice 3's processor runs.

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { resolveReservationLink } from '../reservations/links.js';
import {
  bookableCatalog,
  validateSubmission,
  persistSubmission,
  REQUIRED_CONFIRMATIONS,
  MAX_GROUPS,
} from '../reservations/intake.js';

const router = Router();

function sendResolveError(res, error) {
  if (error === 'not_found') return res.status(404).json({ error: 'not_found' });
  // disabled / not_eligible are deliberate, debuggable lockouts (403) — the
  // form shows a calm bilingual "link is no longer active" message.
  return res.status(403).json({ error });
}

// Session state as the PUBLIC form may see it: group order + status + the Deal
// order number once created. No admin URLs, no internal errors (BINDING #7).
function publicSessionDto(session) {
  return {
    sessionNo: session.sessionNo,
    status: session.status,
    submittedAt: session.submittedAt,
    groups: (session.groups || []).map((g) => ({
      id: g.id,
      sortOrder: g.sortOrder,
      groupName: g.groupName,
      locationLabel: g.locationLabel,
      productLabel: g.productLabel,
      tourDate: g.tourDate,
      tourTime: g.tourTime,
      participants: g.participants,
      status: g.status === 'processed' ? 'processed' : 'received',
      orderNo: g.createdDeal?.orderNo || null,
    })),
  };
}

const SESSION_INCLUDE = {
  groups: {
    orderBy: { sortOrder: 'asc' },
    include: { createdDeal: { select: { orderNo: true } } },
  },
};

// Bootstrap: who the agent is + the bookable catalog + form policy.
router.get(
  '/reservations/:token',
  handle(async (req, res) => {
    const r = await resolveReservationLink(req.params.token);
    if (r.error) return sendResolveError(res, r.error);
    const catalog = await bookableCatalog();
    res.json({
      agent: {
        // Bilingual display names — the form greets the agent in its language.
        nameHe: `${r.contact.firstNameHe || ''} ${r.contact.lastNameHe || ''}`.trim(),
        nameEn: `${r.contact.firstNameEn || ''} ${r.contact.lastNameEn || ''}`.trim(),
      },
      organization: { name: r.organization.name },
      defaultLanguage: r.link.defaultLanguage,
      maxGroups: MAX_GROUPS,
      requiredConfirmations: REQUIRED_CONFIRMATIONS.map((c) => c.key),
      catalog,
    });
  }),
);

// Submit — the form's ONE write. Validation problems render inline (422,
// stable codes). Idempotent by client-minted submissionKey.
router.post(
  '/reservations/:token/submit',
  handle(async (req, res) => {
    const r = await resolveReservationLink(req.params.token);
    if (r.error) return sendResolveError(res, r.error);

    const catalog = await bookableCatalog();
    const validated = validateSubmission(req.body || {}, catalog);
    if (validated.problems) {
      return res.status(422).json({ error: 'validation', problems: validated.problems });
    }

    // Frozen audit snapshot of what was submitted — WITHOUT the signature
    // image (bytes live in their own column; the snapshot stays light).
    const { signature, ...rest } = req.body || {};
    const payloadSnapshot = {
      ...rest,
      signature: { signerName: validated.session.signerName, method: validated.session.signatureMethod },
    };

    const { session } = await persistSubmission({
      link: r.link,
      contact: r.contact,
      organization: r.organization,
      validated,
      payloadSnapshot,
      clientMeta: {
        ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      },
    });

    // Re-read with Deal numbers included — a very late duplicate retry of an
    // already-processed session must return its final numbers.
    const full = await prisma.reservationSession.findUnique({
      where: { id: session.id },
      include: SESSION_INCLUDE,
    });
    res.status(201).json({ session: publicSessionDto(full || session) });
  }),
);

// Status polling for the Thank-You page: entries upgrade from "received" to a
// Deal orderNo as Slice 3 processes them. Keyed by submissionKey so a page
// refresh after submit can recover its result without any admin data.
router.get(
  '/reservations/:token/session/:submissionKey',
  handle(async (req, res) => {
    const r = await resolveReservationLink(req.params.token);
    if (r.error) return sendResolveError(res, r.error);
    const session = await prisma.reservationSession.findUnique({
      where: { submissionKey: req.params.submissionKey },
      include: SESSION_INCLUDE,
    });
    // The session must belong to THIS link's contact — a foreign key from
    // another agent reads as not_found.
    if (!session || session.contactId !== r.contact.id) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json({ session: publicSessionDto(session) });
  }),
);

export default router;
