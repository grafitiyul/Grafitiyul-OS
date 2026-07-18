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
import { processReservationSession } from '../reservations/processor.js';
import { buildReservationPdf } from '../reservations/pdf.js';
import { createRateLimiter } from '../reservations/rateLimit.js';
import { financeContactDisplay } from '../organizations/financeContact.js';
import { emitTimelineEvent, systemOrigin } from '../timeline/events.js';

const router = Router();

// Abuse guards (hardening slice). Reads are generous (form loads, status
// polling every 5s, PDF); submits are tight — a real agent never submits 20
// sessions in an hour. Keyed by token (the capability) + IP.
const readLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 600 });
const submitLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 20 });

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
}

// The organization's CURRENT finance contact as displayed — resolved from the
// canonical Contact (designation) with the service-owned mirror as fallback
// for not-yet-migrated rows. Null when the org has none.
async function orgFinanceDisplay(organizationId) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      financeContactId: true,
      financeContactName: true,
      financeEmail: true,
      financePhone: true,
      financeContact: {
        select: {
          firstNameHe: true,
          lastNameHe: true,
          firstNameEn: true,
          lastNameEn: true,
          phones: { where: { isPrimary: true }, take: 1, select: { value: true } },
          emails: { where: { isPrimary: true }, take: 1, select: { value: true } },
        },
      },
    },
  });
  return financeContactDisplay(org);
}

