import { registerIssueType } from '../registry.js';
import { registerDetector } from '../sweepWorker.js';
import { raiseIssue, resolveMissing } from '../issueService.js';
import { reconcileCardcomRequest } from '../../touristPayment.js';

// Cardcom tourist payment stuck in verification — a customer returned from the
// hosted payment page (payment_returned) but neither the webhook nor
// reconciliation resolved it within the grace window, OR verification found a
// mismatch (verifyHold: amount/currency/canceled-request money). The customer
// already saw "your payment is being verified", so a stall here is invisible
// everywhere else — exactly the silent-failure class בקרה exists for.
//
// The sweep ALSO drives reconciliation: every tick it re-verifies stuck
// requests against Cardcom (GetLpResult, rate-limited per request via
// lastVerifyAt), so a lost webhook converges automatically even if the
// customer closed the waiting page. Money decisions stay in touristPayment.js —
// this file only retries + surfaces.

const TYPE = 'cardcom_verification_stuck';
const STUCK_AFTER_MS = 10 * 60 * 1000; // returned but unresolved → issue
const SWEEP_VERIFY_MIN_INTERVAL_MS = 5 * 60 * 1000; // provider re-checks from the sweep
const dedupeKey = (requestId) => `${TYPE}:${requestId}`;

function buildPayload(req) {
  const amount = `${Number(req.amountMinor) / 100} ${req.currency}`;
  const who = req.customerName || 'לקוח';
  const held = !!req.verifyHold;
  return {
    type: TYPE,
    severity: held ? 'critical' : 'warning',
    sourceModule: 'payments',
    dedupeKey: dedupeKey(req.id),
    title: held
      ? `תשלום קארדקום דורש בדיקה ידנית — ${who} (${amount})`
      : `תשלום קארדקום ממתין לאימות זמן רב — ${who} (${amount})`,
    explanation: held
      ? `אימות מול קארדקום מצא אי-התאמה (${req.verifyHold}). הבקשה לא סומנה כשולמה אוטומטית — נדרשת הכרעה ידנית מול קארדקום/iCount.`
      : `הלקוח חזר מדף התשלום של קארדקום אך התשלום לא אומת (אין webhook ואימות יזום לא הכריע). ייתכן תשלום אמיתי שלא נקלט — אין לשלוח קישור תשלום נוסף לפני בירור.`,
    entityRefs: [{ type: 'deal', id: req.dealId, orderNo: req.deal?.orderNo, label: `דיל #${req.deal?.orderNo ?? ''}` }],
    data: {
      requestId: req.id,
      dealId: req.dealId,
      dealOrderNo: req.deal?.orderNo ?? null,
      status: req.status,
      verifyHold: req.verifyHold || null,
      attemptNo: req.attemptNo ?? 1,
      lowProfileId: req.cardcomLowProfileId || null,
      returnedAt: req.returnedAt,
      webhookAt: req.webhookAt,
      lastVerifyAt: req.lastVerifyAt,
    },
  };
}

registerDetector({
  key: 'cardcom-verification',
  async run(client) {
    const returnedCutoff = new Date(Date.now() - STUCK_AFTER_MS);
    const verifyCutoff = new Date(Date.now() - SWEEP_VERIFY_MIN_INTERVAL_MS);
    const candidates = await client.paymentRequest.findMany({
      where: {
        provider: 'cardcom',
        OR: [
          { verifyHold: { not: null } },
          { status: 'payment_returned', returnedAt: { lt: returnedCutoff } },
        ],
      },
      orderBy: { returnedAt: 'asc' },
      take: 100,
      include: { deal: { select: { orderNo: true } } },
    });

    const present = new Set();
    for (const req of candidates) {
      // Sweep-driven reconciliation for unresolved (non-held) returns: one
      // provider re-check per 5 minutes per request, then re-read the outcome.
      let current = req;
      if (!req.verifyHold && req.status === 'payment_returned' && (!req.lastVerifyAt || req.lastVerifyAt < verifyCutoff)) {
        await reconcileCardcomRequest(client, req, {});
        current = await client.paymentRequest.findUnique({
          where: { id: req.id },
          include: { deal: { select: { orderNo: true } } },
        });
        if (!current) continue;
      }
      const stillStuck = !!current.verifyHold || (current.status === 'payment_returned' && current.returnedAt && current.returnedAt < returnedCutoff);
      if (!stillStuck) continue;
      present.add(dedupeKey(current.id));
      await raiseIssue(client, buildPayload(current));
    }
    await resolveMissing(client, TYPE, present);
  },
});

registerIssueType(TYPE, {
  labelHe: 'תשלום קארדקום ממתין לאימות',
  purposeHe:
    'לקוח חזר מדף תשלום קארדקום אבל התשלום לא אומת בזמן סביר, או שאימות מצא אי-התאמה בסכום/מטבע. ייתכן כסף אמיתי שטרם נקלט — אסור לגבות שוב לפני בירור.',
  fixHe: 'נסגר אוטומטית כשהתשלום מאומת (שולם/נכשל). באי-התאמה — לברר מול קארדקום ולטפל ידנית בדיל.',
  sourceModule: 'payments',
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
    const req = await client.paymentRequest.findUnique({
      where: { id: issue.data?.requestId },
      select: { status: true, verifyHold: true, returnedAt: true },
    });
    if (!req) return false;
    return !!req.verifyHold || req.status === 'payment_returned';
  },
});
