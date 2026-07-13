import { raiseIssue } from '../control/issueService.js';
import { registerIssueType } from '../control/registry.js';
import { CAPACITY_STATUSES } from './registrationStatus.js';

// Canonical tour-change IMPACT record. Any operational change that affects
// already-registered occurrences (a rule/exception edit, a manual move/cancel,
// a capacity cut) emits ONE of these — a first-class OperationalIssue, NOT an
// inline warning — so Part 4 (requirements + customer notifications) has a
// stable thing to attach to. Dedup identity is (tourEvent, impactType): repeated
// reconciliation UPDATES the same open issue; the before/after revision travels
// in `data` so a materially different change is visible.
//
// This is deliberately event-emitted (no sweep detector), so resolveMissing
// never auto-closes it — an impact issue closes only through the Part 4
// resolution rules (all customers notified / reverted / manually handled).

export const IMPACT_TYPE = 'tour_change_impact';

const SEVERITY = { capacity_below_occupancy: 'critical', tour_cancelled: 'critical' };

function fmtWhen(date, startTime) {
  if (!date) return 'ללא תאריך';
  const [y, m, d] = String(date).split('-');
  return `${d}.${m}.${y}${startTime ? ' ' + startTime : ''}`;
}

const REASON_HE = {
  tour_time_changed: 'מועד הסיור שונה',
  tour_cancelled: 'הסיור בוטל',
  tour_moved: 'הסיור הועבר למועד אחר',
  capacity_below_occupancy: 'הקיבולת הופחתה מתחת לתפוסה הנוכחית',
};

// Load the active/held registrations (the seat-holding customers) for a tour,
// with the identity available for notification.
async function affectedRegistrations(client, tourEventId) {
  const regs = await client.ticketRegistration.findMany({
    where: { tourEventId, status: { in: CAPACITY_STATUSES } },
    select: {
      id: true, status: true, quantity: true, dealId: true,
      customerName: true, customerEmail: true, customerPhone: true,
      deal: { select: { id: true, orderNo: true, title: true, contactName: true, contactEmail: true, contactPhone: true } },
    },
  });
  return regs.map((r) => ({
    registrationId: r.id,
    status: r.status,
    quantity: r.quantity,
    dealId: r.dealId,
    dealOrderNo: r.deal?.orderNo ?? null,
    name: r.customerName || r.deal?.contactName || r.deal?.title || null,
    email: r.customerEmail || r.deal?.contactEmail || null,
    phone: r.customerPhone || r.deal?.contactPhone || null,
  }));
}

// Emit (upsert) the canonical impact record. Returns the issue, or null when
// there is nothing to act on (no affected customers for a customer-impact type).
export async function emitTourChangeImpact(client, { tourEventId, impactType, before, after, note }) {
  const customers = await affectedRegistrations(client, tourEventId);
  const affectedCount = customers.reduce((n, c) => n + (c.quantity || 1), 0);
  // Customer-impact types are only worth an issue when customers are affected.
  const customerImpact = impactType !== 'capacity_below_occupancy';
  if (customerImpact && !customers.length) return null;

  const whatChanged = REASON_HE[impactType] || 'שינוי בסיור';
  const beforeStr = fmtWhen(before?.date, before?.startTime);
  const afterStr = fmtWhen(after?.date, after?.startTime);
  const revision = `${beforeStr}→${afterStr}`;

  const issue = await raiseIssue(client, {
    type: IMPACT_TYPE,
    severity: SEVERITY[impactType] || 'warning',
    sourceModule: 'tours',
    dedupeKey: `${IMPACT_TYPE}:${impactType}:${tourEventId}`,
    title: `${whatChanged} — ${afterStr}`,
    explanation:
      `${whatChanged}. ${customers.length ? `${customers.length} לקוחות רשומים עשויים להזדקק לעדכון.` : ''} ` +
      (impactType === 'capacity_below_occupancy' ? 'יש לבדוק תפוסה מול קיבולת.' : 'ניתן לעדכן את הלקוחות מכאן.'),
    entityRefs: [
      { type: 'tour_event', id: tourEventId, label: afterStr },
      ...customers.filter((c) => c.dealId).map((c) => ({ type: 'deal', id: c.dealId, orderNo: c.dealOrderNo, label: c.name || 'דיל' })),
    ],
    data: {
      tourEventId,
      impactType,
      revision,
      before: before || null,
      after: after || null,
      whatChanged,
      requiredAction: customerImpact ? 'notify_customers' : 'review_capacity',
      affectedCount,
      customers, // name/phone/email/status per registration
    },
  });
  return issue;
}

// Minimal registration so the dashboard renders it. Part 4 replaces buildActions
// with the full "עדכן לקוחות" flow + requirement-driven resolution. Event-emitted
// (no detector) → never auto-resolved by the sweep.
registerIssueType(IMPACT_TYPE, {
  sourceModule: 'tours',
  buildActions(issue) {
    return [{ key: 'open_tour', label: 'פתח סיור', kind: 'link', target: { type: 'tour_event', id: issue.data?.tourEventId } }];
  },
});