function guard(limiter) {
  return (req, res, next) => {
    if (!limiter(`${req.params.token}:${clientIp(req)}`)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    next();
  };
}

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
  guard(readLimiter),
  handle(async (req, res) => {
    const r = await resolveReservationLink(req.params.token);
    if (r.error) return sendResolveError(res, r.error);
    const catalog = await bookableCatalog();
    // Read-only identity for the "איש קשר להזמנה" card — the agent is known
    // from the token; the form never asks for (or accepts) identity input.
    const channels = await prisma.contact.findUnique({
      where: { id: r.contact.id },
      select: {
        phones: { where: { isPrimary: true }, take: 1, select: { value: true } },
        emails: { where: { isPrimary: true }, take: 1, select: { value: true } },
      },
    });
    res.json({
      agent: {
        // Bilingual display names — the form greets the agent in its language.
        nameHe: `${r.contact.firstNameHe || ''} ${r.contact.lastNameHe || ''}`.trim(),
        nameEn: `${r.contact.firstNameEn || ''} ${r.contact.lastNameEn || ''}`.trim(),
        phone: channels?.phones?.[0]?.value || null,
        email: channels?.emails?.[0]?.value || null,
      },
      organization: {
        name: r.organization.name,
        // The CURRENT finance contact (canonical Contact, mirror fallback) —
        // read-only display; the public form can only NOMINATE a replacement.
        financeContact: await orgFinanceDisplay(r.organization.id),
      },
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
  guard(submitLimiter),
  handle(async (req, res) => {
    const r = await resolveReservationLink(req.params.token);
    if (r.error) return sendResolveError(res, r.error);

    const catalog = await bookableCatalog();
    const validated = validateSubmission(req.body || {}, catalog, {
      orgHasFinance: !!(r.organization.financeContactId || r.organization.financeEmail),
    });
    if (validated.problems) {
      return res.status(422).json({ error: 'validation', problems: validated.problems });
    }

    // Frozen audit snapshot of what was submitted — WITHOUT the signature
    // image (bytes live in their own column; the snapshot stays light). The
    // invoice block freezes the RESOLVED view: which recipients were selected
    // and the finance details as SHOWN at submission time (entered values in
    // the new-contact mode, the saved org contact in read-only mode) —
    // historical evidence; the editable truth stays on the Organization.
    const { signature, ...rest } = req.body || {};
    // Saved-contact mode freezes the details as DISPLAYED (canonical
    // contact); nomination mode freezes the entered values. persistSubmission
    // enriches with the resolved financeContactId + financeMode.
    const savedFinance = validated.invoice.nominating ? null : await orgFinanceDisplay(r.organization.id);
    const payloadSnapshot = {
      ...rest,
      invoice: {
        toOrganizer: validated.invoice.toOrganizer,
        toFinance: validated.invoice.toFinance,
        replaceFinance: validated.invoice.replaceFinance,
        financeName: validated.invoice.nominating ? validated.invoice.financeName : savedFinance?.name ?? null,
        financeEmail: validated.invoice.nominating ? validated.invoice.financeEmail : savedFinance?.email ?? null,
        financePhone: validated.invoice.nominating ? validated.invoice.financePhone : savedFinance?.phone ?? null,
      },
      signature: { signerName: validated.session.signerName, method: validated.session.signatureMethod },
    };

    const { session, created } = await persistSubmission({
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

    if (created) {
      // Intake history — best-effort, never blocks the submission response.
      const groupCount = session.groups?.length || 0;
      const participants = (session.groups || []).reduce((a, g) => a + (g.participants || 0), 0);
      await Promise.allSettled([
        emitTimelineEvent(null, {
          subjectType: 'reservation_session',
          subjectId: session.id,
          kind: 'note',
          body: `<p>הבקשה הוגשה בטופס הסוכנים — ${groupCount} קבוצות, ${participants} משתתפים.</p>`,
          data: { event: 'reservation_submitted', groupCount, participants },
          origin: systemOrigin(),
        }),
        emitTimelineEvent(null, {
          subjectType: 'contact',
          subjectId: r.contact.id,
          kind: 'note',
          body: `<p>הוגשה בקשת הזמנה #${session.sessionNo} — ${groupCount} קבוצות, ${participants} משתתפים.</p>`,
          data: { event: 'reservation_submitted', reservationSessionId: session.id },
          origin: systemOrigin(),
        }),
      ]);

      // Inline processing attempt (sync-first, async-safety-net): the happy
      // path returns real GOS numbers in THIS response; any failure leaves the
      // session for the sweep worker — the submission itself is already safe.
      try {
        await processReservationSession(session.id);
      } catch (e) {
        console.warn('[reservations] inline processing failed:', e?.message);
      }
    }

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
  guard(readLimiter),
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

// Official reservation copy (BINDING #7/#8) — rendered through the canonical
// Documents engine from the FROZEN session data, so a re-download always
// regenerates the identical document. Token + ownership gated like the status
// endpoint; the response is a direct attachment download.
router.get(
  '/reservations/:token/session/:submissionKey/pdf',
  guard(readLimiter),
  handle(async (req, res) => {
    const r = await resolveReservationLink(req.params.token);
    if (r.error) return sendResolveError(res, r.error);
    const session = await prisma.reservationSession.findUnique({
      where: { submissionKey: req.params.submissionKey },
      include: {
        groups: {
          orderBy: { sortOrder: 'asc' },
          include: { createdDeal: { select: { orderNo: true } } },
        },
        contact: { select: { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true } },
        organization: { select: { name: true } },
      },
    });
    if (!session || session.contactId !== r.contact.id) {
      return res.status(404).json({ error: 'not_found' });
    }
    const agentName =
      session.language === 'en'
        ? `${session.contact?.firstNameEn || ''} ${session.contact?.lastNameEn || ''}`.trim() ||
          `${session.contact?.firstNameHe || ''} ${session.contact?.lastNameHe || ''}`.trim()
        : `${session.contact?.firstNameHe || ''} ${session.contact?.lastNameHe || ''}`.trim();
    const pdf = await buildReservationPdf({
      ...session,
      agentName,
      organizationName: session.organization?.name || '',
      groups: session.groups.map((g) => ({
        ...g,
        createdDealOrderNo: g.createdDeal?.orderNo || null,
      })),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('Content-Disposition', `attachment; filename="reservation-${session.sessionNo}.pdf"`);
    res.send(pdf);
  }),
);

export default router;
