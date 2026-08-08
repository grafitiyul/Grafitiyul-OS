// THE canonical phone normalizer. GOS stores phone values raw (as typed);
// WhatsApp reports international digits. Everything that compares, matches or
// classifies phone numbers MUST go through normalizePhoneIntl so there is
// exactly one notion of "same number" — server (WhatsApp matching, ingress,
// global search) and client (search-input classification) alike.
//
// Lives in shared/ so the client can import it; server code reaches it through
// the long-standing re-export in server/src/whatsapp/phone.js.
//
// → international digits, no '+', no separators. null when unusable.
//   '050-123-4567'    → '972501234567'   (Israeli local → international)
//   '+972 50 1234567' → '972501234567'
//   '972050-1234567'  → '972501234567'   (972+0 double prefix — legacy imports)
//   '0031612345678'   → '31612345678'    ('00' international prefix)
//   '12125551234'     → '12125551234'    (already international)
//   '+9725551780355'  → null              (impossible Israeli: 972 + 10 digits)
//   '123'             → null              (too short to be a phone)
//   '0669129785'      → null              (0 + 9 digits, but '66' is not an
//                                          Israeli prefix — see below)
//   '0669129785', {country:'FR'} → '33669129785'
//
// ── A leading zero is NOT evidence of Israel (fixed 2026-08-08) ──────────────
// Until now ANY 0 + 9-or-10 digits became a 972 number. Deal #27151 — the first
// real sale through the new website — was a French customer whose perfectly
// valid mobile 06 69 12 97 85 was rewritten as '972669129785': a number that
// reaches nobody, mints a dead WhatsApp JID, and quietly reports a foreign
// customer as Israeli. '66' is not an Israeli prefix at all; the numbering plan
// alone was enough to know.
//
// The rule now: nationalize to 972 ONLY when the local prefix exists in the
// Israeli numbering plan. When it does not, and no country hint is available,
// return null — the honest "GOS has no international identity for this number".
// The raw value the customer typed is stored on the ContactPhone regardless, so
// nothing is lost and a human can still read and dial it.

// Israel's national numbering plan, as an operator would recognise it:
//   mobile     05X-XXXXXXX      (0 + 9 digits)
//   VoIP/other 07X-XXXXXXX      (0 + 9 digits)
//   landline   0[2,3,4,8,9]-XXXXXXX (0 + 8 digits)
// Deliberately NOT including service ranges (1-700/1-800/*NNNN): they are not
// subscriber numbers and were never handled here.
const IL_LOCAL_MOBILE = /^0[57]\d{8}$/;
const IL_LOCAL_LANDLINE = /^0[23489]\d{7}$/;

function isIsraeliLocal(digits) {
  return IL_LOCAL_MOBILE.test(digits) || IL_LOCAL_LANDLINE.test(digits);
}

function isIsraeliSubscriber(rest) {
  // rest = the digits after '972'
  if (/^[57]\d{8}$/.test(rest)) return true; // mobile / VoIP
  if (/^[23489]\d{7}$/.test(rest)) return true; // landline
  return false;
}

