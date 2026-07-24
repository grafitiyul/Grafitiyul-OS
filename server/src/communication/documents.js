// Canonical document-token resolution for communication attachments.
//
// Document tokens are TYPED references to already-existing canonical stored
// artifacts — never regenerated, never copied into a second file record:
//
//   reservation_pdf — the immutable ReservationDocument of the deal's
//     reservation session (pdfBytes in the DB; one per session, ever).
//     Channel behavior: attach (email attachment / WhatsApp document send).
//     There is NO public download URL for this document, so 'link' mode is
//     invalid for it — validation enforces attach-only.
//
//   quote_document — the canonical PRODUCED immutable QuoteDocument (frozen
//     renderModelSnapshot + publicToken). GOS quotes have no PDF artifact —
//     the canonical customer-facing form IS the public link, so this token is
//     link-only ('attach' is rejected at publish; nothing is ever rendered
//     fresh from live Deal data). Resolution rule lives in context.js
//     (wonQuoteRef stamp for WON deals, else newest produced doc of the
//     primary offer) and the resolved identity is frozen onto the delivery.

import { prisma } from '../db.js';

export const DOCUMENT_KINDS = [
  {
    kind: 'reservation_pdf',
    labelHe: 'מסמך הזמנת סוכן (PDF)',
    modes: ['attach'],
    contexts: ['reservation'],
  },
  {
    kind: 'quote_document',
    labelHe: 'הצעת מחיר (קישור)',
    modes: ['link'],
    contexts: ['quote'],
  },
];

export function documentKind(kind) {
  return DOCUMENT_KINDS.find((d) => d.kind === kind) || null;
}

/**
 * Resolve a document token against a loaded context (metadata only — bytes are
 * fetched lazily at send time). Returns:
 * { kind, exists, filename?, sizeBytes?, documentId?, url?, reason? }
 */
export async function resolveDocument(token, ctx, origin) {
  const kind = token?.kind;
  if (kind === 'reservation_pdf') {
    const doc = ctx.reservation?.document;
    if (!doc) return { kind, exists: false, reason: 'לא קיים מסמך הזמנת סוכן עבור ההקשר הזה' };
    return {
      kind,
      exists: true,
      documentId: doc.id,
      filename: doc.filename,
      mimeType: doc.mimeType || 'application/pdf',
      sizeBytes: doc.sizeBytes,
    };
  }
  if (kind === 'quote_document') {
    const q = ctx.quoteDoc;
    if (!q?.publicToken) return { kind, exists: false, reason: 'לא קיימת הצעת מחיר מופקת לדיל' };
    return {
      kind,
      exists: true,
      documentId: q.quoteDocumentId,
      versionNo: q.versionNo,
      source: q.source,
      url: origin ? `${origin}/quote/${q.publicToken}` : null,
    };
  }
  return { kind, exists: false, reason: `סוג מסמך לא מוכר: ${kind}` };
}

/** Fetch the actual bytes for an attach-mode resolved document. */
export async function loadDocumentBytes(resolved) {
  if (resolved?.kind === 'reservation_pdf' && resolved.documentId) {
    const doc = await prisma.reservationDocument.findUnique({
      where: { id: resolved.documentId },
      select: { pdfBytes: true, filename: true, mimeType: true },
    });
    if (!doc) return null;
    return { buffer: Buffer.from(doc.pdfBytes), filename: doc.filename, mimeType: doc.mimeType || 'application/pdf' };
  }
  return null;
}
