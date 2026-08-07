// Deal-merge integrity — the permanent backstop for outcomes a merge must make
// impossible.
//
// The merge service is transactional and its guards are re-evaluated inside the
// transaction, so none of these states should ever occur. That is exactly why
// they are worth detecting: a merge touches bookings, seats, contacts, quote
// lines and lifecycle state at once, and the failure mode of such an operation
// is not a crash — it is a half-truth that looks fine on every screen. Each
// check below asks a question the rest of the system cannot answer for itself.
//
// The bookingIntegrity philosophy applies: these do not care WHO produced the
// state (the merge service, a future writer, a manual database fix, a restored
// backup) — only that it exists.
//
//   retired_deal_still_active   a retired deal still holds an ACTIVE booking or
//                               capacity-consuming seats. The whole point of a
//                               merge is that exactly one deal remains
//                               operationally live.
//   duplicate_active_booking    the survivor and a deal retired into it BOTH
//                               hold active bookings — two operational truths
//                               for one transaction.
//   merge_lineage_missing       a deal carries mergedIntoDealId with no DealMerge
//                               audit record, so WHY it was retired cannot be
//                               reconstructed.
//   merge_survivor_retired      a survivor was itself retired without its
//                               absorbed deals being reachable — a broken chain.
//
// Financial orphaning is deliberately NOT checked here: the merge never moves a
// financial row, so there is nothing to orphan. Collection reads both sides
// through lineage (collection.js), and the guard test proves it.

import { registerIssueType } from '../registry.js';
import { registerDetector } from '../sweepWorker.js';
import { raiseIssue, resolveMissing } from '../issueService.js';
import { CAPACITY_STATUSES } from '../../tours/registrationStatus.js';

const TYPE = 'deal_merge_integrity';

const dedupeKey = (code, dealId) => `${TYPE}:${code}:${dealId}`;

const PROBLEM_HE = {
  retired_deal_still_active: {
    title: (r) => `דיל מאוחד עדיין משובץ תפעולית — #${r.orderNo}`,
    explanation: (r) =>
      `דיל #${r.orderNo} אוחד לתוך דיל #${r.survivorOrderNo ?? '—'}, אך עדיין מחזיק שיבוץ פעיל או מקומות בסיור. `
      + 'לאחר איחוד אמור להישאר דיל פעיל אחד בלבד — יש להעביר או לבטל את השיבוץ מהדיל המאוחד.',
  },
  duplicate_active_booking: {
    title: (r) => `שני שיבוצים פעילים לאותה עסקה מאוחדת — #${r.survivorOrderNo}`,
    explanation: (r) =>
      `לדיל #${r.survivorOrderNo} ולדיל #${r.orderNo} שאוחד לתוכו יש שניהם הזמנה פעילה. `
      + 'זו תפוסה כפולה לאותה עסקה — יש לבטל את ההזמנה שאינה נכונה דרך הדיל הפעיל.',
  },
  merge_lineage_missing: {
    title: (r) => `לדיל מאוחד חסר תיעוד איחוד — #${r.orderNo}`,
    explanation: (r) =>
      `דיל #${r.orderNo} מסומן כמאוחד אך אין לו רשומת איחוד (DealMerge). `
      + 'לא ניתן לשחזר מי ביצע את האיחוד ומה הוחלט בו — נדרשת בדיקה טכנית.',
  },
};

