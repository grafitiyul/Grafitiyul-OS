import { DOC_TYPE_LABELS } from './icountDocs.js';

// Collection (גבייה) — the SINGLE source of truth for a deal's financial
// collection status. Everything the UI shows (Deal card, Collection screen)
// comes from here; the client never derives paid/balance on its own.
//
// "Paid" = money ACTUALLY received, and nothing else:
//   + קבלה            (receipt)   — records money received
//   + חשבונית מס קבלה (invrec)    — records money received
//   − חשבונית זיכוי    (refund)    — money returned, subtracted
// NOT paid: חשבון עסקה ('deal'), חשבונית מס ('invoice') — billing paper;
// open payment links / pending Cardcom requests — intent, not money. A paid
// Cardcom request auto-issues a receipt-type document, which is when it counts.
//
// Totals: Deal.valueMinor is the Price Builder headline and the ONLY deal
// total. Data source: GOS IcountDocument rows (status 'issued'). Documents
// issued directly in iCount and never mirrored into GOS are not visible here.

export const RECEIPT_DOCTYPES = ['receipt', 'invrec'];
export const REFUND_DOCTYPE = 'refund';
const COLLECTION_DOCTYPES = [...RECEIPT_DOCTYPES, REFUND_DOCTYPE];

// Pure math over (deal total, money-movement docs) → the summary numbers.
// `docs`: [{ doctype, amountMinor, createdAt }] — already filtered to issued
// rows; non-collection doctypes are ignored here too (defense in depth).
export function computeCollection(totalMinor, docs) {
  const total = Number(totalMinor || 0);
  let paid = 0;
  let lastPaymentAt = null;
  for (const d of docs || []) {
    const amount = Number(d.amountMinor || 0);
    if (RECEIPT_DOCTYPES.includes(d.doctype)) {
      paid += amount;
      if (d.createdAt && (!lastPaymentAt || new Date(d.createdAt) > new Date(lastPaymentAt))) {
        lastPaymentAt = d.createdAt;
      }
    } else if (d.doctype === REFUND_DOCTYPE) {
      paid -= amount;
    }
  }
  const balance = total - paid;
  const paidPct = total > 0 ? Math.round((paid / total) * 100) : null;
  // Status ladder: no priced amount → attention; else by how much came in.
  const status =
    total <= 0 ? 'no_amount' : paid <= 0 ? 'unpaid' : paid < total ? 'partial' : 'paid';
  return { totalMinor: total, paidMinor: paid, balanceMinor: balance, paidPct, status, lastPaymentAt };
}

// The card's payment rows — ONLY actual money movements (receipts in,
// refunds out), never billing paper or open links.
export function paymentRows(docs) {
  return (docs || [])
    .filter((d) => COLLECTION_DOCTYPES.includes(d.doctype))
    .map((d) => ({
      id: d.id,
      doctype: d.doctype,
      doctypeLabel: DOC_TYPE_LABELS[d.doctype] || d.doctype,
      docnum: d.docnum || null,
      direction: d.doctype === REFUND_DOCTYPE ? 'out' : 'in',
      amountMinor: Number(d.amountMinor || 0),
      currency: d.currency || 'ILS',
      clientName: d.clientName || null,
      docUrl: d.docUrl || null,
      createdAt: d.createdAt,
    }));
}

async function collectionDocsFor(prisma, dealIds) {
  return prisma.icountDocument.findMany({
    where: { dealId: { in: dealIds }, status: 'issued', doctype: { in: COLLECTION_DOCTYPES } },
    orderBy: { createdAt: 'desc' },
  });
}

// Single-deal summary — what the Deal גבייה card renders.
export async function dealCollection(prisma, deal) {
  const docs = await collectionDocsFor(prisma, [deal.id]);
  const summary = computeCollection(deal.valueMinor, docs);
  return { ...summary, currency: deal.currency || 'ILS', payments: paymentRows(docs) };
}

// A deal "requires collection" when it is WON and the money has not fully
// arrived — including WON deals that were never priced (no_amount): those are
// exactly the deals that fall through cracks.
export function requiresCollection(summary) {
  return summary.status !== 'paid';
}

// The Collection screen's rows: every WON deal that still requires collection,
// with its summary numbers. One docs query for all deals (no N+1).
export async function collectionDeals(prisma) {
  const deals = await prisma.deal.findMany({
    where: { status: 'won' },
    orderBy: { wonAt: 'desc' },
    include: {
      organization: { select: { id: true, name: true } },
      organizationUnit: { select: { id: true, name: true } },
      contacts: {
        where: { isPrimary: true },
        take: 1,
        select: {
          contact: {
            select: { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true },
          },
        },
      },
    },
  });
  if (!deals.length) return [];
  const docs = await collectionDocsFor(prisma, deals.map((d) => d.id));
  const byDeal = new Map();
  for (const doc of docs) {
    if (!byDeal.has(doc.dealId)) byDeal.set(doc.dealId, []);
    byDeal.get(doc.dealId).push(doc);
  }
  return deals
    .map((deal) => {
      const summary = computeCollection(deal.valueMinor, byDeal.get(deal.id) || []);
      if (!requiresCollection(summary)) return null;
      const c = deal.contacts[0]?.contact || null;
      const contactName = c
        ? `${c.firstNameHe || c.firstNameEn || ''} ${c.lastNameHe || c.lastNameEn || ''}`.trim()
        : null;
      return {
        id: deal.id,
        // For the business-facing Deal URL (dealPath) on the Collection screen.
        orderNo: deal.orderNo,
        title: deal.title,
        wonAt: deal.wonAt,
        tourDate: deal.tourDate,
        ownerUserId: deal.ownerUserId || null,
        currency: deal.currency || 'ILS',
        organization: deal.organization,
        organizationUnit: deal.organizationUnit,
        primaryContactName: contactName || null,
        ...summary,
      };
    })
    .filter(Boolean);
}
