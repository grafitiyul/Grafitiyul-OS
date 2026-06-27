// Lightweight, dependency-free phone helpers — NOT a full libphonenumber.
// Enough to: detect a country from an international (+) prefix, render a flag,
// and visually separate the dial code from the rest of the number. We do NOT
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

// ISO-2 country code → flag emoji (regional indicator letters).
export function flagEmoji(iso) {
  if (!iso || iso.length !== 2) return '';
  const A = 0x1f1e6;
  const up = iso.toUpperCase();
  return String.fromCodePoint(A + (up.charCodeAt(0) - 65), A + (up.charCodeAt(1) - 65));
}

// Parse a raw phone string into display parts. Never throws.
//   { iso, dialCode, national, flag }   (dialCode is '' for local/unknown)
export function parsePhone(raw) {
  const value = String(raw || '').trim();
  if (!value) return { iso: null, dialCode: '', national: '', flag: '' };

  // International forms: "+972…" or "00972…".
  let intl = null;
  if (value.startsWith('+')) intl = value.slice(1);
  else if (value.startsWith('00')) intl = value.slice(2);

  if (intl !== null) {
    const digits = intl.replace(/\D/g, '');
    for (const [code, iso] of SORTED) {
      if (digits.startsWith(code)) {
        return {
          iso,
          dialCode: code,
          national: digits.slice(code.length),
          flag: flagEmoji(iso),
        };
      }
    }
    // Unknown country code — still show it as international.
    return { iso: null, dialCode: '', national: digits, flag: '' };
  }

  // Local number starting with 0 → default to Israel (not hardcoded-only: any
  // explicit +code above takes precedence over this fallback).
  if (value.startsWith('0')) {
    return { iso: 'IL', dialCode: '972', national: value, flag: flagEmoji('IL') };
  }

  // Unknown format — show as-is.
  return { iso: null, dialCode: '', national: value, flag: '' };
}

// A compact one-line display string: "🇮🇱 +972 50-000-0000" style, but kept
// simple — flag, separated dial code (for true international), then the rest.
export function formatPhone(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const { flag, dialCode, national } = parsePhone(value);
  // Local (Israeli "0…") numbers read most naturally as-is with just the flag.
  if (value.startsWith('0')) return `${flag} ${value}`.trim();
  if (dialCode) return `${flag} +${dialCode} ${national}`.trim();
  return value;
}
