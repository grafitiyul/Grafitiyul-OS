// Travel Agency Reservations — public intake (Slice 2).
// The form's ONE write: validate a submission and persist ReservationSession
// + ReservationGroups atomically. NO Deal creation here — the source-blind
// processor (Slice 3) consumes persisted sessions. Intake idempotency:
// submissionKey is client-minted; a retried/double-tapped submit returns the
// existing session instead of creating a duplicate.

import { prisma } from '../db.js';
import { israelToday, isValidDate } from '../lib/israelDate.js';
import { normalizePhoneIntl } from '../whatsapp/phone.js';
import { setOrganizationFinanceContact } from '../organizations/financeContact.js';

export const MAX_GROUPS = 30;
export const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024; // signers.js convention
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const TOUR_LANGUAGES = ['he', 'en', 'es', 'fr', 'ru'];

// Session-wide legal confirmation (BINDING #7: the wording frames a
// reservation REQUEST). Keys + version are recorded on the session; the
// display text lives in the client's L tables. Bump the version when the
// wording changes materially. v2 (redesign): ONE combined confirmation —
// "the reservation is subject to Grafitiyul approval" — per the approved
// mockup's single-checkbox footer.
export const REQUIRED_CONFIRMATIONS = [
  // The ONE mandatory acknowledgement (owner decision 2026-07-18): the
  // agent-specific flexible cancellation terms, checked before the signature;
  // acceptance + timestamp recorded in legalConfirmations. The former
  // approval-acknowledgement checkbox was removed.
  { key: 'flexible_cancellation', textVersion: 1 },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return false;
  return (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  );
}

// data:image/png;base64,… → Buffer, or null when absent/invalid.
export function decodeSignaturePng(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  let buf;
  try {
    buf = Buffer.from(m[1], 'base64');
  } catch {
    return null;
  }
  if (!buf.length || buf.length > MAX_SIGNATURE_BYTES || !isPng(buf)) return null;
  return buf;
}

const str = (v, max) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

