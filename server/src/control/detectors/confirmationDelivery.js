import { registerIssueType } from '../registry.js';
import { registerDetector } from '../sweepWorker.js';
import { raiseIssue, resolveMissing } from '../issueService.js';

// Confirmation email failed AFTER the queue accepted it — the last silent gap
// in the WON chain. Pre-queue blocks raise a confirmation review card
// (confirmation/wonHook.js); but once a ScheduledEmail row exists, the worker
// owns delivery, and a terminal 'failed' (6 attempts exhausted) used to leave
// only ScheduledEmail.failureReason — no card, no feed event, an operator had
// to open the send archive to notice. This detector closes that: a deal whose
// LATEST confirmation send terminally failed is surfaced within one sweep.
//
// Auto-resolve: a later successful (or newly queued/pending) send for the same
// deal replaces the latest-send verdict, so the issue closes on the next sweep.
// Operator-cancelled rows are a decision, not a failure — ignored.

const TYPE = 'confirmation_email_delivery_failed';

// Look-back bound: terminal failures older than this are history, not an
// actionable queue state (and the sweep must stay cheap).
const LOOKBACK_DAYS = 14;

const dedupeKey = (dealId) => `${TYPE}:${dealId}`;

registerDetector({
  key: 'confirmation-email-delivery-failed',
  async run(client) {
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
    const latestByDeal = new Map();
    for (const s of sends) {
      if (s.recipientSnapshot?.test) continue;
      if (!latestByDeal.has(s.dealId)) latestByDeal.set(s.dealId, s);
    }
    const queueIds = [...latestByDeal.values()].map((s) => s.scheduledEmailId);
    const failedRows = queueIds.length
      ? await client.scheduledEmail.findMany({
        where: { id: { in: queueIds }, status: 'failed' },
        select: { id: true, failureReason: true, attemptCount: true },
      })
      : [];
    const failedById = new Map(failedRows.map((r) => [r.id, r]));

    const dealIds = [...latestByDeal.entries()]
      .filter(([, s]) => failedById.has(s.scheduledEmailId))
      .map(([dealId]) => dealId);
    const deals = dealIds.length
      ? await client.deal.findMany({
        where: { id: { in: dealIds } },
        select: { id: true, orderNo: true },
      })
      : [];
    const orderNoById = new Map(deals.map((d) => [d.id, d.orderNo]));

    const present = new Set();
    for (const [dealId, send] of latestByDeal) {
      const failed = failedById.get(send.scheduledEmailId);
      if (!failed) continue;
      present.add(dedupeKey(dealId));
      const orderNo = orderNoById.get(dealId) ?? null;
      const recipient = send.recipientSnapshot?.name || send.recipientSnapshot?.email || '';
      await raiseIssue(client, {
        type: TYPE,
        severity: 'warning',
        sourceModule: 'deals',
        dedupeKey: dedupeKey(dealId),
        title: `מייל אישור נכשל בשליחה — ${recipient}${orderNo ? ` (#${orderNo})` : ''}`,
        explanation:
          'מייל האישור נכנס לתור אך השליחה בפועל נכשלה סופית (כל הניסיונות מוצו). ' +
          `הלקוח לא קיבל את המייל. ${failed.failureReason ? `סיבת הכשל: ${failed.failureReason}. ` : ''}` +
          'פתחו את הדיל ושלחו שוב מהתצוגה המקדימה.',
        entityRefs: [{ type: 'deal', id: dealId, orderNo, label: recipient || 'לקוח' }],
        data: {
          dealId,
          dealOrderNo: orderNo,
          scheduledEmailId: send.scheduledEmailId,
          failureReason: failed.failureReason || null,
          attemptCount: failed.attemptCount,
        },
      });
    }
    await resolveMissing(client, TYPE, present);
  },
});

registerIssueType(TYPE, {
  labelHe: 'מייל אישור נכשל בשליחה',
  purposeHe:
    'מייל אישור שנכנס לתור אך נכשל סופית מול Gmail משאיר לקוח סגור-מסחרית בלי המייל שלו — בלי איתות בשום מסך.',
  fixHe: 'נסגר אוטומטית כששליחה חדשה יוצאת לאותו דיל (שליחה חוזרת מהתצוגה המקדימה).',
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
    const { dealId, scheduledEmailId } = issue.data || {};
    if (!dealId || !scheduledEmailId) return false;
    // Still the latest send for the deal AND still failed?
    const latest = await client.confirmationEmailSend.findFirst({
      where: { dealId },
      orderBy: { createdAt: 'desc' },
      select: { scheduledEmailId: true },
    });
    if (!latest || latest.scheduledEmailId !== scheduledEmailId) return false;
    const row = await client.scheduledEmail.findUnique({
      where: { id: scheduledEmailId },
      select: { status: true },
    });
    return row?.status === 'failed';
  },
});
