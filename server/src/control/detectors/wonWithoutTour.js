import { registerIssueType } from '../registry.js';
import { registerDetector } from '../sweepWorker.js';
import { raiseIssue, resolveMissing } from '../issueService.js';
import { wonGate } from '../../tours/tourFromDeal.js';
import { liveWonObligationWhere } from '../../deals/wonRecovery.js';
import { GENERIC_CUSTOMER_HE } from '../../displayFallbacks.js';

// WON deal without an operational tour — the safety-net for production #27074:
// a payment closed the deal (the money is real, the customer believes they are
// registered) but no TourEvent/Booking exists, so operationally NOTHING is
// scheduled. The bookingIntegrity philosophy: this detector does not care WHO
// produced the state (payment webhook, Cardcom, IPN, manual button, a future
// writer) — only that it exists, so any path in is surfaced within one sweep.
//
// Scope guard: only deals whose obligation is still LIVE (the shared rule in
// deals/wonRecovery.js — future tour date, or dateless but recently won).
// Hundreds of legacy-migrated WON deals are history, not emergencies —
// flooding the dashboard with those would bury the real incident.
//
// Auto-resolve: the sweep closes the issue the moment an active booking
// exists; the recovery endpoint (deals/complete-tour-setup) also resolves it
// inline in the same commit that creates the tour.

const TYPE = 'won_deal_without_tour';

const dedupeKey = (dealId) => `${TYPE}:${dealId}`;

// Customer wording: organization → contact → generic. NEVER Deal.title (the
// internal-CRM-wording invariant) — and the label here also feeds entityRefs.
function customerLabelFor(deal) {
  if (deal.organization?.name) return deal.organization.name;
  const c = deal.contacts?.[0]?.contact;
  const name = [c?.firstNameHe, c?.lastNameHe].filter(Boolean).join(' ').trim()
    || [c?.firstNameEn, c?.lastNameEn].filter(Boolean).join(' ').trim();
  return name || GENERIC_CUSTOMER_HE;
}

function buildPayload(deal) {
  const gate = wonGate(deal, null);
  const label = customerLabelFor(deal);
  const missingLabels = gate.missing.map((m) => m.labelHe);
  const what = deal.activityType === 'group' && !gate.missing.length
    ? 'נדרש שיבוץ לסיור קבוצתי'
    : missingLabels.length
      ? `חסרים פרטי תכנון: ${missingLabels.join(', ')}`
      : 'כל הפרטים קיימים — נדרשת יצירת הסיור';
  return {
    type: TYPE,
    severity: 'critical',
    sourceModule: 'deals',
    dedupeKey: dedupeKey(deal.id),
    title: `דיל WON ללא סיור משובץ — ${label}${deal.orderNo ? ` (#${deal.orderNo})` : ''}`,
    explanation:
      'העסקה נסגרה (WON) אך לא קיים סיור משובץ — הלקוח סגור מסחרית בעוד שתפעולית שום דבר אינו מתוכנן. ' +
      `${what}. פתחו את הדיל והשתמשו בפעולה "השלם פרטי סיור וצור סיור".`,
    entityRefs: [{ type: 'deal', id: deal.id, orderNo: deal.orderNo, label }],
    data: {
      dealId: deal.id,
      dealOrderNo: deal.orderNo,
      missing: gate.missing,
      needsSlot: gate.needsSlot,
      tourDate: deal.tourDate || null,
    },
  };
}

// The deal shape both the sweep and recheck read: gate fields + label sources.
const DETECTOR_SELECT = {
  id: true,
  orderNo: true,
  status: true,
  activityType: true,
  productId: true,
  productVariantId: true,
  locationId: true,
  tourDate: true,
  tourTime: true,
  participants: true,
  tourLanguage: true,
  organization: { select: { name: true } },
  contacts: {
    select: {
      contact: {
        select: { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true },
      },
    },
    orderBy: { isPrimary: 'desc' },
    take: 1,
  },
};

registerDetector({
  key: 'won-deal-without-tour',
  async run(client) {
    const deals = await client.deal.findMany({
      where: liveWonObligationWhere(),
      select: DETECTOR_SELECT,
      take: 1000,
    });
    const present = new Set();
    for (const deal of deals) {
      present.add(dedupeKey(deal.id));
      await raiseIssue(client, buildPayload(deal));
    }
    await resolveMissing(client, TYPE, present);
  },
});

registerIssueType(TYPE, {
  labelHe: 'דיל WON ללא סיור משובץ',
  purposeHe:
    'עסקה שנסגרה (WON) חייבת להפוך לסיור תפעולי. אם התשלום סגר את העסקה לפני שפרטי הסיור הושלמו — הלקוח מאמין שהוא רשום בעוד ששום סיור אינו קיים.',
  fixHe:
    'נסגר אוטומטית כשנוצר סיור לדיל — דרך "השלם פרטי סיור וצור סיור" בעמוד הדיל.',
  sourceModule: 'deals',

  buildActions(issue) {
    return [
      {
        key: 'open_deal',
        label: 'פתח דיל',
        kind: 'link',
        style: 'primary',
        target: { type: 'deal', id: issue.data?.dealId, orderNo: issue.data?.dealOrderNo },
      },
    ];
  },

  async recheck(client, issue) {
    const dealId = issue.data?.dealId;
    if (!dealId) return false;
    const deal = await client.deal.findFirst({
      where: { id: dealId, ...liveWonObligationWhere() },
      select: { id: true },
    });
    return !!deal;
  },
});