// Validate + normalize one submission against the bookable catalog.
// Returns { problems } (each { path, code }) OR { session, groups } normalized
// for persistence. Problems use stable codes — the client renders bilingual
// messages; nothing user-facing is composed here.
export function validateSubmission(
  body,
  catalog,
  { today = israelToday(), orgHasFinance = false } = {},
) {
  const problems = [];
  const push = (path, code) => problems.push({ path, code });

  const submissionKey =
    typeof body?.submissionKey === 'string' && KEY_RE.test(body.submissionKey)
      ? body.submissionKey
      : null;
  if (!submissionKey) push('submissionKey', 'required');

  const language = body?.language === 'en' ? 'en' : 'he';

  const rawGroups = Array.isArray(body?.groups) ? body.groups : [];
  if (!rawGroups.length) push('groups', 'required');
  if (rawGroups.length > MAX_GROUPS) push('groups', 'too_many');

  const variantById = new Map(catalog.variants.map((v) => [v.id, v]));

  const groups = rawGroups.slice(0, MAX_GROUPS).map((g, i) => {
    const p = (field, code) => push(`groups.${i}.${field}`, code);

    const groupName = str(g?.groupName, 120);
    if (!groupName) p('groupName', 'required');

    const variant = variantById.get(g?.productVariantId) || null;
    if (!variant) p('productVariantId', 'required');

    const tourDate = typeof g?.tourDate === 'string' ? g.tourDate : '';
    if (!isValidDate(tourDate)) p('tourDate', 'invalid');
    else if (tourDate < today) p('tourDate', 'past');

    const tourTime = typeof g?.tourTime === 'string' ? g.tourTime : '';
    if (!TIME_RE.test(tourTime)) p('tourTime', 'invalid');

    const participants = Number(g?.participants);
    if (!Number.isInteger(participants) || participants < 1 || participants > 1000) {
      p('participants', 'invalid');
    }

    const tourLanguage = TOUR_LANGUAGES.includes(g?.tourLanguage) ? g.tourLanguage : null;

    // On-site contact (BINDING #5): both-or-nothing keeps the later Contact
    // creation meaningful — a phone without a name (or vice versa) is asked
    // to complete the pair.
    const onSiteContactName = str(g?.onSiteContactName, 120);
    const onSiteContactPhone = str(g?.onSiteContactPhone, 40);
    if (!!onSiteContactName !== !!onSiteContactPhone) {
      p(onSiteContactName ? 'onSiteContactPhone' : 'onSiteContactName', 'pair_required');
    }

    return {
      sortOrder: i,
      groupName: groupName || '',
      productId: variant?.productId || null,
      productVariantId: variant?.id || null,
      locationId: variant?.locationId || null,
      productLabel: variant?.productLabel || null,
      locationLabel: variant?.locationLabel || null,
      tourDate,
      tourTime: TIME_RE.test(tourTime) ? tourTime : null,
      participants: Number.isInteger(participants) ? participants : 0,
      tourLanguage,
      onSiteContactName,
      onSiteContactPhone,
      notes: str(g?.notes, 2000),
    };
  });

  // ONE signature per session (BINDING: session footer). EITHER method alone
  // satisfies the requirement: a drawn signature is a valid PNG data URL (the
  // signer name is then optional extra context); a typed signature is the
  // signer's full name. Only when neither exists does validation fail.
  const signerName = str(body?.signature?.signerName, 120);
  const signatureMethod = ['drawn', 'typed'].includes(body?.signature?.method)
    ? body.signature.method
    : null;
  if (!signatureMethod) push('signature.method', 'required');
  let signatureBytes = null;
  if (signatureMethod === 'drawn') {
    signatureBytes = decodeSignaturePng(body?.signature?.image);
    if (!signatureBytes) push('signature.image', 'invalid');
  } else if (signatureMethod === 'typed' && !signerName) {
    push('signature.signerName', 'required');
  }

  // Session-wide confirmations — every required key must be accepted.
  const accepted = new Set(
    (Array.isArray(body?.confirmations) ? body.confirmations : [])
      .filter((c) => c?.accepted === true && typeof c?.key === 'string')
      .map((c) => c.key),
  );
  for (const c of REQUIRED_CONFIRMATIONS) {
    if (!accepted.has(c.key)) push(`confirmations.${c.key}`, 'required');
  }

  // Invoice delivery ("לאן לשלוח את החשבונית?") — MULTI-recipient: organizer
  // and/or finance contact, as independent booleans (at least one). Contact
  // details are the Organization's canonical finance fields (same data GOS
  // Deals use); the selection + shown details freeze in the payload snapshot
  // (see the route), never as reservation-level source of truth.
  const inv = body?.invoice || {};
  const toOrganizer = inv.toOrganizer === true;
  const toFinance = inv.toFinance === true;
  if (!toOrganizer && !toFinance) push('invoice.recipients', 'required');
  // "החלף לאיש כספים חדש" — the agent NOMINATES a replacement person; the
  // existing Contact is never edited. Only meaningful with a saved contact
  // and while the finance recipient is selected.
  const replaceFinance = inv.replaceFinance === true && toFinance && orgHasFinance;
  // Nomination happens on the first finance contact OR on a replacement —
  // deliberately the SAME flow (contact match → create → membership →
  // designation); only the transfer history differs.
  const nominating = toFinance && (!orgHasFinance || replaceFinance);
  const financeName = str(inv.financeName, 120);
  const financeEmail =
    typeof inv.financeEmail === 'string' ? inv.financeEmail.trim().slice(0, 160) : '';
  // Phone: ORIGINAL entered value is kept; the canonical normalizer
  // (whatsapp/phone.js) is used for VALIDATION only — project convention.
  const financePhone = str(inv.financePhone, 40);
  if (nominating) {
    if (!financeName) push('invoice.financeName', 'required');
    if (financeEmail && !EMAIL_RE.test(financeEmail)) push('invoice.financeEmail', 'invalid');
    else if (!financeEmail) push('invoice.financeEmail', 'required');
    if (!financePhone) push('invoice.financePhone', 'required');
    else if (!normalizePhoneIntl(financePhone)) push('invoice.financePhone', 'invalid');
  }

  if (problems.length) return { problems };

  const acceptedAt = new Date().toISOString();
  return {
    invoice: {
      toOrganizer,
      toFinance,
      replaceFinance,
      nominating,
      financeName,
      financeEmail: financeEmail || null,
      financePhone,
    },
    session: {
      language,
      submissionKey,
      signerName,
      signatureMethod,
      signatureBytes,
      legalConfirmations: REQUIRED_CONFIRMATIONS.map((c) => ({ ...c, acceptedAt })),
    },
    groups,
  };
}

