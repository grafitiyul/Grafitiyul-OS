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

// Express calls a `router.param` handler with (req, res, next, value, name).
// The resolved cuid is written back to THE PARAM THAT WAS MATCHED — it used to
// be hardcoded to `id`, which silently made the helper a no-op on any router
// naming its param something else. That is not hypothetical: the reservation
// -link routes use `:contactId`, so registering this resolver on them resolved
// the number, threw the answer into `params.id`, and left `params.contactId`
// as the literal "36435" for the handler to 404 on. Defaults to 'id' so every
// existing caller is byte-identical.
export function numericIdResolver(findByNumber) {
  return (req, _res, next, value, name = 'id') => {
    if (!/^\d+$/.test(value)) return next();
    const num = Number(value);
    if (!Number.isSafeInteger(num) || num > INT4_MAX) return next();
    Promise.resolve(findByNumber(num))
      .then((found) => {
        if (found) req.params[name] = found.id;
        next();
      })
      .catch(next);
  };
}
