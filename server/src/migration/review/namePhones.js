// Country-driven phone editing for the Name Cleanup flow. PURE — no I/O.
//
// The COUNTRY the owner selects drives normalization; the code never guesses.
// Three sources of truth, never merged:
//   * `original`   — the raw snapshot value. Never rewritten, stays in the legacy
//                    archive whatever happens here.
//   * `value`      — the owner-edited display value. This is what GOS imports as
//                    ContactPhone.value (GOS stores phones raw, as typed).
//   * `normalized` — international digits for comparison/matching only, in the
//                    exact shape of the runtime SSOT (whatsapp/phone.js
//                    normalizePhoneIntl: digits, no '+'). null when unverifiable.
//
// "Never guess" is enforced twice:
//   * a suggestion is made only when the NUMBER ITSELF states its country
//     (Israeli local `0…` form, or an explicit +/00 international prefix that
//     matches a known dial code). Everything else is suggested as OTHER.
//   * a number that states one country while the owner selects another is a
//     MISMATCH ERROR — it is never silently rewritten to the selected code.

// Dial codes, longest-first so +1… never shadows +12-style codes (none here, but
// the ordering rule keeps future additions safe). NOT an exhaustive ITU table —
// 'OTHER' covers the rest with explicit owner confirmation.
export const COUNTRIES = [
  { code: 'IL', dial: '972', label: 'ישראל (+972)', nationalLen: [8, 9] },
  { code: 'US', dial: '1', label: 'ארה"ב / קנדה (+1)', nationalLen: [10, 10] },
  { code: 'GB', dial: '44', label: 'בריטניה (+44)', nationalLen: [9, 10] },
  { code: 'FR', dial: '33', label: 'צרפת (+33)', nationalLen: [9, 9] },
  { code: 'DE', dial: '49', label: 'גרמניה (+49)', nationalLen: [9, 11] },
  { code: 'NL', dial: '31', label: 'הולנד (+31)', nationalLen: [9, 9] },
  { code: 'BE', dial: '32', label: 'בלגיה (+32)', nationalLen: [8, 9] },
  { code: 'ES', dial: '34', label: 'ספרד (+34)', nationalLen: [9, 9] },
  { code: 'IT', dial: '39', label: 'איטליה (+39)', nationalLen: [8, 11] },
  { code: 'CH', dial: '41', label: 'שווייץ (+41)', nationalLen: [9, 9] },
  { code: 'AT', dial: '43', label: 'אוסטריה (+43)', nationalLen: [8, 11] },
  { code: 'RU', dial: '7', label: 'רוסיה (+7)', nationalLen: [10, 10] },
  { code: 'UA', dial: '380', label: 'אוקראינה (+380)', nationalLen: [9, 9] },
  { code: 'PL', dial: '48', label: 'פולין (+48)', nationalLen: [9, 9] },
  { code: 'GR', dial: '30', label: 'יוון (+30)', nationalLen: [10, 10] },
  { code: 'TR', dial: '90', label: 'טורקיה (+90)', nationalLen: [10, 10] },
  { code: 'AU', dial: '61', label: 'אוסטרליה (+61)', nationalLen: [9, 9] },
  { code: 'ZA', dial: '27', label: 'דרום אפריקה (+27)', nationalLen: [9, 9] },
  { code: 'BR', dial: '55', label: 'ברזיל (+55)', nationalLen: [10, 11] },
  { code: 'MX', dial: '52', label: 'מקסיקו (+52)', nationalLen: [10, 10] },
  { code: 'AR', dial: '54', label: 'ארגנטינה (+54)', nationalLen: [10, 10] },
  { code: 'IN', dial: '91', label: 'הודו (+91)', nationalLen: [10, 10] },
  { code: 'AE', dial: '971', label: 'איחוד האמירויות (+971)', nationalLen: [8, 9] },
  { code: 'OTHER', dial: null, label: 'מדינה אחרת / לא ידוע', nationalLen: null },
];
const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
const byDialDesc = COUNTRIES.filter((c) => c.dial).sort((a, b) => b.dial.length - a.dial.length);

const digitsOf = (raw) => String(raw || '').replace(/\D/g, '');
// A number "states" an international prefix when it is written with + or 00.
const statedIntl = (raw) => {
  let d = digitsOf(raw);
  if (/^\s*\+/.test(String(raw || ''))) return d;
  if (d.startsWith('00')) return d.slice(2);
  return null;
};

