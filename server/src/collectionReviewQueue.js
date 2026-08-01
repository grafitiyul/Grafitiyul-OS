import { DOC_TYPE_LABELS, dealDocumentKey } from './icountDocs.js';
import { dealCollection } from './collection.js';
import { emitTimelineEvent, userOrigin } from './timeline/events.js';

// The operator review queue — reading and resolving second-stage suggestions.
//
// A queue item is a SUGGESTION, never evidence. Resolving it writes through the
// canonical paths (an IcountDocument link, or the manual-evidence service) and
// then marks the item answered. The item itself never appears in any balance.
//
// Everything the operator needs is served from the LOCAL ledger mirror — the
// candidate document's real customer, date, amount and payment meaning — so
// nobody has to go and search iCount by hand to make the call.

const MONEY_DOCTYPES = new Set(['receipt', 'invrec']);

function codedError(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

const reasonLabels = {
  icount_client_id: 'מזהה הלקוח באייקאונט תואם ללקוח שזוהה משיוכים קודמים',
  tax_id: 'ח.פ זהה',
  exact_name: 'שם הלקוח זהה במדויק',
  exact_amount: 'סכום המסמך זהה לסכום העסקה',
  amount_below_deal: 'סכום המסמך נמוך מסכום העסקה (ייתכן מקדמה)',
  amount_above_deal: 'סכום המסמך גבוה מסכום העסקה (ייתכן מסמך משותף)',
  date_distance_days: 'מרחק בימים בין תאריך המסמך לתאריך הסיור/העסקה',
  mutual_unique_exact_amount: 'המסמך והעסקה הם המועמד היחיד זה של זה',
};

/**
 * The queue, newest-strongest first, grouped by deal so an operator answers a
 * DEAL ("which document settles this?") rather than a stream of unrelated pairs.
 */
export async function listQueue(prisma, { status = 'open', limit = 200, offset = 0 } = {}) {
  const items = await prisma.collectionMatchCandidate.findMany({
    where: { status },
    orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
    take: Math.min(1000, limit),
    skip: offset,
    include: {
      deal: {
        select: {
          id: true, orderNo: true, title: true, valueMinor: true, currency: true, tourDate: true, wonAt: true,
          organization: { select: { name: true } },
          organizationUnit: { select: { name: true } },
          contacts: {
            where: { isPrimary: true }, take: 1,
            select: { contact: { select: { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true } } },
          },
        },
      },
    },
  });
  if (!items.length) return { deals: [], total: 0 };

  // One ledger read for every candidate document on the page.
  const keys = items.map((i) => ({ doctype: i.doctype, docnum: i.docnum }));
  const ledger = await prisma.icountLedgerDoc.findMany({ where: { OR: keys } });
  const ledgerBy = new Map(ledger.map((l) => [`${l.doctype}:${l.docnum}`, l]));

  const byDeal = new Map();
  for (const it of items) {
    const l = ledgerBy.get(`${it.doctype}:${it.docnum}`);
    const c = it.deal.contacts[0]?.contact || null;
    const customer =
      it.deal.organization?.name ||
      (c ? `${c.firstNameHe || c.firstNameEn || ''} ${c.lastNameHe || c.lastNameEn || ''}`.trim() : null);

    if (!byDeal.has(it.dealId)) {
      byDeal.set(it.dealId, {
        dealId: it.dealId,
        orderNo: it.deal.orderNo,
        title: it.deal.title,
        customer,
        organizationUnit: it.deal.organizationUnit?.name || null,
        dealValueMinor: Number(it.deal.valueMinor || 0),
        currency: it.deal.currency || 'ILS',
        tourDate: it.deal.tourDate,
        wonAt: it.deal.wonAt,
        candidates: [],
      });
    }
    byDeal.get(it.dealId).candidates.push({
      id: it.id,
      doctype: it.doctype,
      doctypeLabel: DOC_TYPE_LABELS[it.doctype] || it.doctype,
      docnum: it.docnum,
      score: it.score,
      question: it.question,
      // Why it was suggested, in business language.
      reasons: (it.basis || []).map((r) => ({ code: r.code, label: reasonLabels[r.code] || r.code, detail: r.detail })),
      competingDeals: it.competingDeals || [],
      competingDocs: it.competingDocs || [],
      // The candidate document's REAL figures, straight from the mirror.
      document: l
        ? {
            clientName: l.clientName,
            clientVatId: l.clientVatId,
            issuedAt: l.issuedAt,
            amountMinor: Number(l.totalMinor),
            paidMinor: l.paidMinor == null ? null : Number(l.paidMinor),
            currency: l.currency,
            cancelled: l.isCancelled || l.isCancellation,
            countsAsPayment: MONEY_DOCTYPES.has(it.doctype) && !l.isCancelled,
            docUrl: l.docUrl,
          }
        : null,
    });
  }
  const total = await prisma.collectionMatchCandidate.count({ where: { status } });
  return { deals: [...byDeal.values()], total };
}

export async function queueCounts(prisma) {
  const rows = await prisma.collectionMatchCandidate.groupBy({ by: ['status'], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}

/**
 * Resolve one queue item.
 *
 *   link      attach the document to the deal (the ordinary "yes, it's this one")
 *   shared    attach it AND mark it a shared historical document — it settles
 *             this deal by the deal's own total, and company totals still count
 *             the document once
 *   reject    this document does not belong to this deal
 *   unresolved park it: real, but not answerable today
 *
 * Every outcome is audited; `link` and `shared` go through the same
 * IcountDocument write the rest of the system uses.
 */
export async function resolveQueueItem(prisma, itemId, { action, note }, userId) {
  const item = await prisma.collectionMatchCandidate.findUnique({ where: { id: itemId } });
  if (!item) throw codedError('not_found');
  if (item.status !== 'open') return { item, alreadyResolved: true };

  const actor = await userOrigin(userId);
  const finish = (status) =>
    prisma.collectionMatchCandidate.update({
      where: { id: item.id },
      data: {
        status,
        resolvedAt: new Date(),
        resolvedBy: userId || null,
        resolvedByName: actor.createdByName || null,
        resolutionNote: String(note || '').trim() || null,
      },
    });

  if (action === 'reject' || action === 'unresolved') {
    const updated = await finish(action === 'reject' ? 'rejected' : 'unresolved');
    await emitTimelineEvent(prisma, {
      subjectType: 'deal',
      subjectId: item.dealId,
      kind: 'accounting',
      data: {
        event: 'collection_candidate_resolved',
        action,
        doctype: item.doctype,
        doctypeLabel: DOC_TYPE_LABELS[item.doctype] || item.doctype,
        docnum: item.docnum,
        note: updated.resolutionNote,
      },
      origin: actor,
    });
    return { item: updated };
  }

  if (action !== 'link' && action !== 'shared') throw codedError('invalid_action');

  const ledgerDoc = await prisma.icountLedgerDoc.findUnique({
    where: { doctype_docnum: { doctype: item.doctype, docnum: item.docnum } },
  });
  if (!ledgerDoc) throw codedError('document_not_in_ledger');

  const deal = await prisma.deal.findUnique({
    where: { id: item.dealId },
    select: { id: true, valueMinor: true, currency: true, collectionReview: true },
  });

  const key = dealDocumentKey(deal.id, item.doctype, item.docnum);
  const existing = await prisma.icountDocument.findUnique({ where: { idempotencyKey: key } });
  if (!existing) {
    const shared = action === 'shared';
    await prisma.icountDocument.create({
      data: {
        dealId: deal.id,
        source: 'linked',
        doctype: item.doctype,
        docnum: item.docnum,
        amountMinor: BigInt(Math.abs(Number(ledgerDoc.totalMinor))),
        paidMinor: ledgerDoc.paidMinor != null ? BigInt(Math.abs(Number(ledgerDoc.paidMinor))) : null,
        currency: ledgerDoc.currency || deal.currency || 'ILS',
        clientName: ledgerDoc.clientName || 'לקוח',
        clientVatId: ledgerDoc.clientVatId || null,
        docUrl: ledgerDoc.docUrl || null,
        status: 'issued',
        issuedAt: ledgerDoc.issuedAt,
        linkConfidence: shared ? 'operator_shared_historical' : 'operator_review_queue',
        linkReason: shared
          ? `אושר בתור הבדיקה כמסמך היסטורי משותף: המסמך סוגר את העסקה הזו לצד עסקאות נוספות; בדוחות ברמת החברה הוא נספר פעם אחת בלבד.${note ? ` ${note}` : ''}`
          : `אושר ידנית בתור הבדיקה של התאמות הגבייה.${note ? ` ${note}` : ''}`,
        sharedHistorical: shared,
        // A shared document settles THIS deal by ITS OWN payable total.
        allocationMinor: shared ? BigInt(Math.abs(Number(deal.valueMinor || 0))) : null,
        verifiedAt: new Date(),
        idempotencyKey: key,
      },
    });
    await emitTimelineEvent(prisma, {
      subjectType: 'deal',
      subjectId: deal.id,
      kind: 'accounting',
      createdAt: ledgerDoc.issuedAt || undefined,
      data: {
        event: 'collection_candidate_resolved',
        action,
        doctype: item.doctype,
        doctypeLabel: DOC_TYPE_LABELS[item.doctype] || item.doctype,
        docnum: item.docnum,
        amountIls: Number(ledgerDoc.totalMinor) / 100,
        sharedHistorical: shared,
        note: String(note || '').trim() || null,
      },
      origin: actor,
    });
  }

  // Every OTHER open suggestion for this same document on OTHER deals is now
  // answered by implication — leaving them open would ask the operator the same
  // question again from the other side.
  if (action === 'link') {
    await prisma.collectionMatchCandidate.updateMany({
      where: { doctype: item.doctype, docnum: item.docnum, status: 'open', id: { not: item.id } },
      data: { status: 'rejected', resolvedAt: new Date(), resolutionNote: 'המסמך שויך לעסקה אחרת' },
    });
  }

  const updated = await finish(action === 'shared' ? 'shared' : 'linked');
  return { item: updated, summary: await dealCollection(prisma, deal) };
}
