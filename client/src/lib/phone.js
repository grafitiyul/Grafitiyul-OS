// Lightweight, dependency-free phone helpers — NOT a full libphonenumber.
// Enough to: detect a country from an international (+) prefix, expose its ISO
// code + name (for the SVG flag + tooltip), and visually separate the dial code
// from the rest of the number. We do NOT
// assume Israel-only: any "+<code>" is detected; a local "0…" number defaults to
// Israel (the primary market) but anything explicitly international wins.

// Common dial codes (longest-first matching matters: 972 before 9, 1, etc.).
const DIAL_CODES = [
  ['1', 'US'], ['7', 'RU'], ['20', 'EG'], ['27', 'ZA'], ['30', 'GR'],
  ['31', 'NL'], ['32', 'BE'], ['33', 'FR'], ['34', 'ES'], ['36', 'HU'],
  ['39', 'IT'], ['40', 'RO'], ['41', 'CH'], ['43', 'AT'], ['44', 'GB'],
  ['45', 'DK'], ['46', 'SE'], ['47', 'NO'], ['48', 'PL'], ['49', 'DE'],
  ['52', 'MX'], ['55', 'BR'], ['61', 'AU'], ['65', 'SG'], ['7', 'RU'],
  ['81', 'JP'], ['82', 'KR'], ['86', 'CN'], ['90', 'TR'], ['91', 'IN'],
  ['212', 'MA'], ['351', 'PT'], ['352', 'LU'], ['353', 'IE'], ['358', 'FI'],
  ['372', 'EE'], ['380', 'UA'], ['420', 'CZ'], ['421', 'SK'], ['852', 'HK'],
  ['971', 'AE'], ['972', 'IL'], ['973', 'BH'], ['966', 'SA'], ['962', 'JO'],
];
// Sort once, longest code first, for greedy prefix matching.
const SORTED = [...DIAL_CODES].sort((a, b) => b[0].length - a[0].length);

// ISO-2 → human country name (English). Lives here, in the shared utility, so UI
// components never carry their own country metadata. Used for hover tooltips.
const COUNTRY_NAMES = {
  US: 'United States', RU: 'Russia', EG: 'Egypt', ZA: 'South Africa',
  GR: 'Greece', NL: 'Netherlands', BE: 'Belgium', FR: 'France', ES: 'Spain',
  HU: 'Hungary', IT: 'Italy', RO: 'Romania', CH: 'Switzerland', AT: 'Austria',
  GB: 'United Kingdom', DK: 'Denmark', SE: 'Sweden', NO: 'Norway', PL: 'Poland',
  DE: 'Germany', MX: 'Mexico', BR: 'Brazil', AU: 'Australia', SG: 'Singapore',
  JP: 'Japan', KR: 'South Korea', CN: 'China', TR: 'Turkey', IN: 'India',
  MA: 'Morocco', PT: 'Portugal', LU: 'Luxembourg', IE: 'Ireland', FI: 'Finland',
  EE: 'Estonia', UA: 'Ukraine', CZ: 'Czechia', SK: 'Slovakia', HK: 'Hong Kong',
  AE: 'United Arab Emirates', IL: 'ישראל', BH: 'Bahrain', SA: 'Saudi Arabia',
  JO: 'Jordan',
};

// ISO-2 country code → full country name (e.g. "IL" → "Israel"). '' if unknown.
export function countryName(iso) {
  return (iso && COUNTRY_NAMES[iso.toUpperCase()]) || '';
}

// Parse a raw phone string into display parts. Never throws.
//   { iso, name, dialCode, national }   (dialCode is '' for local/unknown)
// The country flag itself is rendered as a real SVG by the <CountryFlag>
// component from the `iso` returned here — this utility holds detection +
// metadata only, never any rendering.
export function parsePhone(raw) {
  const value = String(raw || '').trim();
  if (!value) return { iso: null, name: '', dialCode: '', national: '' };

  // International forms: "+972…" or "00972…".
  let intl = null;
  if (value.startsWith('+')) intl = value.slice(1);
  else if (value.startsWith('00')) intl = value.slice(2);

  if (intl !== null) {
    const digits = intl.replace(/\D/g, '');
    for (const [code, iso] of SORTED) {
      if (digits.startsWith(code)) {
        return { iso, name: countryName(iso), dialCode: code, national: digits.slice(code.length) };
      }
    }
    // Unknown country code — still show it as international.
    return { iso: null, name: '', dialCode: '', national: digits };
  }

  // Local number starting with 0 → default to Israel (not hardcoded-only: any
  // explicit +code above takes precedence over this fallback).
  if (value.startsWith('0')) {
    return { iso: 'IL', name: countryName('IL'), dialCode: '972', national: value };
  }

  // Unknown format — show as-is.
  return { iso: null, name: '', dialCode: '', national: value };
}

// The phone number as a one-line string WITHOUT the flag: international dial
// prefix + number, e.g. "+972 52-426-4020" or "+1 5551234". The flag is rendered
// separately as an SVG (see <CountryFlag> / <PhoneDisplay>). Falls back to the
// raw value when the country can't be determined.
export function formatPhoneNumber(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const { dialCode, national } = parsePhone(value);
  if (!dialCode) return value; // unknown format — show as typed
  // A local Israeli "0…" number keeps its leading 0 in `national`; drop it so it
  // reads as a proper international number under the +972 prefix.
  const rest = value.startsWith('0') ? national.replace(/^0/, '') : national;
  return `+${dialCode} ${rest}`.trim();
}
