// THE staff-name resolver. One implementation, shared by server and client.
//
// Staff identity lives on PersonProfile (GOS-owned, never touched by recruitment
// identity sync). PersonRef.displayName is the legacy single-string name that
// sync still feeds; it remains the fallback until every person has explicit
// name fields, and it retires on its own when recruitment consolidates into GOS.
//
// Language rule: each language uses ITS OWN name when present. A Hebrew-only
// name is NEVER borrowed into an English message and vice versa — the same rule
// the WhatsApp template resolver already enforces for customers, because
// "Hi יואב" reads as a bug. When the requested language has no name, we fall
// back to the other language rather than showing nothing, since a name is
// better than a blank.

export const DEFAULT_STAFF_LANGUAGE = 'he';
export const STAFF_LANGUAGES = ['he', 'en'];

const clean = (v) => String(v ?? '').trim();

/** Join a first/last pair, tolerating either being absent. */
function joinName(first, last) {
  return [clean(first), clean(last)].filter(Boolean).join(' ').trim();
}

/**
 * A person's full name in `lang`.
 *
 * `person` accepts either shape:
 *   { profile: {...}, displayName }   — a PersonRef with its profile included
 *   { firstNameHe, ..., displayName } — a flattened DTO
 */
export function staffName(person, lang = DEFAULT_STAFF_LANGUAGE) {
  if (!person) return '';
  const p = person.profile || person;

  const he = joinName(p.firstNameHe, p.lastNameHe);
  const en = joinName(p.firstNameEn, p.lastNameEn);

  const wanted = lang === 'en' ? en : he;
  if (wanted) return wanted;

  // The other language beats nothing at all.
  const other = lang === 'en' ? he : en;
  if (other) return other;

  // Legacy single-string name from recruitment sync.
  return clean(person.displayName || p.displayName);
}

/** First name only — greetings ("שלום יואב"). Same language rule. */
export function staffFirstName(person, lang = DEFAULT_STAFF_LANGUAGE) {
  if (!person) return '';
  const p = person.profile || person;
  const wanted = lang === 'en' ? clean(p.firstNameEn) : clean(p.firstNameHe);
  if (wanted) return wanted;
  const other = lang === 'en' ? clean(p.firstNameHe) : clean(p.firstNameEn);
  if (other) return other;
  // Fall back to the first token of the legacy display name.
  return clean(person.displayName || p.displayName).split(/\s+/)[0] || '';
}

/**
 * The language this person should RECEIVE content in. Anything unrecognised
 * resolves to Hebrew — the safe default for this business, and what every
 * existing staff member is defaulted to by the migration.
 */
export function staffLanguage(person) {
  const p = person?.profile || person || {};
  const v = clean(p.preferredLanguage).toLowerCase();
  return STAFF_LANGUAGES.includes(v) ? v : DEFAULT_STAFF_LANGUAGE;
}

/**
 * Best-effort split of a legacy single-string name into first + last.
 * Used ONLY by the one-time backfill: the first token is the first name and
 * everything after it is the surname, which is right for the overwhelming
 * majority of Hebrew names. The original displayName is never modified, so a
 * wrong split costs an edit rather than data.
 */
export function splitLegacyName(displayName) {
  const parts = clean(displayName).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}