// Country hint → dial code. Used ONLY when the caller supplies real evidence
// (a billing country from the order), never inferred from the number itself.
// `trunk:true` means the national format carries a leading 0 that is dropped
// before the country code — the common European convention. Italy deliberately
// keeps its leading zero; NANP numbers never carry one.
const COUNTRY_DIAL = Object.freeze({
  IL: { cc: '972', trunk: true },
  FR: { cc: '33', trunk: true },
  GB: { cc: '44', trunk: true },
  UK: { cc: '44', trunk: true },
  DE: { cc: '49', trunk: true },
  ES: { cc: '34', trunk: false },
  NL: { cc: '31', trunk: true },
  BE: { cc: '32', trunk: true },
  CH: { cc: '41', trunk: true },
  AT: { cc: '43', trunk: true },
  IT: { cc: '39', trunk: false }, // Italian numbers keep the leading 0
  PT: { cc: '351', trunk: false },
  GR: { cc: '30', trunk: false },
  IE: { cc: '353', trunk: true },
  SE: { cc: '46', trunk: true },
  NO: { cc: '47', trunk: false },
  DK: { cc: '45', trunk: false },
  FI: { cc: '358', trunk: true },
  PL: { cc: '48', trunk: false },
  CZ: { cc: '420', trunk: false },
  HU: { cc: '36', trunk: true },
  RO: { cc: '40', trunk: true },
  RU: { cc: '7', trunk: true },
  UA: { cc: '380', trunk: true },
  TR: { cc: '90', trunk: true },
  US: { cc: '1', trunk: false },
  CA: { cc: '1', trunk: false },
  MX: { cc: '52', trunk: false },
  BR: { cc: '55', trunk: true },
  AR: { cc: '54', trunk: true },
  AU: { cc: '61', trunk: true },
  NZ: { cc: '64', trunk: true },
  ZA: { cc: '27', trunk: true },
  IN: { cc: '91', trunk: true },
  CN: { cc: '86', trunk: false },
  JP: { cc: '81', trunk: true },
  KR: { cc: '82', trunk: true },
});

/** Is this a country GOS can nationalize a local number for? */
export function knownDialCountry(code) {
  return Boolean(COUNTRY_DIAL[String(code || '').trim().toUpperCase()]);
}

// ── Display ──────────────────────────────────────────────────────────────────
// A guide holding a phone at 11:00 on a Monday needs a number they can READ and
// TAP. Until now every stored value was rendered verbatim, which is right for an
// Israeli number and useless for a foreign one: "0669129785" tells an Israeli
// guide nothing about which country to dial.
//
// Nothing here INFERS a country. It only formats a number GOS has already
// resolved to international form — the resolution itself still requires real
// evidence (a declared billing country), exactly as normalizePhoneIntl demands.

// Dial code → country, ONLY where the mapping is unambiguous. '1' is
// deliberately absent: +1 is both the US and Canada, and a flag that might be
// the wrong one is worse than no flag.
const DIAL_TO_COUNTRY = (() => {
  const counts = new Map();
  for (const [iso, { cc }] of Object.entries(COUNTRY_DIAL)) {
    counts.set(cc, [...(counts.get(cc) || []), iso]);
  }
  const out = new Map();
  for (const [cc, isos] of counts) {
    // 'UK' is an alias for 'GB', not a second country.
    const real = isos.filter((i) => i !== 'UK');
    if (real.length === 1) out.set(cc, real[0]);
  }
  return out;
})();

/** ISO-3166 alpha-2 for an international number, or null when ambiguous. */
export function phoneCountryFromIntl(intl) {
  const digits = String(intl || '').replace(/\D/g, '');
  if (!digits) return null;
  // Longest dial code wins (351 before 35, 972 before 97).
  for (const len of [3, 2, 1]) {
    const hit = DIAL_TO_COUNTRY.get(digits.slice(0, len));
    if (hit) return hit;
  }
  return null;
}

