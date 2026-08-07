// The two operator-facing outcomes of a conversion that need a human.
//
// Both are POST-COMMIT and fire-and-forget: the conversion itself already
// succeeded, and neither of these may ever turn a successful conversion into a
// reported failure. They are separated from activityConversion.js so that
// module stays the state machine and this one owns the wording.

import { prisma as defaultPrisma } from '../db.js';
import { createReviewItem } from '../reviewItems/service.js';
import {
  CONVERSION_OVERPAYMENT_KIND,
  conversionOverpaymentKey,
} from '../reviewItems/kinds/conversionOverpayment.js';
import {
  CONVERSION_RECOVERY_KIND,
  conversionRecoveryKey,
} from '../reviewItems/kinds/conversionRecovery.js';
import { dealCollection } from '../collection.js';
import { GENERIC_CUSTOMER_HE } from '../displayFallbacks.js';

// Canonical customer wording: organization → primary contact → generic.
// NEVER Deal.title — internal CRM wording must not leave the CRM (CLAUDE.md §17).
function customerLabelFor(deal) {
  if (deal?.organization?.name) return deal.organization.name;
  const c = deal?.contacts?.[0]?.contact;
  const name =
    [c?.firstNameHe, c?.lastNameHe].filter(Boolean).join(' ').trim()
    || [c?.firstNameEn, c?.lastNameEn].filter(Boolean).join(' ').trim();
  return name || GENERIC_CUSTOMER_HE;
}

const CUSTOMER_SELECT = {
  id: true,
  orderNo: true,
  valueMinor: true,
  currency: true,
  collectionReview: true,
  organization: { select: { name: true } },
  contacts: {
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    take: 1,
    select: {
      contact: {
        select: { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true },
      },
    },
  },
};

const shekels = (minor, currency = 'ILS') => {
  const sign = currency === 'ILS' ? '₪' : `${currency} `;
  return `${sign}${(Math.abs(Number(minor) || 0) / 100).toLocaleString('he-IL')}`;
};

/**
 * Raise the overpayment card — but ONLY when the money really is overpaid.
 *
 * The verdict comes from computeCollection, the one place the balance is
 * derived; nothing here re-implements the arithmetic, and nothing here writes
 * to any accounting table. A conversion that leaves the customer owing money,
 * or exactly square, produces no card at all.
 *
 * Returns the created item or null. Never throws.
 */
export async function raiseConversionOverpayment({ dealId }, { db = defaultPrisma, log = console } = {}) {
  try {
    const deal = await db.deal.findUnique({ where: { id: dealId }, select: CUSTOMER_SELECT });
    if (!deal) return null;

    const money = await dealCollection(db, deal);
    if (money.status !== 'overpaid') return null;

    const overpaidMinor = Math.abs(Number(money.balanceMinor) || 0);
    if (!overpaidMinor) return null;

    const customer = customerLabelFor(deal);
    const { item } = await createReviewItem(
      {
        kind: CONVERSION_OVERPAYMENT_KIND,
        dedupeKey: conversionOverpaymentKey(dealId, overpaidMinor),
        title: `יתרת זכות של ${shekels(overpaidMinor, money.currency)} — ${customer}`,
        summary:
          `לאחר שינוי סוג הפעילות, הסכום ששולם (${shekels(money.paidMinor, money.currency)}) `
          + `גבוה מהסכום הנוכחי של הדיל (${shekels(money.totalMinor, money.currency)}). `
          + 'לא הופק זיכוי ולא בוצע החזר — נדרשת החלטה.',
        data: {
          orderNo: deal.orderNo,
          overpaidMinor,
          totalMinor: money.totalMinor,
          paidMinor: money.paidMinor,
          currency: money.currency,
        },
        entityRefs: [{ type: 'deal', id: dealId, orderNo: deal.orderNo, label: customer }],
        dealId,
      },
      { db },
    );
    return item;
  } catch (err) {
    log.error(`[conversion] overpayment card failed for ${dealId}: ${err?.message || err}`);
    return null;
  }
}

const EFFECT_LABELS_HE = {
  calendar: 'סנכרון יומן Google',
  woo: 'עדכון מלאי בחנות',
  payroll: 'חישוב שכר מחדש',
  deliveries: 'התאמת מסרים מתוזמנים',
};

/**
 * Raise the recovery card for a conversion whose external effects did not all
 * complete. Carries the ids the retry endpoint needs, so finishing the job is
 * one click and not an investigation.
 *
 * Never throws.
 */
export async function raiseConversionRecovery(
  { dealId, opId, oldTourEventId, newTourEventId, deliveryIds = [], effects },
  { db = defaultPrisma, log = console } = {},
) {
  try {
    const deal = await db.deal.findUnique({ where: { id: dealId }, select: CUSTOMER_SELECT });
    if (!deal) return null;

    const outstanding = [
      ...(!effects?.calendar ? ['calendar'] : []),
      ...(!effects?.woo ? ['woo'] : []),
      ...(!effects?.payroll ? ['payroll'] : []),
      ...(effects?.deliveries?.failed ? ['deliveries'] : []),
    ];
    if (!outstanding.length) return null;

    const customer = customerLabelFor(deal);
    const { item } = await createReviewItem(
      {
        kind: CONVERSION_RECOVERY_KIND,
        // opId is the conversion's identity; without one (a manual retry path)
        // fall back to the deal so the card is still exactly-once per deal.
        dedupeKey: conversionRecoveryKey(opId || `deal:${dealId}`),
        title: `להשלים סנכרון לאחר שינוי סוג פעילות — ${customer}`,
        summary:
          'שינוי סוג הפעילות הושלם ונשמר. לא הושלמו: '
          + outstanding.map((k) => EFFECT_LABELS_HE[k]).join(', ')
          + '. אפשר להריץ שוב מהדיל — הפעולה בטוחה לחזרה.',
        data: {
          orderNo: deal.orderNo,
          outstanding,
          oldTourEventId,
          newTourEventId,
          deliveryIds,
        },
        entityRefs: [
          { type: 'deal', id: dealId, orderNo: deal.orderNo, label: customer },
          ...(newTourEventId ? [{ type: 'tour_event', id: newTourEventId, label: 'סיור' }] : []),
        ],
        dealId,
        tourEventId: newTourEventId || null,
      },
      { db },
    );
    return item;
  } catch (err) {
    log.error(`[conversion] recovery card failed for ${dealId}: ${err?.message || err}`);
    return null;
  }
}
