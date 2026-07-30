// Lightweight, dependency-free phone helpers — NOT a full libphonenumber.
// Enough to: detect a country from an international (+) prefix, expose its ISO
// code + name (for the SVG flag + tooltip), and visually separate the dial code
// from the rest of the number. We do NOT
// assume Israel-only: any "+<code>" is detected; a local "0…" number defaults to
// Israel (the primary market) but anything explicitly international wins.

// Common dial codes (longest-first matching matters: 972 before 9, 1, etc.).
// ONE table for the whole client — merged 2026-07-30 from the WhatsApp-only
// PhoneFlag map (which was the richer of the two duplicate lists); shared
// codes map to their dominant country (1 → US, 7 → RU) as a scanning aid.
const DIAL_CODES = [
  ['1', 'US'], ['7', 'RU'], ['20', 'EG'], ['27', 'ZA'], ['30', 'GR'],
  ['31', 'NL'], ['32', 'BE'], ['33', 'FR'], ['34', 'ES'], ['36', 'HU'],
  ['39', 'IT'], ['40', 'RO'], ['41', 'CH'], ['43', 'AT'], ['44', 'GB'],
  ['45', 'DK'], ['46', 'SE'], ['47', 'NO'], ['48', 'PL'], ['49', 'DE'],
  ['51', 'PE'], ['52', 'MX'], ['54', 'AR'], ['55', 'BR'], ['56', 'CL'],
  ['57', 'CO'], ['58', 'VE'], ['60', 'MY'], ['61', 'AU'], ['62', 'ID'],
  ['63', 'PH'], ['64', 'NZ'], ['65', 'SG'], ['66', 'TH'], ['81', 'JP'],
  ['82', 'KR'], ['84', 'VN'], ['86', 'CN'], ['90', 'TR'], ['91', 'IN'],
  ['92', 'PK'], ['94', 'LK'], ['95', 'MM'], ['98', 'IR'],
  ['212', 'MA'], ['213', 'DZ'], ['216', 'TN'], ['218', 'LY'], ['220', 'GM'],
  ['221', 'SN'], ['233', 'GH'], ['234', 'NG'], ['251', 'ET'], ['254', 'KE'],
  ['255', 'TZ'], ['256', 'UG'], ['260', 'ZM'], ['263', 'ZW'],
  ['351', 'PT'], ['352', 'LU'], ['353', 'IE'], ['354', 'IS'], ['355', 'AL'],
  ['356', 'MT'], ['357', 'CY'], ['358', 'FI'], ['359', 'BG'], ['370', 'LT'],
  ['371', 'LV'], ['372', 'EE'], ['373', 'MD'], ['374', 'AM'], ['375', 'BY'],
  ['376', 'AD'], ['380', 'UA'], ['381', 'RS'], ['385', 'HR'], ['386', 'SI'],
  ['387', 'BA'], ['389', 'MK'], ['420', 'CZ'], ['421', 'SK'], ['423', 'LI'],
  ['502', 'GT'], ['503', 'SV'], ['504', 'HN'], ['505', 'NI'], ['506', 'CR'],
  ['507', 'PA'], ['509', 'HT'], ['591', 'BO'], ['593', 'EC'], ['595', 'PY'],
  ['598', 'UY'], ['852', 'HK'], ['853', 'MO'], ['855', 'KH'], ['856', 'LA'],
  ['880', 'BD'], ['886', 'TW'],
  ['960', 'MV'], ['961', 'LB'], ['962', 'JO'], ['963', 'SY'], ['964', 'IQ'],
  ['965', 'KW'], ['966', 'SA'], ['967', 'YE'], ['968', 'OM'], ['970', 'PS'],
  ['971', 'AE'], ['972', 'IL'], ['973', 'BH'], ['974', 'QA'], ['975', 'BT'],
  ['976', 'MN'], ['977', 'NP'], ['992', 'TJ'], ['993', 'TM'], ['994', 'AZ'],
  ['995', 'GE'], ['996', 'KG'], ['998', 'UZ'],
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
  PE: 'Peru', AR: 'Argentina', CL: 'Chile', CO: 'Colombia', VE: 'Venezuela',
  MY: 'Malaysia', ID: 'Indonesia', PH: 'Philippines', NZ: 'New Zealand',
  TH: 'Thailand', VN: 'Vietnam', PK: 'Pakistan', LK: 'Sri Lanka',
  MM: 'Myanmar', IR: 'Iran', DZ: 'Algeria', TN: 'Tunisia', LY: 'Libya',
  GM: 'Gambia', SN: 'Senegal', GH: 'Ghana', NG: 'Nigeria', ET: 'Ethiopia',
  KE: 'Kenya', TZ: 'Tanzania', UG: 'Uganda', ZM: 'Zambia', ZW: 'Zimbabwe',
  IS: 'Iceland', AL: 'Albania', MT: 'Malta', CY: 'Cyprus', BG: 'Bulgaria',
  LT: 'Lithuania', LV: 'Latvia', MD: 'Moldova', AM: 'Armenia', BY: 'Belarus',
  AD: 'Andorra', RS: 'Serbia', HR: 'Croatia', SI: 'Slovenia',
  BA: 'Bosnia and Herzegovina', MK: 'North Macedonia', LI: 'Liechtenstein',
  GT: 'Guatemala', SV: 'El Salvador', HN: 'Honduras', NI: 'Nicaragua',
  CR: 'Costa Rica', PA: 'Panama', HT: 'Haiti', BO: 'Bolivia', EC: 'Ecuador',
  PY: 'Paraguay', UY: 'Uruguay', MO: 'Macau', KH: 'Cambodia', LA: 'Laos',
  BD: 'Bangladesh', TW: 'Taiwan', MV: 'Maldives', LB: 'Lebanon', SY: 'Syria',
  IQ: 'Iraq', KW: 'Kuwait', YE: 'Yemen', OM: 'Oman', PS: 'Palestine',
  QA: 'Qatar', BT: 'Bhutan', MN: 'Mongolia', NP: 'Nepal', TJ: 'Tajikistan',
  TM: 'Turkmenistan', AZ: 'Azerbaijan', GE: 'Georgia', KG: 'Kyrgyzstan',
  UZ: 'Uzbekistan',
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

// ── THE display formatter (product rule, 2026-07-30) ────────────────────────
// Storage, matching, sending and dedup ALWAYS use the canonical international
// digits ('972521234567'); this function is display-ONLY:
//   Israeli  → local:          972521234567 / 0521234567 / +972 52…  → 052-123-4567
//   foreign  → international:  447974905044                          → +44 7974905044
//   unknown  → as typed.
// Accepts every stored shape: '+972…', '00972…', bare international digits
// (WhatsApp's canonical form — parsePhone above deliberately does NOT guess on
// bare digits because contact-page values are as-typed, but here the caller is
// saying "this IS a phone"), and local '0…'.
export function formatPhoneDisplay(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  let digits = value.replace(/\D/g, '');
  if (value.startsWith('+')) {
    /* digits already international */
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    // Local Israeli form → canonical.
    if (digits.length === 9 || digits.length === 10) digits = `972${digits.slice(1)}`;
    else return value; // unknown local shape — show as typed
  }
  // Israeli → local grouping. Mobile 05X-XXX-XXXX; landline 0X-XXX-XXXX.
  if (digits.startsWith('972')) {
    const local = `0${digits.slice(3)}`;
    if (local.length === 10) return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
    if (local.length === 9) return `${local.slice(0, 2)}-${local.slice(2, 5)}-${local.slice(5)}`;
    return local;
  }
  // Foreign → international with the dial code split out.
  if (digits.length >= 10 && digits.length <= 15) {
    for (const [code] of SORTED) {
      if (digits.startsWith(code)) return `+${code} ${digits.slice(code.length)}`;
    }
    return `+${digits}`;
  }
  return value;
}

// ISO code for BARE international digits ('4915…' → 'DE'). Israeli numbers
// return null ON PURPOSE — the home country needs no flag decoration; unknown
// prefixes return null (never guess). This is the detection half of the
// WhatsApp PhoneFlag, promoted here so there is exactly one prefix table for
// bare-digit phones (parsePhone handles the '+'/'00'/local-typed forms).
export function isoForIntlDigits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits || digits.startsWith('972')) return null;
  for (const len of [3, 2, 1]) {
    const code = digits.slice(0, len);
    const hit = SORTED.find(([c]) => c === code);
    if (hit) return hit[1];
  }
  return null;
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
