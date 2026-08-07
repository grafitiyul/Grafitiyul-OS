import { prisma } from '../db.js';
import { READ_METHODS, retiredDealRefusal } from '../deals/mergeLineage.js';

// "מספר הזמנה" URL support — THE one resolver for every deal-scoped route
// param. A deal URL parameter may be EITHER the internal cuid OR the
// business-facing sequential order number (all digits; cuids never are). The
// resolver swaps a numeric value for the cuid before any handler runs, so no
// handler needs to know which form arrived. Unknown numbers fall through
// unchanged → the handler's own lookup 404s.
//
// Register it on EVERY router that takes a deal id in the URL. The confirmation
// email "DEAL NOT FOUND" production bug (#26340) was exactly a router that
// resolved only cuids while the Deal page's route param is the orderNo.
//
// ── It also enforces the RETIRED-deal write block ───────────────────────────
//
// A deal retired by a merge (deals/mergeLineage.js) is HISTORY. It stays fully
// readable — that is the entire point of retiring instead of deleting — but it
// must not receive new ordinary writes: an edit there is invisible (the deal
// appears in no list, no queue, no detector) and silently diverges from the
// survivor that now represents the transaction.
//
// The block lives HERE, in the resolver every deal-scoped router already calls,
// rather than in each router. A guard you have to remember to add to the next
// router is a guard the next router will not have — and this one already knows
// which deal the request is about, in either URL form, before any handler runs.
//
// Deliberately NOT applied to:
//   • read verbs — a retired deal must stay fully readable
//   • webhooks and provider callbacks (icount, cardcom, woo, ingress), which do
//     not use this resolver: money that really arrived must still be recorded
//     against the order it was paid for, whatever happened to the deal since.

// `db` is injectable so the resolver + guard are testable without express or a
// database (the numericIdParam convention).
export function registerDealOrderNoParam(
  router,
  paramName = 'dealId',
  { blockRetiredWrites = true, db = prisma } = {},
) {
  router.param(paramName, dealParamHandler(paramName, { blockRetiredWrites, db }));
}

/** The param handler itself — exported for the unit suite. */
export function dealParamHandler(paramName = 'dealId', { blockRetiredWrites = true, db = prisma } = {}) {
  return (req, res, next) => {
    const value = req.params?.[paramName];
    const numeric = /^\d+$/.test(value);
    const orderNo = numeric ? Number(value) : null;
    const resolvable = numeric && Number.isSafeInteger(orderNo) && orderNo <= 2147483647;
    const guarding = blockRetiredWrites && !READ_METHODS.has(req.method);

    // Nothing to resolve AND nothing to guard → the cheapest possible path.
    if (!resolvable && !guarding) return next();

    const swap = resolvable
      ? db.deal.findUnique({ where: { orderNo }, select: { id: true } })
        .then((found) => {
          if (found) req.params[paramName] = found.id;
        })
      : Promise.resolve();

    return swap
      .then(async () => {
        if (!guarding) return next();
        // The ONE refusal builder (deals/mergeLineage.js), which accepts either
        // URL form — so the guard holds whether or not the swap above matched.
        const refusal = await retiredDealRefusal(db, req.params[paramName]);
        if (refusal) return res.status(409).json(refusal);
        return next();
      })
      .catch(next);
  };
}
