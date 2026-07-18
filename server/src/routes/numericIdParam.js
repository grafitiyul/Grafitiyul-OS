// Business-facing numeric URL support — the Deal orderNo pattern (deals.js).
//
// Every /:id route on a router that installs this resolver accepts EITHER the
// internal cuid OR the public sequential number (all digits; cuids never are).
// The resolver swaps a numeric id for the cuid before any handler runs, so no
// handler needs to know which form arrived. Unknown numbers fall through
// unchanged → the handler's own lookup 404s with its usual error shape.
//
// `findByNumber(n)` must resolve to `{ id }` or null (an indexed unique
// lookup, e.g. prisma.organization.findUnique({ where: { orgNo: n },
// select: { id: true } })). Kept as an injected function so the resolver is
// unit-testable without express or a database.

const INT4_MAX = 2147483647;

export function numericIdResolver(findByNumber) {
  return (req, _res, next, value) => {
    if (!/^\d+$/.test(value)) return next();
    const num = Number(value);
    if (!Number.isSafeInteger(num) || num > INT4_MAX) return next();
    Promise.resolve(findByNumber(num))
      .then((found) => {
        if (found) req.params.id = found.id;
        next();
      })
      .catch(next);
  };
}
