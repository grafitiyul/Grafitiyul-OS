// Shared display formatting for the Guide Portal — one vocabulary for every
// portal surface (cards, detail, past list), in the guide's language.
//
// Every function takes the language explicitly: nothing here holds state and
// nothing guesses. The words themselves live in the ONE registry (i18n.js);
// this file only assembles them around numbers and dates.

import { portalStrings } from './i18n.js';

// Role → chip tone (spec: lead=green, guide=blue, assistant=yellow). Colour is
// presentation, not language — it stays shared across both.
export const ROLE_STYLES = {
  lead_guide: 'bg-emerald-100 text-emerald-800',
  guide: 'bg-blue-100 text-blue-800',
  workshop_assistant: 'bg-amber-100 text-amber-800',
};

export function roleLabel(role, lang) {
  return portalStrings(lang).roles[role] || null;
}

export function activityLabel(activityType, lang) {
  return portalStrings(lang).activityTypes[activityType] || null;
}

// The language a tour is DELIVERED in, named in the READER's language.
export function tourLanguageLabel(tourLanguage, lang) {
  return portalStrings(lang).tourLanguages[tourLanguage] || null;
}

// "21.07.2026" — a numeric date reads the same in both languages, and keeping
// one format avoids a guide misreading a day as a month mid-shift.
export function fmtDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return ymd || '';
  return `${m[3]}.${m[2]}.${m[1]}`;
}

// "יום שלישי · 21.07.2026" / "Tuesday · 21.07.2026" — the operational way a
// guide thinks about a date.
export function fmtDayLine(ymd, lang) {
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return fmtDate(ymd);
  const s = portalStrings(lang).dates;
  return `${s.dayPrefix}${s.weekdays[d.getDay()]} · ${fmtDate(ymd)}`;
}

export function monthName(mm, lang) {
  const idx = Number(mm) - 1;
  return portalStrings(lang).dates.months[idx] || mm;
}

// "מרץ 2026" / "March 2026" — the payroll month picker.
export function fmtMonthLabel(month, lang) {
  const [y, mm] = String(month || '').split('-');
  return `${monthName(mm, lang)} ${y}`;
}

/** BCP-47 tag for Intl date/time formatting on portal surfaces. */
export function portalLocale(lang) {
  return portalStrings(lang).dates.locale;
}

export function isToday(ymd) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  return ymd === today;
}

// Participant count, written fully ("25 משתתפים" / "25 participants").
export function participantsLabel(n, lang) {
  const count = Number(n) || 0;
  const s = portalStrings(lang).participants;
  return count === 1 ? s.one : s.many(count);
}
