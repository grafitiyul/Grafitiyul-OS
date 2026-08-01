import { dealCollection, EVIDENCE_KIND_LABELS } from './collection.js';
import { emitTimelineEvent, userOrigin } from './timeline/events.js';

// Manual collection evidence — the write path behind the Deal גבייה panel's
// operator controls.
//
// The product rule this module exists to enforce: operator-entered money is
// REAL money for the balance, and is NEVER dressed up as an accounting
// document. It lands in its own table, renders with its own badge, and every
// row names the person who entered it.
//
// Nothing is ever edited in place. Correcting a manual payment means REVERSING
// it (an audited action that leaves the original row readable) and recording a
// new one — the same discipline the accounting provider itself applies.

const KINDS = {
  manual_payment: 'in',
  manual_credit: 'out',
  settlement: 'in',
};

export const PAYMENT_METHODS = [
  { key: 'banktransfer', label: 'העברה בנקאית' },
  { key: 'cash', label: 'מזומן' },
  { key: 'cc', label: 'כרטיס אשראי' },
  { key: 'cheque', label: 'המחאה' },
  { key: 'bit', label: 'ביט / אפליקציית תשלום' },
  { key: 'other', label: 'אחר' },
];
const METHOD_KEYS = new Set(PAYMENT_METHODS.map((m) => m.key));

function codedError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

const toMinor = (ils) => BigInt(Math.round(Number(ils) * 100));

// A settlement's amount is not free input: it is the balance that is actually
// outstanding at this moment. Recording it as a real number is what makes
// "fully paid" auditable instead of a boolean that hides money.
export async function settlementAmountMinor(prisma, deal) {
  const summary = await dealCollection(prisma, deal);
  return { balanceMinor: summary.balanceMinor, summary };
}

/**
 * Record manual evidence. `input`:
 *   kind        'manual_payment' | 'manual_credit' | 'settlement'
 *   amountIls   required for payment/credit; IGNORED for settlement (computed)
 *   paidAt      'YYYY-MM-DD'
 *   currency    defaults to the deal's
 *   method, reference, note, fileId
 */
export async function recordEvidence(prisma, deal, input, userId) {
  const actor = await userOrigin(userId);
  const kind = String(input?.kind || '');
  const direction = KINDS[kind];
  if (!direction) throw codedError('invalid_kind');

  const currency = String(input?.currency || deal.currency || 'ILS').toUpperCase();
  const method = input?.method ? String(input.method) : null;
  if (method && !METHOD_KEYS.has(method)) throw codedError('invalid_method');

  let amountMinor;
  if (kind === 'settlement') {
    const { balanceMinor } = await settlementAmountMinor(prisma, deal);
    if (balanceMinor <= 0) throw codedError('nothing_outstanding');
    amountMinor = BigInt(balanceMinor);
  } else {
    const amountIls = Number(input?.amountIls);
    if (!Number.isFinite(amountIls) || amountIls <= 0) throw codedError('amount_invalid');
    amountMinor = toMinor(amountIls);
  }

  const paidAtRaw = String(input?.paidAt || '').slice(0, 10);
  if (paidAtRaw && !/^\d{4}-\d{2}-\d{2}$/.test(paidAtRaw)) throw codedError('date_invalid');
  const paidAt = paidAtRaw ? new Date(`${paidAtRaw}T00:00:00.000Z`) : new Date();

  // A supporting file must belong to THIS deal — an evidence row may never
  // point at another deal's private document.
  const fileId = input?.fileId ? String(input.fileId) : null;
  if (fileId) {
    const file = await prisma.dealFile.findFirst({ where: { id: fileId, dealId: deal.id }, select: { id: true } });
    if (!file) throw codedError('file_not_found');
  }

  const row = await prisma.dealCollectionEvidence.create({
    data: {
      dealId: deal.id,
      kind,
      direction,
      amountMinor,
      currency,
      paidAt,
      method,
      reference: String(input?.reference || '').trim() || null,
      note: String(input?.note || '').trim() || null,
      fileId,
      origin: 'operator',
      createdBy: userId || null,
      createdByName: actor.createdByName || null,
    },
  });

  await emitTimelineEvent(prisma, {
    subjectType: 'deal',
    subjectId: deal.id,
    kind: 'accounting',
    data: {
      event: 'collection_evidence_recorded',
      evidenceKind: kind,
      evidenceLabel: EVIDENCE_KIND_LABELS[kind] || kind,
      direction,
      amountIls: Number(amountMinor) / 100,
      currency,
      paidAt: paidAt.toISOString(),
      method,
      reference: row.reference,
      note: row.note,
      hasAttachment: !!fileId,
      // Said out loud in the deal's own history: no document was issued.
      manual: true,
    },
    origin: actor,
  });

  return row;
}

/**
 * Reverse a manual evidence row. The row survives with its reversal recorded —
 * this is an audit trail, not a delete.
 */
export async function reverseEvidence(prisma, deal, evidenceId, { reason }, userId) {
  const actor = await userOrigin(userId);
  const row = await prisma.dealCollectionEvidence.findFirst({
    where: { id: evidenceId, dealId: deal.id },
  });
  if (!row) throw codedError('not_found');
  if (row.status === 'reversed') return row; // idempotent
  const why = String(reason || '').trim();
  if (!why) throw codedError('reason_required');

  const updated = await prisma.dealCollectionEvidence.update({
    where: { id: row.id },
    data: {
      status: 'reversed',
      reversedAt: new Date(),
      reversedBy: userId || null,
      reversedByName: actor.createdByName || null,
      reversalReason: why,
    },
  });

  await emitTimelineEvent(prisma, {
    subjectType: 'deal',
    subjectId: deal.id,
    kind: 'accounting',
    data: {
      event: 'collection_evidence_reversed',
      evidenceKind: row.kind,
      evidenceLabel: EVIDENCE_KIND_LABELS[row.kind] || row.kind,
      amountIls: Number(row.amountMinor) / 100,
      currency: row.currency,
      reason: why,
      manual: true,
    },
    origin: actor,
  });

  return updated;
}

/**
 * Clear (or re-raise) the "needs review" flag. Clearing is an operator decision
 * and is preserved: the historical backfill will not re-raise a flag a human
 * already answered.
 */
export async function resolveReview(prisma, deal, { note }, userId) {
  const actor = await userOrigin(userId);
  const current = deal.collectionReview || null;
  if (!current) return null;
  const cleared = {
    ...current,
    clearedAt: new Date().toISOString(),
    clearedBy: userId || null,
    clearedByName: actor.createdByName || null,
    clearedNote: String(note || '').trim() || null,
  };
  await prisma.deal.update({ where: { id: deal.id }, data: { collectionReview: cleared } });

  await emitTimelineEvent(prisma, {
    subjectType: 'deal',
    subjectId: deal.id,
    kind: 'accounting',
    data: {
      event: 'collection_review_cleared',
      code: current.code || null,
      reason: current.reason || null,
      note: cleared.clearedNote,
    },
    origin: actor,
  });
  return cleared;
}

// Evidence rows for the panel — including reversed ones, which stay visible as
// history (greyed by the UI) so a balance change is never unexplained.
export async function listEvidence(prisma, dealId) {
  return prisma.dealCollectionEvidence.findMany({
    where: { dealId },
    orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    include: { file: { select: { id: true, filename: true, mimeType: true, sizeBytes: true } } },
  });
}
