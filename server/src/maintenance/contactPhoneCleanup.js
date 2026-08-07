// One-time maintenance logic for the Pipedrive-era ContactPhone damage.
//
// THE PHONE ARCHITECTURE (audited 2026-08-07, unchanged by this sweep):
//   ContactPhone { value, label, isPrimary, sortOrder } — `value` is the RAW,
//   as-typed, human-facing string. There is NO normalized column and NO country
//   column. Canonical identity is DERIVED on every read by
//   shared/phone.mjs → normalizePhoneIntl(value), which is what WhatsApp
//   matching (buildPhoneIndex/matchContactId) and global search (phoneQuery)
//   both use.
//
// The consequence, and the rule this module obeys:
//   Changing `value` is SAFE for matching **iff** normalizePhoneIntl(value) is
//   unchanged. Every Israeli reformat below satisfies that by construction and
//   is asserted per-row before it is written. The ONLY changes that alter
//   canonical identity are proven foreign-972 repairs, whose "before" identity
//   was null (unmatchable) anyway.
//
// Nothing here invents a country code, and nothing here guesses.

import { normalizePhoneIntl } from '../../../shared/phone.mjs';

// THE display formatter — imported from the client utility on purpose so the
// value written to the database is EXACTLY the string the UI renders. One
// formatter, no server-side copy to drift.
import { formatPhoneDisplay } from '../../../client/src/lib/phone.js';

export { normalizePhoneIntl, formatPhoneDisplay };

const digitsOf = (raw) => String(raw ?? '').replace(/\D/g, '');

/** Is this canonical intl an Israeli number? */
export const isIsraeli = (intl) => !!intl && intl.startsWith('972');

/**
 * Classify ONE stored ContactPhone.value.
 * → { raw, digits, intl, kind }
 *
 * kind:
 *   'empty'          nothing stored
 *   'israeli_local'  already the friendly local form (05x… / 0x…)
 *   'israeli_intl'   an Israeli number stored in +972 / 972 / 00972 form
 *                    — canonical identity is fine, the DISPLAY is not
 *   'foreign'        a valid non-Israeli international number
 *   'bad_972'        starts with 972 but is an impossible Israeli length →
 *                    normalizePhoneIntl refuses it. The 972-corruption suspects.
 *   'unusable'       cannot be normalized and is not 972-prefixed
 */
export function classifyPhoneRow(raw) {
  const digits = digitsOf(raw);
  if (!digits) return { raw: raw ?? '', digits: '', intl: null, kind: 'empty' };

  const intl = normalizePhoneIntl(raw);
  // Strip an explicit '00' international prefix before asking "does it start 972".
  const bare = digits.startsWith('00') ? digits.slice(2) : digits;

  if (intl && isIsraeli(intl)) {
    // Stored in local form iff the raw digits begin with a leading 0 and carry
    // no country code at all.
    const local = !bare.startsWith('972') && bare.startsWith('0');
    return { raw, digits, intl, kind: local ? 'israeli_local' : 'israeli_intl' };
  }
  if (intl) return { raw, digits, intl, kind: 'foreign' };
  if (bare.startsWith('972')) return { raw, digits, intl: null, kind: 'bad_972' };
  return { raw, digits, intl: null, kind: 'unusable' };
}

/**
 * The friendly local rendering of an Israeli number ('972521234567' →
 * '052-123-4567'). Returns null when the value is not a normalizable Israeli
 * number, so a caller can never accidentally "localize" a foreign number.
 */
export function israeliDisplayValue(raw) {
  const intl = normalizePhoneIntl(raw);
  if (!isIsraeli(intl)) return null;
  const shown = formatPhoneDisplay(intl);
  // Safety net: the rewritten string MUST normalize back to the same identity.
  return normalizePhoneIntl(shown) === intl ? shown : null;
}

/**
 * Plan the Israeli display canonicalization for one row.
 * → { action: 'none' } | { action: 'reformat', from, to, intl }
 * Only ever proposes a change when identity is provably preserved.
 */
export function planIsraeliDisplay(row) {
  const c = classifyPhoneRow(row.value);
  if (c.kind !== 'israeli_intl' && c.kind !== 'israeli_local') return { action: 'none' };
  const to = israeliDisplayValue(row.value);
  if (!to || to === row.value) return { action: 'none' };
  return { action: 'reformat', from: row.value, to, intl: c.intl };
}

// Survivor order for a duplicate group: primary first, then the operator's own
// ordering, then the oldest row (the original), then id for total determinism.
function survivorRank(a, b) {
  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
  if ((a.sortOrder ?? 0) !== (b.sortOrder ?? 0)) return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  if (at !== bt) return at - bt;
  return String(a.id).localeCompare(String(b.id));
}

