// Contact-name matching for Prisma `where` clauses.
//
// Contact stores firstNameHe/lastNameHe/firstNameEn/lastNameEn and NOTHING
// else — full names are derived at the API layer (schema comment on Contact).
// So a query like "דור כהן" or "Dor Cohen" matches no single column, and a
// naive `contains` finds nothing at all.
//
// This builds the one clause that handles both cases:
//   - single token → match it against any name field
//   - multi token  → EVERY token must match SOME name field (AND of ORs), so
//                    "דור כהן" matches first=דור + last=כהן, and in either
//                    order ("כהן דור" works too).
//
// One helper, used by both the contacts and deals providers — the name rule
// exists in exactly one place.

import { tokens } from './text.js';

const NAME_FIELDS = ['firstNameHe', 'lastNameHe', 'firstNameEn', 'lastNameEn'];

function ci(q) {
  return { contains: q, mode: 'insensitive' };
}

// → array of Prisma conditions to spread into an OR.
export function contactNameOr(q) {
  const single = NAME_FIELDS.map((f) => ({ [f]: ci(q) }));
  const parts = tokens(q);
  if (parts.length < 2) return single;
  return [
    ...single,
    { AND: parts.map((t) => ({ OR: NAME_FIELDS.map((f) => ({ [f]: ci(t) })) })) },
  ];
}
