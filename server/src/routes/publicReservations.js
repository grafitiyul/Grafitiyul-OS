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
import {
  ensureReservationDocument,
  sendReservationDocument,
  jsonSafe,
} from '../reservations/document.js';
import { resolveAgentPricing } from '../pricing/agentPricing.js';
import { LEGAL_TEXTS, legalTextsFor } from '../reservations/legalTexts.js';
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
    // The canonical summary PDF exists → the download button goes live.
    documentReady: !!session.document,
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
  document: { select: { id: true } },
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
      // Canonical legal wording (both languages — the form toggles live). The
      // form MUST render the acceptance statement from this payload so the text
      // the agent sees is byte-identical to what gets frozen at submit.
      legalTexts: LEGAL_TEXTS,
      catalog,
    });
  }),
);

// Agent pricing preview (Part B) — READ-ONLY. Resolves the Agents-segment
// pricing card for a group's product/variant + date/time/participants and
// returns a structured display model (or the exact business fallback). Uses the
// canonical engine; creates/mutates NOTHING. Token-gated + rate-limited like the
// other reads. One group card per call — each carries its own context.
router.post(
  '/reservations/:token/pricing',
  guard(readLimiter),
  handle(async (req, res) => {
    const r = await resolveReservationLink(req.params.token);
    if (r.error) return sendResolveError(res, r.error);
    const b = req.body || {};
    // The variant must be one the agent catalog actually exposes — reject a
    // foreign/hidden variant rather than pricing it (no id enumeration).
    const catalog = await bookableCatalog();
    const allowed = new Set((catalog.variants || []).map((v) => v.id));
    if (!b.productVariantId || !allowed.has(String(b.productVariantId))) {
      return res.json({ available: false, reason: 'no_variant', fallbackKey: 'agent_price_list', messageHe:
        'החישוב האוטומטי של המחיר לא זמין למוצר זה, המחיר יהיה כפי שכתוב במחירון לסוכנים.' });
    }
    const model = await resolveAgentPricing(prisma, {
      productVariantId: String(b.productVariantId),
      participants: b.participants,
      // "מספר מדריכים" — this card's pricing group count.
      groups: b.groups,
      tourDate: b.tourDate || null,
      tourTime: b.tourTime || null,
      // Drives the data-driven non-standard-language surcharge in the live preview.
      tourLanguage: b.tourLanguage || null,
    });
    res.json(model);
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

    // Freeze the agent pricing the form displayed — the SAME canonical engine
    // the live preview used, resolved once per group at submission time and
    // carried on the snapshot (keyed by group position). This is what the
    // summary document renders forever; later Pricing Card edits can never
    // change it. Best-effort: a pricing hiccup must never block a submission
    // (the document then shows the price-list fallback sentence, exactly like
    // the form would have).
    const pricingByGroup = [];
    for (const g of validated.groups) {
      try {
        pricingByGroup.push(
          jsonSafe(
            await resolveAgentPricing(prisma, {
              productVariantId: g.productVariantId,
              participants: g.participants,
              groups: g.groups,
              tourDate: g.tourDate,
              tourTime: g.tourTime,
              // Freeze the surcharge with the accepted price: the validated group's
              // canonical tour language selects the data-driven language addon.
              tourLanguage: g.tourLanguage,
            }),
          ),
        );
      } catch {
        pricingByGroup.push(null);
      }
    }

    const payloadSnapshot = {
      ...rest,
      pricingByGroup,
      // LEGAL IMMUTABILITY: the exact contractual wording (cancellation
      // statement, disclaimer, invoice-delivery labels) in the submission
      // language, frozen verbatim from the ONE registry the form rendered.
      // The summary PDF renders legal content from THIS block only — later
      // registry edits can never reword an already-submitted reservation.
      legal: legalTextsFor(validated.session.language),
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

// The canonical reservation-summary document (BINDING #7/#8) — ONE immutable
// PDF per submission, generated after processing completes and stored on the
// session. Every download (and refresh, and retry) serves the SAME stored
// bytes; when generation hasn't happened yet this endpoint lazily ensures it
// (idempotent — the unique sessionId makes duplicates impossible). Token +
// ownership gated like the status endpoint.
router.get(
  '/reservations/:token/session/:submissionKey/pdf',
  guard(readLimiter),
  handle(async (req, res) => {
    const r = await resolveReservationLink(req.params.token);
    if (r.error) return sendResolveError(res, r.error);
    const session = await prisma.reservationSession.findUnique({
      where: { submissionKey: req.params.submissionKey },
      select: { id: true, contactId: true, status: true },
    });
    if (!session || session.contactId !== r.contact.id) {
      return res.status(404).json({ error: 'not_found' });
    }
    let result = await ensureReservationDocument(session.id);
    if (result.error === 'not_ready') {
      // The inline processing attempt may have failed at submit time — give
      // the session one more claim-guarded pass, then re-ensure.
      try {
        await processReservationSession(session.id);
      } catch {
        /* the sweep worker keeps retrying; the document simply isn't ready */
      }
      result = await ensureReservationDocument(session.id);
    }
    if (!result.document) {
      return res.status(409).json({ error: 'not_ready' });
    }
    sendReservationDocument(res, result.document, { disposition: 'attachment' });
  }),
);

export default router;