// Suggest a country ONLY from what the number itself states. Everything else is
// OTHER — a suggestion here is a pre-filled selector the owner confirms by
// approving, never a silent rewrite.
export function suggestCountry(raw) {
  const intl = statedIntl(raw);
  if (intl) {
    const hit = byDialDesc.find((c) => intl.startsWith(c.dial));
    return hit ? hit.code : 'OTHER';
  }
  const d = digitsOf(raw);
  // Israeli local form: 0 + 8-9 digits. This IS stated, not guessed — it is the
  // same rule the runtime SSOT (normalizePhoneIntl) applies unconditionally.
  if (d.startsWith('0') && !d.startsWith('00') && (d.length === 9 || d.length === 10)) return 'IL';
  // Bare international digits that happen to start with a known dial code and are
  // long enough to be a full number (e.g. "972501234567" typed without +).
  if (!d.startsWith('0') && d.length >= 11 && d.length <= 15) {
    const hit = byDialDesc.find((c) => d.startsWith(c.dial));
    if (hit) return hit.code;
  }
  return 'OTHER';
}

// Normalize an owner-edited value under the owner-selected country.
// Returns { normalized, problems, requiresConfirmation }.
//   * normalized: international digits (no '+') — comparison/matching shape only.
//   * problems:   human-readable validation errors; non-empty ⇒ not approvable.
//   * requiresConfirmation: OTHER-country values import as-is only after the
//     owner explicitly confirms.
export function normalizeForCountry(value, countryCode) {
  const raw = String(value || '').trim();
  if (!raw) return { normalized: null, problems: ['מספר ריק'], requiresConfirmation: false };
  const country = byCode.get(countryCode);
  if (!country) return { normalized: null, problems: [`מדינה לא מוכרת: ${countryCode}`], requiresConfirmation: false };

  const stated = statedIntl(raw);

  if (country.code === 'OTHER') {
    // Preserve the original; import only with explicit confirmation. If the number
    // states a KNOWN dial code, say so — the right fix is selecting that country.
    const hit = stated ? byDialDesc.find((c) => stated.startsWith(c.dial)) : null;
    return {
      normalized: stated && stated.length >= 8 && stated.length <= 15 ? stated : null,
      problems: hit ? [`המספר מציין קידומת ${hit.label} — בחר את המדינה הזו במקום "לא ידוע"`] : [],
      requiresConfirmation: true,
    };
  }

  let intl;
  if (stated) {
    // The number states its country. A mismatch with the selection is an ERROR —
    // never silently rewritten to the selected code.
    if (!stated.startsWith(country.dial)) {
      const actual = byDialDesc.find((c) => stated.startsWith(c.dial));
      return {
        normalized: null,
        problems: [`המספר מציין קידומת ${actual ? actual.label : '+' + stated.slice(0, 3)} אבל נבחרה ${country.label}`],
        requiresConfirmation: false,
      };
    }
    intl = stated;
  } else {
    let d = digitsOf(raw);
    if (d.startsWith(country.dial) && d.length >= country.dial.length + 6 && !d.startsWith('0')) {
      intl = d; // full international digits typed without '+'
    } else {
      // Local form: strip ONE leading trunk zero, prepend the dial code.
      if (d.startsWith('0')) d = d.slice(1);
      intl = `${country.dial}${d}`;
    }
  }

  const problems = [];
  const national = intl.slice(country.dial.length);
  if (national.startsWith('0')) problems.push('ספרת 0 מיותרת אחרי הקידומת');
  if (country.nationalLen) {
    const [min, max] = country.nationalLen;
    if (national.length < min || national.length > max) {
      problems.push(`אורך לא תקין ל${country.label}: ${national.length} ספרות אחרי הקידומת (צפוי ${min === max ? min : `${min}–${max}`})`);
    }
  }
  if (intl.length > 15) problems.push('ארוך מדי למספר טלפון בינלאומי');
  return { normalized: problems.length ? null : intl, problems, requiresConfirmation: false };
}

// The default (untouched) editing row for one raw snapshot phone.
export function defaultPhoneRow(original, index) {
  return {
    original: String(original || ''),
    country: suggestCountry(original),
    value: String(original || ''),
    remove: false,
    isPrimary: index === 0,
    confirmUnverified: false,
  };
}

// Resolve one edited row → what will actually be imported for it.
export function resolvePhoneRow(row) {
  if (row.remove) return { ...row, normalized: null, problems: [], importable: false };
  const { normalized, problems, requiresConfirmation } = normalizeForCountry(row.value, row.country);
  const out = { ...row, normalized, problems: [...problems], importable: false };
  if (requiresConfirmation && !row.confirmUnverified) {
    out.problems.push('מדינה לא ידועה — המספר ייובא כפי שהוא רק לאחר אישור מפורש');
  }
  out.importable = out.problems.length === 0;
  return out;
}