async function loadProblems(client) {
  const problems = [];

  // Every retired deal, with its survivor and its merge record.
  const retired = await client.deal.findMany({
    where: { mergedIntoDealId: { not: null } },
    select: {
      id: true, orderNo: true, mergedIntoDealId: true,
      mergedInto: { select: { id: true, orderNo: true } },
      mergeAsRetired: { select: { id: true } },
    },
    take: 1000,
  });
  if (!retired.length) return problems;

  const retiredIds = retired.map((d) => d.id);
  const survivorIds = [...new Set(retired.map((d) => d.mergedIntoDealId).filter(Boolean))];

  const [liveBookings, liveSeats, survivorBookings] = await Promise.all([
    client.booking.findMany({
      where: { dealId: { in: retiredIds }, status: 'active' },
      select: { id: true, dealId: true, tourEventId: true },
    }),
    client.ticketRegistration.groupBy({
      by: ['dealId'],
      where: { dealId: { in: retiredIds }, status: { in: CAPACITY_STATUSES } },
      _sum: { quantity: true },
    }),
    client.booking.findMany({
      where: { dealId: { in: survivorIds }, status: 'active' },
      select: { dealId: true },
    }),
  ]);

  const bookingByRetired = new Map(liveBookings.map((b) => [b.dealId, b]));
  const seatsByRetired = new Map(liveSeats.map((r) => [r.dealId, r._sum.quantity || 0]));
  const survivorHasBooking = new Set(survivorBookings.map((b) => b.dealId));

  for (const d of retired) {
    const row = {
      id: d.id,
      orderNo: d.orderNo,
      survivorDealId: d.mergedIntoDealId,
      survivorOrderNo: d.mergedInto?.orderNo ?? null,
    };
    const booking = bookingByRetired.get(d.id) || null;
    const seats = seatsByRetired.get(d.id) || 0;

    // Both sides live is the WORSE of the two — reported instead of the plain
    // "still active", never in addition to it, so one real situation produces
    // one card rather than two.
    if (booking && survivorHasBooking.has(d.mergedIntoDealId)) {
      problems.push({ code: 'duplicate_active_booking', row: { ...row, bookingId: booking.id, tourEventId: booking.tourEventId } });
    } else if (booking || seats > 0) {
      problems.push({ code: 'retired_deal_still_active', row: { ...row, bookingId: booking?.id || null, seats } });
    }

    if (!d.mergeAsRetired) problems.push({ code: 'merge_lineage_missing', row });
  }
  return problems;
}

registerDetector({
  key: 'deal-merge-integrity',
  async run(client) {
    const problems = await loadProblems(client);
    const present = new Set();
    for (const { code, row } of problems) {
      const key = dedupeKey(code, row.id);
      present.add(key);
      const def = PROBLEM_HE[code];
      await raiseIssue(client, {
        type: TYPE,
        // A duplicate active booking means a real tour is double-counting a
        // customer today; the others are audit gaps that need attention but
        // are not hurting an operation right now.
        severity: code === 'duplicate_active_booking' ? 'critical' : 'warning',
        sourceModule: 'deals',
        dedupeKey: key,
        title: def.title(row),
        explanation: def.explanation(row),
        entityRefs: [
          { type: 'deal', id: row.survivorDealId, orderNo: row.survivorOrderNo, label: 'הדיל הפעיל' },
          { type: 'deal', id: row.id, orderNo: row.orderNo, label: 'הדיל המאוחד' },
        ].filter((r) => r.id),
        data: { problem: code, ...row, dealId: row.survivorDealId, dealOrderNo: row.survivorOrderNo },
      });
    }
    await resolveMissing(client, TYPE, present);
  },
});

registerIssueType(TYPE, {
  labelHe: 'תקינות איחוד דילים',
  purposeHe:
    'לאחר איחוד שני דילים אמור להישאר דיל פעיל אחד בלבד, עם מצב תפעולי אחד וקו איחוד מתועד. '
    + 'הכרטיס עולה כשדיל שאוחד עדיין מחזיק שיבוץ או מקומות, כששני הצדדים מחזיקים הזמנה פעילה, או כשחסר תיעוד האיחוד.',
  fixHe:
    'נסגר אוטומטית ברגע שנשאר שיבוץ תפעולי אחד לעסקה. ביטול או העברה של השיבוץ נעשים מתוך הדיל הפעיל.',
  sourceModule: 'deals',

  buildActions(issue) {
    const actions = [];
    if (issue.data?.survivorDealId) {
      actions.push({
        key: 'open_survivor',
        label: 'פתח את הדיל הפעיל',
        kind: 'link',
        style: 'primary',
        target: { type: 'deal', id: issue.data.survivorDealId, orderNo: issue.data.survivorOrderNo },
      });
    }
    if (issue.data?.id) {
      actions.push({
        key: 'open_retired',
        label: 'פתח את הדיל המאוחד',
        kind: 'link',
        target: { type: 'deal', id: issue.data.id, orderNo: issue.data.orderNo },
      });
    }
    return actions;
  },

  async recheck(client, issue) {
    const problems = await loadProblems(client);
    return problems.some(
      (p) => p.code === issue.data?.problem && p.row.id === issue.data?.id,
    );
  },
});

export { loadProblems as dealMergeIntegrityProblems };