/** The regional-indicator flag for an ISO-3166 alpha-2 code. */
export function countryFlag(iso) {
  const s = String(iso || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) return null;
  return String.fromCodePoint(...[...s].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// National-number grouping, ONLY where the convention is genuinely known.
//
// Deliberately almost empty. Grouping digits the way a country does NOT write
// them is a small lie about how the number is read, and it is the same class of
// error as the fabricated card digits this project just removed. A country with
// no entry renders as "+CC national" — unambiguous, correct everywhere, and
// never pretending to a local convention nobody verified.
//
// FR is here because it was verified against the real number this rule exists
// for (#27151: 06 69 12 97 85). Add another only with the same standard of
// evidence.
const NATIONAL_GROUPS = Object.freeze({
  FR: [1, 2, 2, 2, 2], // 6 69 12 97 85
});

function group(national, sizes) {
  const out = [];
  let i = 0;
  for (const n of sizes) {
    if (i >= national.length) break;
    out.push(national.slice(i, i + n));
    i += n;
  }
  if (i < national.length) out.push(national.slice(i));
  return out.join(' ');
}

/**
 * The human-readable form of a phone number.
 *
 *   '0501234567'    → '0501234567'           (Israeli — EXACTLY as stored)
 *   '972501234567'  → '0501234567'           (Israeli — local form)
 *   '33669129785'   → '+33 6 69 12 97 85'    (international, grouped)
 *   '0669129785'    → '0669129785'           (unplaceable — shown verbatim,
 *                                             never dressed up as anything)
 *
 * Israeli numbers are deliberately NOT re-styled. They are the default case,
 * every operator and guide already reads them fine, and re-grouping thousands
 * of existing numbers to satisfy a foreign-number fix would be a change nobody
 * asked for. Only numbers GOS resolved to a FOREIGN country are reformatted —
 * that is the actual problem being solved.
 */
export function formatPhoneDisplay(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const intl = normalizePhoneIntl(value);
  // Un-normalizable: show exactly what is stored. GOS does not know what this
  // number is, and pretending otherwise is how '0669129785' became Israeli.
  if (!intl) return value;
  if (intl.startsWith('972')) {
    // Already written in local form → leave it completely alone.
    if (value.replace(/\D/g, '').startsWith('0')) return value;
    return `0${intl.slice(3)}`;
  }
  const iso = phoneCountryFromIntl(intl);
  const cc = iso ? COUNTRY_DIAL[iso].cc : null;
  if (!cc) return `+${intl}`;
  const national = intl.slice(cc.length);
  const sizes = NATIONAL_GROUPS[iso];
  return `+${cc} ${sizes ? group(national, sizes) : national}`;
}

/**
 * The `tel:` target. Always the tightest unambiguous form GOS can produce —
 * E.164 when the number is placed, the stored value otherwise (a local number
 * still dials correctly for someone in the same country).
 */
export function phoneTelHref(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const intl = normalizePhoneIntl(value);
  return intl ? `+${intl}` : value;
}

/**
 * @param raw      the number as supplied
 * @param options.country  ISO-3166 alpha-2 from a TRUSTED source (Woo billing
 *                 country, an explicit operator choice). Used only to resolve a
 *                 local-format number; never overrides an explicit +CC, and
 *                 never guessed from the number's shape.
 */
export function normalizePhoneIntl(raw, { country = null } = {}) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);

  // '972' + local leading zero ('972 050-…') — the classic legacy-import double
  // prefix. Israeli subscriber numbers never start with 0 after 972, so this is
  // unambiguous: drop the zero. Checked BEFORE the local rule so a stored
  // '9720501234567' is repaired rather than rejected.
  if (digits.startsWith('9720') && (digits.length === 12 || digits.length === 13)) {
    digits = `972${digits.slice(4)}`;
  }

  // Local (0-prefixed) form. Israel wins whenever the number is a VALID Israeli
  // subscriber number — that is the overwhelming case and needs no hint.
  if (digits.startsWith('0')) {
    if (isIsraeliLocal(digits)) return `972${digits.slice(1)}`;
    // Not an Israeli number. A trusted country hint can still resolve it;
    // without one, GOS does not know what country this is and says so.
    const hint = COUNTRY_DIAL[String(country || '').trim().toUpperCase()];
    if (!hint) return null;
    const national = hint.trunk ? digits.slice(1) : digits;
    const candidate = `${hint.cc}${national}`;
    return candidate.length >= 8 && candidate.length <= 15 ? candidate : null;
  }

  // Israeli international shapes are validated against the numbering plan too:
  // '972' + anything that is not a real subscriber number is DATA, not a phone
  // — usually a foreign number stored with an Israeli prefix. Returning them
  // verbatim used to mint unreachable JIDs (false "not registered on
  // WhatsApp"); null forces the honest "no usable phone" path instead.
  if (digits.startsWith('972')) {
    return isIsraeliSubscriber(digits.slice(3)) ? digits : null;
  }

  // Already-international, non-Israeli. E.164's practical bounds.
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}