/**
 * Plan same-contact duplicate consolidation.
 *
 * Rows are grouped by CANONICAL identity — never by string similarity. Rows
 * that cannot be normalized (intl === null) are NEVER grouped: two unusable
 * strings are not provably the same phone.
 *
 *   rows — this contact's ContactPhone rows
 * → { groups: [{ intl, survivor, drop[], patch }], dropIds[] }
 *
 * The survivor inherits: primary status if ANY row in the group was primary,
 * and a label if it had none but a dropped sibling did (metadata is preserved,
 * never lost with the row).
 */
export function planDuplicates(rows) {
  const byIntl = new Map();
  for (const r of rows || []) {
    const intl = normalizePhoneIntl(r.value);
    if (!intl) continue;
    if (!byIntl.has(intl)) byIntl.set(intl, []);
    byIntl.get(intl).push(r);
  }

  const groups = [];
  for (const [intl, group] of byIntl) {
    if (group.length < 2) continue;
    const ordered = [...group].sort(survivorRank);
    const [survivor, ...drop] = ordered;

    const patch = {};
    // If ANY duplicate was primary, the survivor is primary.
    if (!survivor.isPrimary && group.some((r) => r.isPrimary)) patch.isPrimary = true;
    // Carry a label forward rather than deleting it with the row.
    if (!String(survivor.label || '').trim()) {
      const donor = drop.find((r) => String(r.label || '').trim());
      if (donor) patch.label = donor.label;
    }
    groups.push({ intl, survivor, drop, patch });
  }
  return { groups, dropIds: groups.flatMap((g) => g.drop.map((r) => r.id)) };
}

/**
 * Is this RAW stored string authoritative about its COUNTRY?
 *
 * Only an explicit international marker is. A bare or nationally-formatted
 * digit string is NOT — and treating it as proof is actively dangerous:
 *
 *   '(650) 814-6172'  is US area code 650, but read as bare international
 *                     digits it "looks like" Singapore (+65).
 *   '7186440498'      is US 718 (Brooklyn), not Russia (+7).
 *   '9177346364'      is US 917 (New York), not India (+91).
 *
 * All three exist in production. Each would have been rewritten into a
 * different country by a rule that trusts bare digits. Hence: a leading '+' or
 * '00' (a human/import explicitly declaring the dial code) is the only shape
 * that proves a country — plus WhatsApp identities, which WhatsApp itself
 * reports in true international form and which are handled by the caller.
 */
export function isCountryAuthoritative(raw) {
  const s = String(raw ?? '').trim();
  return s.startsWith('+') || /^\s*00\d/.test(s);
}

/**
 * Foreign-number repair where 972 was wrongly prepended.
 *
 *   row    — the bad_972 ContactPhone row
 *   proofs — Set of canonical intl digits that are COUNTRY-AUTHORITATIVE for
 *            this contact. The caller must build it from ONLY:
 *              • WhatsApp chat phoneNumber / phoneJid on a LINKED chat
 *              • sibling phone rows passing isCountryAuthoritative()
 *            Never from bare digit strings — see the note above.
 *
 * → { verdict, candidate?, to?, proof? }
 *   'not_applicable'  not a 972-corruption suspect
 *   'proven'          stripping 972 yields a number an independent source on
 *                     this very contact already holds → deterministic repair
 *   'foreign_unknown' 972 is provably wrong (impossible Israeli length) but the
 *                     true country cannot be established → REPORT ONLY
 *   'ambiguous'       cannot even establish that the remainder is a phone
 *
 * A country is NEVER inferred from length, name, organization, email domain or
 * conversation language.
 */
export function planForeign972(row, proofs) {
  const c = classifyPhoneRow(row.value);
  if (c.kind !== 'bad_972') return { verdict: 'not_applicable' };

  const bare = c.digits.startsWith('00') ? c.digits.slice(2) : c.digits;
  const remainder = bare.slice(3); // drop the false '972'
  const candidate = normalizePhoneIntl(remainder);

  // A remainder that normalizes back to an Israeli number proves nothing about
  // a foreign country — refuse it rather than "repair" 972+something into 972.
  if (!candidate || isIsraeli(candidate)) {
    return { verdict: 'ambiguous', candidate: candidate || null };
  }

  if (proofs && proofs.has(candidate)) {
    const to = formatPhoneDisplay(candidate);
    // Never write a display string that does not round-trip to the proven identity.
    if (normalizePhoneIntl(to) !== candidate) {
      return { verdict: 'ambiguous', candidate };
    }
    return { verdict: 'proven', candidate, to, proof: 'independent_source_on_same_contact' };
  }

  return { verdict: 'foreign_unknown', candidate };
}
