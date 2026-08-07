import { registerIssueType } from '../registry.js';
import { registerDetector } from '../sweepWorker.js';
import { raiseIssue, resolveMissing } from '../issueService.js';
import { resolveDeliveries } from '../../email/deliveryState.js';
import { deliverySummaryHe } from '../../../../shared/emailDelivery.mjs';
import { activeDealWhere } from '../../deals/mergeLineage.js';

// Confirmation email failed AFTER the queue accepted it — the last silent gap
// in the WON chain. Pre-queue blocks raise a confirmation review card
// (confirmation/wonHook.js); but once a ScheduledEmail row exists, the worker
// owns delivery, and a terminal 'failed' (6 attempts exhausted) used to leave
// only ScheduledEmail.failureReason — no card, no feed event, an operator had
// to open the send archive to notice. This detector closes that.
//
// THE INVARIANT (deals #27099/#27100, 2026-08-07): the issue resolves ONLY when
// a confirmation genuinely reached the provider — canonical delivery state
// 'sent'. It used to resolve as soon as a NEWER send existed whose queue row
// was not yet 'failed'; so clicking "send again" on a broken address closed the
// card within 60 seconds while the customer still had nothing, and the office
// saw a clean board. Queuing is not delivering.
//
// States, all read through shared/emailDelivery.mjs:
//   sent               → resolved. The only success.
//   failed             → open issue, severity warning, with the real reason.
//   queued / sending   → the send is genuinely in flight. If NOTHING has ever
//                        been delivered for this deal, the issue STAYS OPEN in
//                        an honest "בשליחה" state instead of disappearing.
//   cancelled          → an operator decision, not a failure. Falls back to the
//                        previous verdict for the deal.

const TYPE = 'confirmation_email_delivery_failed';

// Look-back bound: terminal failures older than this are history, not an
// actionable queue state (and the sweep must stay cheap).
const LOOKBACK_DAYS = 14;

const dedupeKey = (dealId) => `${TYPE}:${dealId}`;

