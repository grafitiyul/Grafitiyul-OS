// Tours module config — Hebrew labels + styles, single source of truth for the
// operational tours surfaces (list, modals, future tour page). Language
// vocabulary is REUSED from the deals config (the two sync at WON) — never
// redefined here.

export { TOUR_LANGS } from '../deals/config.js';
import { TOUR_LANGS as LANGS } from '../deals/config.js';

export const TOUR_LANG_LABELS = Object.fromEntries(LANGS.map((l) => [l.key, l.label]));

export const TOUR_KINDS = ['private', 'business', 'group_slot'];

export const TOUR_KIND_LABELS = {
  private: 'פרטי',
  business: 'עסקי',
  group_slot: 'קבוצתי',
};

// Same tone family as the deals activity badges (group=amber, private=rose,
// business=emerald) so the two modules read consistently.
export const TOUR_KIND_STYLES = {
  private: 'bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-200',
  business: 'bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200',
  group_slot: 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200',
};

export const TOUR_STATUSES = ['scheduled', 'completed', 'cancelled'];

export const TOUR_STATUS_LABELS = {
  scheduled: 'מתוכנן',
  completed: 'התקיים',
  cancelled: 'בוטל',
};

export const TOUR_STATUS_STYLES = {
  scheduled: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  cancelled: 'bg-red-50 text-red-600 ring-1 ring-inset ring-red-200',
};

// Guide assignment roles — ordered by visual hierarchy (lead first).
export const ASSIGNMENT_ROLES = ['lead_guide', 'guide', 'workshop_assistant'];

export const ASSIGNMENT_ROLE_LABELS = {
  lead_guide: 'מדריך ראשי',
  guide: 'מדריך',
  workshop_assistant: 'עוזר סדנה',
};

export const ASSIGNMENT_ROLE_STYLES = {
  lead_guide: 'bg-indigo-600 text-white',
  guide: 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200',
  workshop_assistant: 'bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200',
};

// Weekday labels, index = TourScheduleRule.weekday (0=Sunday, JS convention).
export const WEEKDAY_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// "יום ה׳ · 06/08/2026" — tours are day-of-week work; every list shows both.
export function fmtTourDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(`${dateStr}T00:00:00`);
    const weekday = d.toLocaleDateString('he-IL', { weekday: 'short' });
    return `${weekday} · ${d.toLocaleDateString('he-IL')}`;
  } catch {
    return dateStr;
  }
}