// THE canonical resolution rule for the city an external user sees:
//   effectiveAgentCity(variant.location) = location.parentLocation ?? location
// The parent ("עיר לתצוגה") is presentation/navigation only — it never
// replaces the operational location the Deal stores. Shared by the public
// catalog, validation snapshots and (via the catalog) submission processing.
export function effectiveAgentCity(location) {
  if (!location) return null;
  return location.parentLocation && location.parentLocation.active !== false
    ? location.parentLocation
    : location;
}

// The public catalog DTO — the agents' commercial view, derived from the
// CANONICAL entities: variants marked `agentVisible` (with a display name),
// grouped under their effective city (Location hierarchy). Never internal
// names, never the admin product DTOs. A city appears only when at least one
// eligible variant resolves to it — no empty city choices.
export async function bookableCatalog(db = prisma) {
  const variants = await db.productVariant.findMany({
    where: {
      active: true,
      availableBusiness: true, // business tours only (BINDING #4)
      agentVisible: true,
      product: { active: true },
      location: { active: true },
    },
    // Business order: the canonical Main Products order FIRST, then each
    // product's configured variant order — never alphabetical, never by
    // location or creation date.
    orderBy: [{ product: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    select: {
      id: true,
      productId: true,
      locationId: true,
      agentDisplayName: true,
      agentDisplayNameEn: true,
      agentDescription: true,
      location: {
        select: {
          id: true,
          nameHe: true,
          nameEn: true,
          sortOrder: true,
          parentLocation: {
            select: { id: true, nameHe: true, nameEn: true, sortOrder: true, active: true },
          },
        },
      },
    },
  });

  const cities = [];
  const cityById = new Map();
  const rows = [];
  for (const v of variants) {
    // Defense in depth: the API blocks visible-without-name, but a stale row
    // must be excluded rather than leak an internal name.
    if (!v.agentDisplayName) continue;
    const city = effectiveAgentCity(v.location);
    if (!cityById.has(city.id)) {
      cityById.set(city.id, true);
      cities.push({
        key: city.id,
        nameHe: city.nameHe,
        nameEn: city.nameEn || city.nameHe,
        sortOrder: city.sortOrder ?? 0,
      });
    }
    rows.push({
      id: v.id,
      productId: v.productId,
      locationId: v.locationId, // operational — what the Deal will store
      cityKey: city.id,
      nameHe: v.agentDisplayName,
      // EN falls back to the Hebrew COMMERCIAL name (approved channel rule) —
      // never to the internal variant/product name.
      nameEn: v.agentDisplayNameEn || v.agentDisplayName,
      description: v.agentDescription,
      // Frozen display snapshots persisted on the group — WHAT THE AGENT SAW;
      // the created Deal stores the canonical refs.
      productLabel: v.agentDisplayName,
      locationLabel: city.nameHe,
    });
  }
  cities.sort((a, b) => a.sortOrder - b.sortOrder || a.nameHe.localeCompare(b.nameHe, 'he'));
  return { cities: cities.map(({ sortOrder, ...c }) => c), variants: rows };
}

// Resolved invoice recipients for downstream document/invoice delivery —
// reads the FROZEN snapshot (what the agent selected and saw), returns a
// flat list deduped by lowercased email so organizer==finance never receives
// the same document twice. The ONE reader contract for delivery flows.
export function invoiceRecipients(payloadSnapshot, { organizerName = null, organizerEmail = null } = {}) {
  const inv = payloadSnapshot?.invoice || {};
  const out = [];
  if (inv.toOrganizer && organizerEmail) {
    out.push({ kind: 'organizer', name: organizerName, email: organizerEmail, phone: null });
  }
  if (inv.toFinance && inv.financeEmail) {
    out.push({
      kind: 'finance',
      name: inv.financeName || null,
      email: inv.financeEmail,
      phone: inv.financePhone || null,
    });
  }
  const seen = new Set();
  return out.filter((r) => {
    const key = r.email.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Persist a validated submission. Idempotent: an existing session with the
// same submissionKey is returned as-is (created: false) — including sessions
// already processed by Slice 3, so a very late retry still gets its numbers.
export async function persistSubmission(
  { link, contact, organization, validated, payloadSnapshot, clientMeta },
  db = prisma,
) {
  const existing = await db.reservationSession.findUnique({
    where: { submissionKey: validated.session.submissionKey },
    include: { groups: { orderBy: { sortOrder: 'asc' } } },
  });
  if (existing) return { session: existing, created: false };

  let session;
  try {
    session = await db.$transaction(async (tx) => {
      // Finance-contact nomination (first contact OR explicit replacement —
      // one canonical flow): the entered person is resolved through the ONE
      // finance-contact service (phone→email match, else create; org
      // membership; designation transfer + timeline). Runs BEFORE the
      // session create so the frozen snapshot can carry the resolved contact
      // id. A saved contact is NEVER overwritten without an explicit
      // replaceFinance nomination (validated server-side); the previous
      // person is never edited or deleted — only the designation moves.
      const inv = validated.invoice || {};
      let financeResult = null;
      if (inv.nominating && inv.financeEmail) {
        financeResult = await setOrganizationFinanceContact(tx, {
          organizationId: organization.id,
          name: inv.financeName,
          email: inv.financeEmail,
          phone: inv.financePhone,
          source: 'travel_agent',
          context: {
            submissionKey: validated.session.submissionKey,
            agentContactId: contact.id,
          },
        });
      }
      // Snapshot enrichment — historical evidence of what was shown/decided:
      // recipients, the resolved Contact id, and how the contact came to be
      // (existing designation / matched / created / replaced).
      const financeMode = inv.nominating
        ? inv.replaceFinance
          ? 'replaced'
          : financeResult?.matchedBy === 'created'
            ? 'created'
            : 'matched_existing'
        : inv.toFinance
          ? 'existing'
          : null;
      const snapshot = {
        ...payloadSnapshot,
        invoice: {
          ...payloadSnapshot.invoice,
          financeContactId: financeResult?.contactId ?? organization.financeContactId ?? null,
          financeMode,
        },
      };

      const created = await tx.reservationSession.create({
        data: {
          source: 'travel_agent',
          linkId: link.id,
          contactId: contact.id,
          organizationId: organization.id,
          ...validated.session,
          payloadSnapshot: snapshot,
          clientMeta: clientMeta || null,
          groups: { create: validated.groups },
        },
        include: { groups: { orderBy: { sortOrder: 'asc' } } },
      });
      await tx.agentReservationLink.update({
        where: { id: link.id },
        data: { lastUsedAt: new Date() },
      });
      return created;
    });
  } catch (e) {
    // Concurrent double-submit lost the unique-key race (P2002 on
    // submissionKey): the other request's session IS this submission.
    if (e?.code === 'P2002') {
      const winner = await db.reservationSession.findUnique({
        where: { submissionKey: validated.session.submissionKey },
        include: { groups: { orderBy: { sortOrder: 'asc' } } },
      });
      if (winner) return { session: winner, created: false };
    }
    throw e;
  }
  return { session, created: true };
}
