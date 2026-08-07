// THE natural-language date humanizer for messages people read.
//
// "3/8/2026" is a fact; "אתמול" is what a human writing to a guide actually
// says. This module renders a calendar date RELATIVE TO TODAY IN ISRAEL, in the
// two languages GOS sends in, and it is the ONE implementation — the variable
// registry calls it, so the preview and the actual send resolve through the
// same function by construction and can never disagree.
//
// Rule (owner spec, 2026-08-07), symmetric around today:
//   0 days      → היום / today
//   -1 / +1     → אתמול / yesterday · מחר / tomorrow
//   ±2 … ±4     → the weekday name (יום שני / Monday)
//   further out → short day.month ("3.7", "14.8")
//
// Why the far bucket is day-first in BOTH languages: that is already this
// project's documented convention (communication/format.js formatDateHe —
// "both languages use the Israeli day-first form"). A guide reading an English
// message here is a guide working in Israel; inventing a second, month-first
// convention for them is how two surfaces start disagreeing about what "3.7"
// means.
//
// The weekday bucket is deliberately narrow (±4 days). Beyond that "יום שני"
// stops being unambiguous — it could be this week's or last week's — and a
// short numeric date is the honest answer.

import { israelToday, isValidDate, weekdayOf } from '../lib/israelDate.js';

const WEEKDAYS_HE = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const RELATIVE = {
  he: { 0: 'היום', '-1': 'אתמול', 1: 'מחר' },
  en: { 0: 'today', '-1': 'yesterday', 1: 'tomorrow' },
};

/** Whole-day difference between two "YYYY-MM-DD" calendar dates (UTC-anchored). */
function dayDiff(dateStr, todayStr) {
  const a = Date.parse(`${dateStr}T00:00:00Z`);
  const b = Date.parse(`${todayStr}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

/** "YYYY-MM-DD" → "3.7" (day.month, no leading zeros, no year). */
export function shortDayMonth(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? ''));
  if (!m) return null;
  return `${Number(m[3])}.${Number(m[2])}`;
}

/**
 * The natural label for a calendar date.
 *
 * @param {string} dateStr  "YYYY-MM-DD"
 * @param {'he'|'en'} lang
 * @param {number} [nowMs]  injectable clock (tests + deterministic rendering)
 * @returns {string|null}   null when the date is missing/invalid — a caller
 *                          must report a missing value, never invent one.
 */
export function naturalDateLabel(dateStr, lang = 'he', nowMs = Date.now()) {
  if (!isValidDate(dateStr)) return null;
  const language = lang === 'en' ? 'en' : 'he';
  const diff = dayDiff(dateStr, israelToday(nowMs));
  if (diff === null) return null;

  const relative = RELATIVE[language][String(diff)];
  if (relative) return relative;

  if (Math.abs(diff) <= 4) {
    const idx = weekdayOf(dateStr);
    return (language === 'en' ? WEEKDAYS_EN : WEEKDAYS_HE)[idx] || shortDayMonth(dateStr);
  }
  return shortDayMonth(dateStr);
}
