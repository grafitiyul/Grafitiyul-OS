// THE summary derivation for the Collection screen — one pure function that
// turns the RENDERED rows into the header cards.
//
// Why this file exists: the cards used to keep three hardcoded counters
// (unpaid / partial / review) while the canonical resolver has six statuses.
// A rendered deal whose status was no_amount fell into no bucket, so the queue
// showed 88 rows and the cards summed to 87 — a lie by omission. Production
// case: #24412, a future-tour deal that was never priced.
//
// The fix is structural, not a wider hardcoded list: buckets are built by
// GROUPING on whatever status each row actually carries, with a fallback bucket
// for anything unrecognised. Every row lands in exactly one bucket, so
// Σ buckets === rows.length by construction — a new status in the resolver can
// change labels, never the arithmetic.

// Canonical display order. Statuses outside this list still get a bucket (at
// the end) — order is presentation, membership is not.
export const SUMMARY_STATUS_ORDER = ['unpaid', 'partial', 'review', 'no_amount', 'overpaid', 'paid'];

export const UNKNOWN_STATUS = 'unknown';

/**
 * @param rows the rows the table is actually rendering (already filtered)
 * @returns {{ count: number, balanceMinor: number, buckets: Array<{status, count}> }}
 *          buckets are mutually exclusive and jointly exhaustive over `rows`.
 */
export function summarizeCollectionRows(rows) {
  const list = rows || [];
  const byStatus = new Map();
  let balanceMinor = 0;
  for (const r of list) {
    // Outstanding money only — an overpaid deal's negative balance is not
    // "less to collect" on some other deal.
    balanceMinor += Math.max(0, Number(r.balanceMinor || 0));
    const status = typeof r.status === 'string' && r.status ? r.status : UNKNOWN_STATUS;
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
  }

  const buckets = [];
  for (const status of SUMMARY_STATUS_ORDER) {
    if (byStatus.has(status)) {
      buckets.push({ status, count: byStatus.get(status) });
      byStatus.delete(status);
    }
  }
  // Anything the order list does not know about — including the unknown
  // fallback — still gets counted, at the end. Nothing can be dropped.
  for (const [status, count] of byStatus) buckets.push({ status, count });

  return { count: list.length, balanceMinor, buckets };
}
