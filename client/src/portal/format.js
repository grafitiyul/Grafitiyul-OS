// Shared display formatting for the Guide Portal — one vocabulary for every
// portal surface (cards, detail, past list). Hebrew-first, operational tone.

export const ROLE_LABELS = {
  lead_guide: 'מדריך ראשי',
  guide: 'מדריך',
  workshop_assistant: 'עוזר סדנה',
};

// Role → chip tone (spec: lead=green, guide=blue, assistant=yellow).
export const ROLE_STYLES = {
  lead_guide: 'bg-emerald-100 text-emerald-800',
  guide: 'bg-blue-100 text-blue-800',
  workshop_assistant: 'bg-amber-100 text-amber-800',
};

export const ACTIVITY_LABELS = {
  group: 'סיור קבוצתי',
  private: 'סיור פרטי',
  business: 'סיור עסקי',
};

export const TOUR_LANG_LABELS = {
  he: 'עברית',
  en: 'אנגלית',
  es: 'ספרדית',
  fr: 'צרפתית',
  ru: 'רוסית',
};

const WEEKDAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export function fmtDateHe(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return ymd || '';
  return `${m[3]}.${m[2]}.${m[1]}`;
}

// "יום שלישי · 21.07" — the operational way a guide thinks about a date.
export function fmtDayLineHe(ymd) {
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return fmtDateHe(ymd);
  return `יום ${WEEKDAYS_HE[d.getDay()]} · ${fmtDateHe(ymd)}`;
}

export function isToday(ymd) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  return ymd === today;
}

// Participant count, written fully (spec: "25 משתתפים").
export function participantsLabel(n) {
  const count = Number(n) || 0;
  if (count === 1) return 'משתתף אחד';
  return `${count} משתתפים`;
}
