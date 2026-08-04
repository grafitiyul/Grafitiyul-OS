import { prisma } from '../db.js';

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
export function registerDealOrderNoParam(router, paramName = 'dealId') {
  router.param(paramName, (req, _res, next, value) => {
    if (!/^\d+$/.test(value)) return next();
    const orderNo = Number(value);
    if (!Number.isSafeInteger(orderNo) || orderNo > 2147483647) return next();
    prisma.deal
      .findUnique({ where: { orderNo }, select: { id: true } })
      .then((found) => {
        if (found) req.params[paramName] = found.id;
        next();
      })
      .catch(next);
  });
}
