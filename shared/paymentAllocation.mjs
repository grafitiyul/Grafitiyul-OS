// THE allocation arithmetic — pure, shared by the server service and the
// allocation dialog so the operator's running totals and the persisted state
// can never disagree by a rounding rule.
//
// ── The one invariant this file exists to protect ────────────────────────────
//
//   ALLOCATION IS NOT PAYMENT.
//
// `realMinor` is the money that actually moved. `allocatedMinor` is the sum of
// the internal decisions about which deals it settles. They are allowed to
// disagree — an operator mid-reconciliation is a normal state, not an error —
// and when they do, the difference is reported, never absorbed:
//
//   allocated <  real   → `unallocatedMinor`   (money not yet attributed)
//   allocated >  real   → `overAllocatedMinor` (deals credited beyond the money)
//
// Neither number ever changes `realMinor`. Company revenue is always the real
// payment; an over-allocation is a bookkeeping discrepancy to resolve, never
// ₪200 of phantom income.

// Per-deal VAT rounding can leave a few agorot; ten agorot is the same
// tolerance collection.js applies to a deal balance, kept identical on purpose
// so a deal that reads "settled" there cannot read "unallocated" here.
export const ALLOCATION_TOLERANCE_MINOR = 10;

const toMinor = (v) => {
  const n = typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/**
 * Reconcile a real payment against its per-deal allocations.
 *
 * @param realMinor    the money the payment/document actually moved
 * @param allocations  [{ dealId, amountMinor }] — one entry per deal
 * @returns {{
 *   realMinor, allocatedMinor, unallocatedMinor, overAllocatedMinor,
 *   balanced, state, dealCount
 * }}
 *
 * `state` is the single word every surface renders from:
 *   'balanced'      allocations match the money (within tolerance)
 *   'unallocated'   money is left over
 *   'over'          deals are credited with more than arrived
 *   'empty'         nothing allocated yet
 */
export function reconcileAllocations(realMinor, allocations = []) {
  const real = Math.abs(toMinor(realMinor));
  const rows = (allocations || []).filter((a) => a && a.dealId);
  const allocated = rows.reduce((sum, a) => sum + Math.abs(toMinor(a.amountMinor)), 0);
  const diff = allocated - real;

  let state;
  if (!rows.length) state = 'empty';
  else if (diff > ALLOCATION_TOLERANCE_MINOR) state = 'over';
  else if (diff < -ALLOCATION_TOLERANCE_MINOR) state = 'unallocated';
  else state = 'balanced';

  return {
    realMinor: real,
    allocatedMinor: allocated,
    // Reported as POSITIVE magnitudes; the direction lives in `state`, so a
    // caller can never accidentally add an over-allocation to a balance.
    unallocatedMinor: state === 'unallocated' ? real - allocated : 0,
    overAllocatedMinor: state === 'over' ? allocated - real : 0,
    balanced: state === 'balanced',
    state,
    dealCount: rows.length,
  };
}

/**
 * The allocation an operator would expect the dialog to open with: give each
 * deal what it still owes, in the order the deals were selected, until the
 * money runs out. Deliberately NEVER over-allocates on its own — a proposal
 * that credits more than arrived would have to be a human's explicit decision.
 *
 * @param realMinor  money available
 * @param deals      [{ dealId, remainingMinor }] in operator-chosen order
 */
export function proposeAllocations(realMinor, deals = []) {
  let left = Math.abs(toMinor(realMinor));
  return (deals || []).map((d) => {
    const want = Math.max(0, toMinor(d.remainingMinor));
    const give = Math.min(want, left);
    left -= give;
    return { dealId: d.dealId, amountMinor: give };
  });
}

/** Is this payment split across more than one deal? */
export function isMultiDeal(allocations = []) {
  return (allocations || []).filter((a) => a && a.dealId).length > 1;
}

/**
 * What ONE deal counts from a payment row. The ordinary single-deal row has no
 * allocation and counts the money itself; a split row counts only its share.
 * This is the rule collection.js applies to documents and evidence alike.
 */
export function countedMinorFor({ allocationMinor, paidMinor, amountMinor }) {
  if (allocationMinor !== null && allocationMinor !== undefined) {
    return Math.abs(toMinor(allocationMinor));
  }
  if (paidMinor !== null && paidMinor !== undefined) {
    const paid = Math.abs(toMinor(paidMinor));
    if (paid > 0) return paid;
  }
  return Math.abs(toMinor(amountMinor));
}
