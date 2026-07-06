// Country flag for FOREIGN phone numbers — a small scanning aid next to the
// number. Israeli numbers (972) deliberately show nothing (the default case
// needs no decoration). Detection is by international calling-code prefix on
// the normalized digits; unknown prefixes show NO flag (never guess).
//
// Flags are the flag-icons SVG set (bundled, content-hashed assets — safe
// immutable caching), NOT emoji: Windows renders flag emoji as bare letters.
import 'flag-icons/css/flag-icons.min.css';

// Calling code → ISO 3166-1 alpha-2. Longest-prefix match (3 → 2 → 1).
// Shared codes map to their dominant country (1 → US, 7 → RU) — a scanning
// aid, not a legal attribution. 972 maps to null ON PURPOSE (no flag at home).
const CC = {
  // 3-digit
  212: 'ma', 213: 'dz', 216: 'tn', 218: 'ly', 220: 'gm', 221: 'sn', 233: 'gh',
  234: 'ng', 251: 'et', 254: 'ke', 255: 'tz', 256: 'ug', 260: 'zm', 263: 'zw',
  351: 'pt', 352: 'lu', 353: 'ie', 354: 'is', 355: 'al', 356: 'mt', 357: 'cy',
  358: 'fi', 359: 'bg', 370: 'lt', 371: 'lv', 372: 'ee', 373: 'md', 374: 'am',
  375: 'by', 376: 'ad', 380: 'ua', 381: 'rs', 385: 'hr', 386: 'si', 387: 'ba',
  389: 'mk', 420: 'cz', 421: 'sk', 423: 'li', 502: 'gt', 503: 'sv', 504: 'hn',
  505: 'ni', 506: 'cr', 507: 'pa', 509: 'ht', 591: 'bo', 593: 'ec', 595: 'py',
  598: 'uy', 852: 'hk', 853: 'mo', 855: 'kh', 856: 'la', 880: 'bd', 886: 'tw',
  960: 'mv', 961: 'lb', 962: 'jo', 963: 'sy', 964: 'iq', 965: 'kw', 966: 'sa',
  967: 'ye', 968: 'om', 970: 'ps', 971: 'ae', 972: null, 973: 'bh', 974: 'qa',
  975: 'bt', 976: 'mn', 977: 'np', 992: 'tj', 993: 'tm', 994: 'az', 995: 'ge',
  996: 'kg', 998: 'uz',
  // 2-digit
  20: 'eg', 27: 'za', 30: 'gr', 31: 'nl', 32: 'be', 33: 'fr', 34: 'es',
  36: 'hu', 39: 'it', 40: 'ro', 41: 'ch', 43: 'at', 44: 'gb', 45: 'dk',
  46: 'se', 47: 'no', 48: 'pl', 49: 'de', 51: 'pe', 52: 'mx', 54: 'ar',
  55: 'br', 56: 'cl', 57: 'co', 58: 've', 60: 'my', 61: 'au', 62: 'id',
  63: 'ph', 64: 'nz', 65: 'sg', 66: 'th', 81: 'jp', 82: 'kr', 84: 'vn',
  86: 'cn', 90: 'tr', 91: 'in', 92: 'pk', 94: 'lk', 95: 'mm', 98: 'ir',
  // 1-digit
  1: 'us', 7: 'ru',
};

// ISO code for an international-digits phone ('4915…' → 'de'), or null for
// Israeli / undetected numbers.
export function countryForPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  for (const len of [3, 2, 1]) {
    const prefix = Number(digits.slice(0, len));
    if (Object.prototype.hasOwnProperty.call(CC, prefix)) return CC[prefix];
  }
  return null;
}

export default function PhoneFlag({ phone }) {
  const iso = countryForPhone(phone);
  if (!iso) return null;
  return (
    <span
      className={`fi fi-${iso} shrink-0 rounded-[2px]`}
      style={{ fontSize: 9 }}
      title={iso.toUpperCase()}
      aria-label={iso.toUpperCase()}
    />
  );
}
