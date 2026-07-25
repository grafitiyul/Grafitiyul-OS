// Display formatting for resolved communication variables — pure helpers.

export const TOUR_LANG_LABELS = {
  he: { he: 'עברית', en: 'אנגלית', es: 'ספרדית', fr: 'צרפתית', ru: 'רוסית' },
  en: { he: 'Hebrew', en: 'English', es: 'Spanish', fr: 'French', ru: 'Russian' },
};

// Business-facing activity labels (the Deal activityType string enum) —
// mirrors the client SSOT (admin/deals/config.js), never the technical value.
export const ACTIVITY_TYPE_LABELS = {
  he: { group: 'קבוצתי', private: 'פרטי', business: 'עסקי' },
  en: { group: 'Group', private: 'Private', business: 'Business' },
};

/** "YYYY-MM-DD" → "DD/MM/YYYY" (both languages use the Israeli day-first form). */
export function formatDateHe(dateStr, _lang = 'he') {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? ''));
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Minor units → "₪1,234" / "₪1,234.50". Null-safe. */
export function formatMoney(minor, currency = 'ILS') {
  if (minor == null) return null;
  const n = Number(minor);
  if (!Number.isFinite(n)) return null;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const symbol = currency === 'ILS' || !currency ? '₪' : `${currency} `;
  const wholeStr = whole.toLocaleString('en-US');
  return cents ? `${sign}${symbol}${wholeStr}.${String(cents).padStart(2, '0')}` : `${sign}${symbol}${wholeStr}`;
}
