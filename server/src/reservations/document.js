// Travel Agency Reservations — the canonical reservation-summary DOCUMENT
// service. ONE immutable PDF per successfully processed session:
//
//   ensureReservationDocument(sessionId)
//     1. Already generated? → return it (idempotent fast path).
//     2. Session fully processed (every group has its Deal)? If not →
//        { error: 'not_ready' } — the document is only ever built AFTER all
//        canonical entities (contact, deals, orderNos) exist.
//     3. Build the FROZEN content snapshot (booker identity, group labels,
//        frozen pricing, deal orderNos) → render the PDF → in ONE
//        transaction: create the ReservationDocument row + emit the filing
//        timeline events on the booker Contact and on EVERY created Deal.
//        The unique sessionId makes a concurrent race lose with P2002 and
//        adopt the winner — a rerun creates 0 documents, 0 links, 0 events.
//
// Filing is DERIVED, never copied: the Contact association is
// session.contactId, each Deal association is its group's createdDealId. One
// stored asset, N associations, zero duplicated binaries.
//
// A PDF failure here never affects the reservation itself — callers treat
// this as best-effort and every download path retries via the same ensure.

import { prisma } from '../db.js';
import { emitTimelineEvent, systemOrigin } from '../timeline/events.js';
import { buildReservationSummaryPdf } from './pdf.js';

// v2: the snapshot carries the FROZEN legal wording (payloadSnapshot.legal +
// per-confirmation textLines) and the PDF renders legal content from it —
// registry edits can never reword an already-submitted reservation.
export const GENERATOR_VERSION = 'v2';

// Human-readable, ASCII-safe (Content-Disposition friendly) filename.
export function reservationDocumentFilename(sessionNo) {
  return `Grafitiyul-Agent-Reservation-${sessionNo}.pdf`;
}

// Prisma JSON columns cannot hold BigInt (engine money values may surface as
// BigInt) — normalize to Number, which is exact for realistic money minors.
export function jsonSafe(value) {
  if (value === undefined) return null;
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)),
  );
}

// Frozen content snapshot — every value the PDF renders, resolved ONCE at
// generation time. Future edits to products, pricing cards, the contact or
// the deals can never change an already-issued document.
export function buildDocumentSnapshot(session, { generatedAt = new Date() } = {}) {
  const language = session.language === 'en' ? 'en' : 'he';
  const contact = session.contact || null;
  const nameHe = `${contact?.firstNameHe || ''} ${contact?.lastNameHe || ''}`.trim();
  const nameEn = `${contact?.firstNameEn || ''} ${contact?.lastNameEn || ''}`.trim();
  const bookerName =
    (language === 'en' ? nameEn || nameHe : nameHe || nameEn) || session.signerName || '';

  const pricingByGroup = Array.isArray(session.payloadSnapshot?.pricingByGroup)
    ? session.payloadSnapshot.pricingByGroup
    : [];
  const inv = session.payloadSnapshot?.invoice || null;

  return {
    version: 1,
    kind: 'agent_summary',
    sessionId: session.id,
    sessionNo: session.sessionNo,
    language,
    submittedAt: session.submittedAt ? new Date(session.submittedAt).toISOString() : null,
    generatedAt: new Date(generatedAt).toISOString(),
    booker: {
      name: bookerName,
      phone: contact?.phones?.[0]?.value || null,
      email: contact?.emails?.[0]?.value || null,
      company: session.organization?.name || null,
    },
    groups: (session.groups || []).map((g, i) => ({
      index: i + 1,
      groupName: g.groupName || '',
      cityLabel: g.locationLabel || null,
      activityLabel: g.productLabel || null,
      tourDate: g.tourDate,
      tourTime: g.tourTime || null,
      participants: g.participants,
      guides: g.groups || 1,
      tourLanguage: g.tourLanguage || null,
      onSiteContactName: g.onSiteContactName || null,
      onSiteContactPhone: g.onSiteContactPhone || null,
      notes: g.notes || null,
      dealId: g.createdDealId || null,
      orderNo: g.createdDeal?.orderNo ?? null,
      // The pricing model FROZEN at submission (same canonical engine result
      // the agent saw) — keyed by the group's position in the submission.
      pricing: jsonSafe(pricingByGroup[g.sortOrder ?? i] ?? null),
    })),
    invoice: inv
      ? {
          toOrganizer: !!inv.toOrganizer,
          toFinance: !!inv.toFinance,
          financeName: inv.financeName || null,
          financeEmail: inv.financeEmail || null,
          financePhone: inv.financePhone || null,
        }
      : null,
    // Accepted confirmations WITH their frozen wording (textLines) — the exact
    // statement the agent checked, never re-rendered from today's registry.
    confirmations: jsonSafe(session.legalConfirmations) || [],
    // The frozen legal wording block (cancellation/disclaimer/invoice labels)
    // in the submission language. Null on legacy sessions — the renderer then
    // falls back to its historical built-in wording.
    legal: jsonSafe(session.payloadSnapshot?.legal) || null,
    signature: {
      signerName: session.signerName || null,
      method: session.signatureMethod || null,
    },
  };
}