// Exported so the invariant can be tested against a fake client — the sweep
// logic IS the guarantee, so it must be reachable without a database.
export async function runConfirmationDeliverySweep(client) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  // Recent real (non-test) confirmation sends, newest first; the FIRST row
  // per deal is that deal's latest verdict.
  const sends = await client.confirmationEmailSend.findMany({
    where: { createdAt: { gte: since }, scheduledEmailId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: {
      dealId: true,
      scheduledEmailId: true,
      subject: true,
      recipientSnapshot: true,
      createdAt: true,
    },
    take: 2000,
  });
  // Every real send per deal, newest first — the whole history matters now,
  // because "has this deal EVER been delivered" is the resolve test (a single
  // latest-row verdict is what let a fresh queue row erase a real failure).
  const byDeal = new Map();
  for (const s of sends) {
    if (s.recipientSnapshot?.test) continue;
    if (!byDeal.has(s.dealId)) byDeal.set(s.dealId, []);
    byDeal.get(s.dealId).push(s);
  }
  const allQueueIds = [...byDeal.values()].flat().map((s) => s.scheduledEmailId);
  const deliveries = await resolveDeliveries(allQueueIds, { db: client });

  // Per deal, decide the honest verdict.
  const verdicts = new Map(); // dealId → { send, delivery }
  for (const [dealId, dealSends] of byDeal) {
    // Delivered even once → nothing to report, ever.
    if (dealSends.some((s) => deliveries.get(s.scheduledEmailId)?.delivered)) continue;
    // The newest send that is not an operator cancellation is the verdict;
    // a cancelled row is a decision, so look past it.
    const relevant = dealSends.find(
      (s) => deliveries.get(s.scheduledEmailId)?.state !== 'cancelled',
    );
    const delivery = relevant ? deliveries.get(relevant.scheduledEmailId) : null;
    if (!delivery) continue;
    // Nothing delivered AND the latest attempt is failed or still in flight.
    if (delivery.state === 'failed' || delivery.inFlight) {
      verdicts.set(dealId, { send: relevant, delivery });
    }
  }

  // Retired-by-merge deals are excluded here, which is also what SUPPRESSES the
  // card: a deal missing from this lookup is skipped below. Its confirmation
  // history stays on it and is visible through the survivor's merged timeline —
  // but an operator can no longer act on it, so a card demanding action would
  // be a task nobody can complete.
  const deals = verdicts.size
    ? await client.deal.findMany({
      where: activeDealWhere({ id: { in: [...verdicts.keys()] } }),
      select: { id: true, orderNo: true },
    })
    : [];
  const orderNoById = new Map(deals.map((d) => [d.id, d.orderNo]));

  const present = new Set();
  for (const [dealId, { send, delivery }] of verdicts) {
    if (!orderNoById.has(dealId)) continue;
    present.add(dedupeKey(dealId));
    const orderNo = orderNoById.get(dealId) ?? null;
    const recipient = send.recipientSnapshot?.name || send.recipientSnapshot?.email || '';
    const failed = delivery.state === 'failed';
    await raiseIssue(client, {
      type: TYPE,
      // In flight is not yet a problem — it is a "not done" the office should
      // still see, because nothing has reached this customer.
      severity: failed ? 'warning' : 'info',
      sourceModule: 'deals',
      dedupeKey: dedupeKey(dealId),
      title: failed
        ? `מייל אישור נכשל בשליחה — ${recipient}${orderNo ? ` (#${orderNo})` : ''}`
        : `מייל אישור ממתין לשליחה — ${recipient}${orderNo ? ` (#${orderNo})` : ''}`,
      explanation: failed
        ? `${deliverySummaryHe(delivery)}. פתחו את הדיל ושלחו שוב מהתצוגה המקדימה.`
        : `${deliverySummaryHe(delivery)}. הכרטיס ייסגר מעצמו ברגע ש-Gmail יאשר את השליחה.`,
      entityRefs: [{ type: 'deal', id: dealId, orderNo, label: recipient || 'לקוח' }],
      data: {
        dealId,
        dealOrderNo: orderNo,
        scheduledEmailId: send.scheduledEmailId,
        deliveryState: delivery.state,
        failureReason: delivery.failureReason || null,
        attemptCount: delivery.attemptCount,
      },
    });
  }
  await resolveMissing(client, TYPE, present);
}

registerDetector({
  key: 'confirmation-email-delivery-failed',
  run: runConfirmationDeliverySweep,
});

registerIssueType(TYPE, {
  labelHe: 'מייל אישור טרם הגיע ללקוח',
  purposeHe:
    'מייל אישור שנכנס לתור אך לא הגיע בפועל ל-Gmail משאיר לקוח סגור-מסחרית בלי המייל שלו — בלי איתות בשום מסך.',
  fixHe: 'נסגר אוטומטית רק כששליחה לאותו דיל מאושרת בפועל מול Gmail — הכנסה לתור אינה סגירה.',
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

  // Same invariant as the sweep: the issue stands until a confirmation for this
  // deal has genuinely been DELIVERED. A newer queued send does not clear it.
  async recheck(client, issue) {
    const { dealId } = issue.data || {};
    if (!dealId) return false;
    const sends = await client.confirmationEmailSend.findMany({
      where: { dealId, scheduledEmailId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { scheduledEmailId: true, recipientSnapshot: true },
    });
    const real = sends.filter((s) => !s.recipientSnapshot?.test);
    if (!real.length) return false;
    const deliveries = await resolveDeliveries(
      real.map((s) => s.scheduledEmailId),
      { db: client },
    );
    // Delivered once → the issue is genuinely answered.
    if (real.some((s) => deliveries.get(s.scheduledEmailId)?.delivered)) return false;
    const relevant = real.find(
      (s) => deliveries.get(s.scheduledEmailId)?.state !== 'cancelled',
    );
    const delivery = relevant ? deliveries.get(relevant.scheduledEmailId) : null;
    return !!delivery && (delivery.state === 'failed' || delivery.inFlight);
  },
});
