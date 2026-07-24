// THE ONE contact-search WHERE builder.
//
// Both the global-search contacts provider AND the paginated Contacts list
// endpoint use this, so "how a contact is found" is defined in exactly one
// place. The list route USED to hand-roll its own version and drifted: a name
// token produced `phones.some.value.contains ''` (an empty-string ILIKE that
// matches every phone → every contact), and any all-digit token was fed to
// `contactNo: Number(tok)` unguarded (an 11-digit phone overflows int4 and
// throws). Both bugs disappear by construction here.
//
// Phone matching runs through the canonical normalizer (phoneQuery +
// lookupPhoneContacts): the stored ContactPhone.value keeps its formatting, so
// candidates are resolved by normalized digit-suffix, never a raw substring —
// '0501234567', '050-123-4567' and '+972501234567' all find the same contact.
// Stored values are never read or rewritten for matching beyond normalization.

import { lookupPhoneContacts, lookupEmailContacts, lookupLegacy } from './lookups.js';
import { contactNameOr } from './nameWhere.js';

// Postgres int4 upper bound — `contactNo` is an Int column, so a longer numeric
// query (e.g. a full phone typed as one token) must NOT be cast to it.
const INT4_MAX = 2147483647;

const ci = (q) => ({ contains: q, mode: 'insensitive' });

// Build the Prisma `where` (and the lookup maps the ranking layer reuses) for a
// contact search query.
//   q   — the raw search string
//   pq  — phoneQuery(q) (phone intent; 'none' when the query is not phone-ish)
//   db  — Prisma client (or a tx)
//   opts.includeLegacy — resolve curated legacy-card matches too (default true;
//                        inert until the migration import populates LegacyRecord)
export async function contactSearchWhere(q, pq, db, { includeLegacy = true } = {}) {
  const trimmed = String(q ?? '').trim();
  const contactNo =
    /^\d+$/.test(trimmed) && Number(trimmed) <= INT4_MAX ? Number(trimmed) : null;

  const [phoneMap, emailMap, legacyRows] = await Promise.all([
    lookupPhoneContacts(pq, db),
    lookupEmailContacts(q, db),
    includeLegacy ? lookupLegacy(q, 'Contact', db) : Promise.resolve([]),
  ]);
  const legacyByContact = new Map(legacyRows.map((r) => [r.entityId, r.cardData]));

  const or = [
    // Names are DERIVED, not stored — contactNameOr handles single tokens and
    // full-name-across-columns ("דוד כהן" → first + last, either order).
    ...contactNameOr(q),
    { notes: ci(q) },
    { taxId: ci(q) },
    { orgLinks: { some: { organization: { is: { name: ci(q) } } } } },
    { orgLinks: { some: { organizationUnit: { is: { name: ci(q) } } } } },
  ];
  // Exact public contact number only — guarded above so a phone-length number
  // never reaches the int4 column.
  if (contactNo !== null) or.push({ contactNo });

  // Phone / email / legacy are resolved to contact ids out-of-band (Prisma
  // cannot normalize the stored phone column in-query), folded in as one bounded
  // `id IN (...)`.
  const contactIds = [
    ...new Set([...phoneMap.keys(), ...emailMap.keys(), ...legacyByContact.keys()]),
  ];
  if (contactIds.length) or.push({ id: { in: contactIds } });

  return { or, where: { OR: or }, phoneMap, emailMap, legacyByContact, contactNo };
}
