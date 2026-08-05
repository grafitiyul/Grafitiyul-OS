// THE bilingual catalog-text resolver. One implementation, shared by server
// and client, for every He/En field PAIR that GOS maintains on a catalog row
// (Product.nameHe/nameEn, Location.nameHe/nameEn, ActivityComponent,
// TicketType, Contact first/last name, …).
//
// This is deliberately NOT a translator: it only CHOOSES between two values a
// human already authored. There is no machine translation anywhere in this
// path, and code never invents an English string for business data.
//
// Fallback rule — the same one shared/staffName.mjs already applies to staff
// names, kept identical on purpose so the whole system behaves one way:
//
//   requested language → the other language → '' (nothing at all)
//
// Falling back to the other language is what the CANONICAL resolver defines,
// and it is a deliberate choice over rendering a blank: an English-speaking
// guide seeing the Hebrew product name still knows which tour they are on,
// whereas a nameless card is unusable in the field. Every such fallback is a
// real DATA gap (the row has no English value yet), never a code gap — they
// are enumerated by `npm run report:portal-english` so they can be filled in
// the database rather than patched in code.

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Choose between an already-authored He/En pair.
 * @param {{he?: string|null, en?: string|null}} pair
 * @param {string} lang 'he' | 'en'
 * @returns {string} the chosen value, or '' when neither language has one
 */
export function pickBilingual(pair, lang) {
  if (!pair) return '';
  const he = clean(pair.he);
  const en = clean(pair.en);
  const wanted = lang === 'en' ? en : he;
  if (wanted) return wanted;
  return lang === 'en' ? he : en;
}

/**
 * True when the requested language has NO authored value and the result is
 * therefore the other language. Callers use this to REPORT the data gap —
 * never to hide or mangle the value.
 */
export function isBilingualFallback(pair, lang) {
  if (!pair) return false;
  const wanted = lang === 'en' ? clean(pair.en) : clean(pair.he);
  return !wanted && !!pickBilingual(pair, lang);
}

/** A catalog row with the standard nameHe/nameEn columns. */
export function catalogName(row, lang) {
  if (!row) return '';
  return pickBilingual({ he: row.nameHe, en: row.nameEn }, lang);
}

/** A catalog row with the standard titleHe/titleEn columns. */
export function catalogTitle(row, lang) {
  if (!row) return '';
  return pickBilingual({ he: row.titleHe, en: row.titleEn }, lang);
}

/**
 * A row whose Hebrew side lives in an UNSUFFIXED column (WorkshopLocation
 * `address`/`instructions`, Flow `title`/`description`) — those predate the
 * bilingual convention and were deliberately not renamed, so the migration
 * could stay additive. `heField` names the Hebrew column, `enField` the twin.
 */
export function pairFrom(row, heField, enField, lang) {
  if (!row) return '';
  return pickBilingual({ he: row[heField], en: row[enField] }, lang);
}

/** A Contact's full name from its four canonical name columns. */
export function contactFullName(contact, lang) {
  if (!contact) return '';
  const join = (a, b) => [clean(a), clean(b)].filter(Boolean).join(' ');
  return pickBilingual(
    {
      he: join(contact.firstNameHe, contact.lastNameHe),
      en: join(contact.firstNameEn, contact.lastNameEn),
    },
    lang,
  );
}
