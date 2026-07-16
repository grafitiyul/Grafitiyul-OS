// Travel Agency Reservations — public intake (Slice 2).
// The form's ONE write: validate a submission and persist ReservationSession
// + ReservationGroups atomically. NO Deal creation here — the source-blind
// processor (Slice 3) consumes persisted sessions. Intake idempotency:
// submissionKey is client-minted; a retried/double-tapped submit returns the
// existing session instead of creating a duplicate.

import { prisma } from '../db.js';
import { israelToday, isValidDate } from '../lib/israelDate.js';

export const MAX_GROUPS = 30;
export const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024; // signers.js convention
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const TOUR_LANGUAGES = ['he', 'en', 'es', 'fr', 'ru'];

// Session-wide legal confirmations (BINDING #7: the wording frames a
// reservation REQUEST). Keys + version are recorded on the session; the
// display text lives in the client's L tables. Bump the version when the
// wording changes materially.
export const REQUIRED_CONFIRMATIONS = [
  { key: 'reservation_request', textVersion: 1 }, // "this is a request, not a confirmed booking"
  { key: 'details_correct', textVersion: 1 }, // "the details I provided are correct"
];

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
export function validateSubmission(body, catalog, { today = israelToday() } = {}) {
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

  // ONE signature per session (BINDING: session footer). Typed signatures are
  // the signer's name; drawn signatures must be a valid PNG data URL.
  const signerName = str(body?.signature?.signerName, 120);
  const signatureMethod = ['drawn', 'typed'].includes(body?.signature?.method)
    ? body.signature.method
    : null;
  if (!signerName) push('signature.signerName', 'required');
  if (!signatureMethod) push('signature.method', 'required');
  let signatureBytes = null;
  if (signatureMethod === 'drawn') {
    signatureBytes = decodeSignaturePng(body?.signature?.image);
    if (!signatureBytes) push('signature.image', 'invalid');
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

  if (problems.length) return { problems };

  const acceptedAt = new Date().toISOString();
  return {
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

// The public catalog DTO: bookable business tours as flat variants +
// locations, bilingual labels only — never the admin product DTOs.
export async function bookableCatalog(db = prisma) {
  const variants = await db.productVariant.findMany({
    where: {
      active: true,
      availableBusiness: true, // business tours only (BINDING #4)
      product: { active: true },
      location: { active: true },
    },
    select: {
      id: true,
      productId: true,
      locationId: true,
      product: { select: { nameHe: true, nameEn: true, sortOrder: true } },
      location: { select: { nameHe: true, nameEn: true, sortOrder: true } },
    },
    orderBy: [{ location: { sortOrder: 'asc' } }, { product: { sortOrder: 'asc' } }],
  });
  const locations = [];
  const seen = new Set();
  for (const v of variants) {
    if (!seen.has(v.locationId)) {
      seen.add(v.locationId);
      locations.push({
        id: v.locationId,
        nameHe: v.location.nameHe,
        nameEn: v.location.nameEn || v.location.nameHe,
      });
    }
  }
  return {
    locations,
    variants: variants.map((v) => ({
      id: v.id,
      productId: v.productId,
      locationId: v.locationId,
      nameHe: v.product.nameHe,
      nameEn: v.product.nameEn || v.product.nameHe,
      // Frozen display snapshots persisted on the group (Hebrew — the
      // operational language of the CRM).
      productLabel: v.product.nameHe,
      locationLabel: v.location.nameHe,
    })),
  };
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
      const created = await tx.reservationSession.create({
        data: {
          source: 'travel_agent',
          linkId: link.id,
          contactId: contact.id,
          organizationId: organization.id,
          ...validated.session,
          payloadSnapshot,
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
