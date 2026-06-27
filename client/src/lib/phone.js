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

// ISO-2 country code → flag emoji (regional indicator letters).
export function flagEmoji(iso) {
  if (!iso || iso.length !== 2) return '';
  const A = 0x1f1e6;
  const up = iso.toUpperCase();
  return String.fromCodePoint(A + (up.charCodeAt(0) - 65), A + (up.charCodeAt(1) - 65));
}

// Does this environment paint emoji flags as real flag glyphs? macOS/iOS/Android
// do; Windows has no flag font, so a flag emoji collapses to its two ISO letters
// (e.g. "US"). Probed once via a tiny canvas: the Japan flag has a red disc, so a
// true flag glyph leaves red pixels while the "JP" letter fallback stays black.
let _flagsSupported;
export function flagsSupported() {
  if (_flagsSupported !== undefined) return _flagsSupported;
  _flagsSupported = false;
  try {
    if (typeof document === 'undefined') return _flagsSupported;
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 16;
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return _flagsSupported;
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';
    ctx.font = '16px sans-serif';
    ctx.fillText('🇯🇵', 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < data.length; i += 4) {
      // Strong red, weak green/blue, opaque ⇒ the flag's disc was painted.
      if (data[i] > 90 && data[i + 1] < 80 && data[i + 2] < 80 && data[i + 3] > 0) {
        _flagsSupported = true;
        break;
      }
    }
  } catch {
    _flagsSupported = false;
  }
  return _flagsSupported;
}

// The glyph to render for a detected country: the real flag when the platform
// supports flag emoji, otherwise a neutral globe — never the bare ISO letters
// (which is what an unsupported flag emoji silently degrades to). Unknown country
// ⇒ globe too.
export function flagGlyph(iso) {
  return flagsSupported() && iso ? flagEmoji(iso) : '🌐';
}

// Parse a raw phone string into display parts. Never throws.
//   { iso, name, dialCode, national, flag }   (dialCode is '' for local/unknown)
export function parsePhone(raw) {
  const value = String(raw || '').trim();
  if (!value) return { iso: null, name: '', dialCode: '', national: '', flag: '' };

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
          name: countryName(iso),
          dialCode: code,
          national: digits.slice(code.length),
          flag: flagEmoji(iso),
        };
      }
    }
    // Unknown country code — still show it as international.
    return { iso: null, name: '', dialCode: '', national: digits, flag: '' };
  }

  // Local number starting with 0 → default to Israel (not hardcoded-only: any
  // explicit +code above takes precedence over this fallback).
  if (value.startsWith('0')) {
    return { iso: 'IL', name: countryName('IL'), dialCode: '972', national: value, flag: flagEmoji('IL') };
  }

  // Unknown format — show as-is.
  return { iso: null, name: '', dialCode: '', national: value, flag: '' };
}

// A compact one-line display string: flag (or globe fallback) + international
// dial prefix + number, e.g. "🇮🇱 +972 52-426-4020" or "🇺🇸 +1 5551234". The ISO
// letters are intentionally NOT shown (the flag already conveys the country).
// Falls back to the raw value when the country can't be determined.
export function formatPhone(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const { iso, dialCode, national } = parsePhone(value);
  if (!dialCode) return value; // unknown format — show as typed
  // A local Israeli "0…" number keeps its leading 0 in `national`; drop it so it
  // reads as a proper international number under the +972 prefix.
  const rest = value.startsWith('0') ? national.replace(/^0/, '') : national;
  return `${flagGlyph(iso)} +${dialCode} ${rest}`.trim();
}