const SESSION_INCLUDE = {
  groups: {
    orderBy: { sortOrder: 'asc' },
    include: { createdDeal: { select: { id: true, orderNo: true } } },
  },
  contact: {
    select: {
      firstNameHe: true,
      lastNameHe: true,
      firstNameEn: true,
      lastNameEn: true,
      phones: { where: { isPrimary: true }, take: 1, select: { value: true } },
      emails: { where: { isPrimary: true }, take: 1, select: { value: true } },
    },
  },
  organization: { select: { name: true } },
};

/**
 * Idempotently ensure THE canonical summary document for a session.
 * Returns { document, created } on success, { error } otherwise
 * ('not_found' | 'not_ready').
 */
export async function ensureReservationDocument(sessionId, db = prisma) {
  const existing = await db.reservationDocument.findUnique({ where: { sessionId } });
  if (existing) return { document: existing, created: false };

  const session = await db.reservationSession.findUnique({
    where: { id: sessionId },
    include: SESSION_INCLUDE,
  });
  if (!session) return { error: 'not_found' };
  // Generate ONLY after full success: every group has its Deal. Partial or
  // pending sessions keep retrying through the processor; the document waits.
  if (session.status !== 'processed') return { error: 'not_ready' };

  const snapshot = buildDocumentSnapshot(session);
  const pdf = await buildReservationSummaryPdf(snapshot, {
    signatureBytes: session.signatureBytes || null,
  });
  const filename = reservationDocumentFilename(session.sessionNo);

  try {
    const document = await db.$transaction(async (tx) => {
      const doc = await tx.reservationDocument.create({
        data: {
          sessionId: session.id,
          kind: 'agent_summary',
          language: snapshot.language,
          filename,
          mimeType: 'application/pdf',
          sizeBytes: pdf.length,
          pdfBytes: pdf,
          contentSnapshot: snapshot,
          generatorVersion: GENERATOR_VERSION,
        },
      });
      // Filing events — atomic with the document row, so a retry can never
      // duplicate them (no document ⇒ no events; document ⇒ events exist).
      const eventData = (dealId = null) => ({
        event: 'agent_reservation_summary_generated',
        // Generic discriminator so any file-event consumer can resolve the stored
        // document via the subject's scoped download route (documentId is the key).
        source: 'reservation_summary',
        reservationSessionId: session.id,
        sessionNo: session.sessionNo,
        documentId: doc.id,
        filename,
        ...(dealId ? { dealId } : {}),
      });
      if (session.contactId) {
        await emitTimelineEvent(tx, {
          subjectType: 'contact',
          subjectId: session.contactId,
          kind: 'file',
          body: `הופק סיכום הזמנת סוכן — בקשה #${session.sessionNo}`,
          data: eventData(),
          origin: systemOrigin(),
        });
      }
      for (const g of session.groups) {
        if (!g.createdDealId) continue;
        await emitTimelineEvent(tx, {
          subjectType: 'deal',
          subjectId: g.createdDealId,
          kind: 'file',
          body: `הופק סיכום הזמנת סוכן — בקשה #${session.sessionNo}`,
          data: eventData(g.createdDealId),
          origin: systemOrigin(),
        });
      }
      return doc;
    });
    return { document, created: true };
  } catch (e) {
    // Concurrent generation lost the unique-sessionId race — the winner's
    // document IS the canonical one.
    if (e?.code === 'P2002') {
      const winner = await db.reservationDocument.findUnique({ where: { sessionId } });
      if (winner) return { document: winner, created: false };
    }
    throw e;
  }
}

// The document as admin/public metadata (never the bytes).
export function documentDto(doc) {
  return {
    id: doc.id,
    sessionId: doc.sessionId,
    kind: doc.kind,
    language: doc.language,
    filename: doc.filename,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    generatedAt: doc.generatedAt,
  };
}

// Serve the stored PDF bytes on an Express response. `disposition` is
// 'attachment' (public download) or 'inline' (admin viewing).
export function sendReservationDocument(res, doc, { disposition = 'attachment' } = {}) {
  const bytes = Buffer.from(doc.pdfBytes);
  res.setHeader('Content-Type', doc.mimeType || 'application/pdf');
  res.setHeader('Content-Length', bytes.length);
  res.setHeader('Content-Disposition', `${disposition}; filename="${doc.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(bytes);
}
