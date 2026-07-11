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

// Canonical Tour status vocabulary — mirrors the server's TOUR_EVENT_STATUSES
// (server/src/tours/requiredFields.js). ONE label + style mapping for every
// admin surface (table chips, modal, calendar) — never scatter raw strings.
export const TOUR_STATUSES = ['scheduled', 'completed', 'cancelled', 'postponed'];

export const TOUR_STATUS_LABELS = {
  scheduled: 'עתידי',
  completed: 'הסתיים',
  cancelled: 'בוטל',
  postponed: 'נדחה',
};

export const TOUR_STATUS_STYLES = {
  scheduled: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  cancelled: 'bg-red-50 text-red-600 ring-1 ring-inset ring-red-200',
  postponed: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
};

// Calendar event visuals — SAME status semantics as the table chips (the two
// views must read identically): subtle tinted background + a stronger status
// edge on the start side, readable text. Cancelled additionally renders
// muted (it appears only when explicitly requested by the filter).
export const TOUR_STATUS_EVENT_STYLES = {
  scheduled: 'bg-blue-50 border-blue-500 text-blue-950 hover:bg-blue-100',
  completed: 'bg-emerald-50/80 border-emerald-400 text-emerald-900 hover:bg-emerald-100/80',
  cancelled: 'bg-red-50 border-red-400 text-red-800 opacity-75 hover:bg-red-100',
  postponed: 'bg-amber-50 border-amber-400 text-amber-900 hover:bg-amber-100',
};

// Status filter vocabulary — shared by the table AND the calendar view (the
// two are views of the same TourEvent data and must never show different
// datasets under the same filter). 'active' = operationally-live tours (the
// default); cancelled tours appear only when explicitly requested.
export const ACTIVE_STATUSES = ['scheduled', 'postponed'];

export const STATUS_FILTER_OPTIONS = [
  ['active', 'פעילים'],
  ['scheduled', 'עתידיים'],
  ['completed', 'הסתיימו'],
  ['postponed', 'נדחו'],
  ['cancelled', 'בוטלו'],
  ['all', 'הכול'],
];

export function statusFilterMatches(filter, tourStatus) {
  if (filter === 'all') return true;
  if (filter === 'active') return ACTIVE_STATUSES.includes(tourStatus);
  return tourStatus === filter;
}

// Google Calendar mirror status (server: TourEvent.gcalSyncStatus). null =
// the tour was never considered for sync (past/cancelled before the feature
// shipped) — no chip is rendered. Fully automatic: there is no manual sync
// button by product rule; the status is read-only truth from the worker.
export const CALENDAR_SYNC_LABELS = {
  synced: '🟢 מסונכרן ליומן',
  pending: '🟡 ממתין לסנכרון יומן',
  failed: '🔴 שגיאת סנכרון יומן',
};

export const CALENDAR_SYNC_STYLES = {
  synced: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  pending: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  failed: 'bg-red-50 text-red-600 ring-1 ring-inset ring-red-200',
};

// Native-title tooltip content: last sync, last error/warning, event id.
export function calendarSyncTooltip(t) {
  const lines = [];
  if (t.gcalSyncedAt) {
    lines.push(`סנכרון אחרון: ${new Date(t.gcalSyncedAt).toLocaleString('he-IL')}`);
  }
  if (t.gcalSyncError) lines.push(`שגיאה: ${t.gcalSyncError}`);
  if (t.gcalSyncWarning) lines.push(`אזהרה: ${t.gcalSyncWarning}`);
  if (t.gcalEventId) lines.push(`Event ID: ${t.gcalEventId}`);
  return lines.join('\n') || 'טרם סונכרן';
}

// Guide assignment roles — ordered by visual hierarchy (lead first).
export const ASSIGNMENT_ROLES = ['lead_guide', 'guide', 'workshop_assistant'];

export const ASSIGNMENT_ROLE_LABELS = {
  lead_guide: 'מדריך ראשי',
  guide: 'מדריך',
  workshop_assistant: 'עוזר סדנה',
};

// Role colors carry the visual hierarchy on the guide chips (see TourPage
// "צוות משובץ"): lead = green (authority), guide = blue (the default), workshop
// assistant = yellow. Kept obvious and distinct on purpose.
export const ASSIGNMENT_ROLE_STYLES = {
  lead_guide: 'bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-300',
  guide: 'bg-blue-100 text-blue-700 ring-1 ring-inset ring-blue-300',
  workshop_assistant: 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300',
};

// Small solid dot per role — used in the role-picker menu on a chip.
export const ASSIGNMENT_ROLE_DOTS = {
  lead_guide: 'bg-emerald-500',
  guide: 'bg-blue-500',
  workshop_assistant: 'bg-amber-500',
};

// Activity Component tone palette — the closed set of colors an ActivityComponent
// can carry (server validates against the same keys in activityCatalog.js). Each
// tone maps to a soft chip style + a solid dot for the color picker. Tailwind
// can't generate class names dynamically, so the set is fixed on purpose. Used
// EVERYWHERE a component chip renders (settings, product defaults, tour modal,
// deal popover) so a component looks identical across the app.
export const COMPONENT_TONES = ['slate', 'emerald', 'blue', 'amber', 'rose', 'violet', 'cyan'];

export const COMPONENT_TONE_STYLES = {
  slate: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200',
  emerald: 'bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200',
  blue: 'bg-blue-100 text-blue-700 ring-1 ring-inset ring-blue-200',
  amber: 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200',
  rose: 'bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-200',
  violet: 'bg-violet-100 text-violet-800 ring-1 ring-inset ring-violet-200',
  cyan: 'bg-cyan-100 text-cyan-800 ring-1 ring-inset ring-cyan-200',
};

export const COMPONENT_TONE_DOTS = {
  slate: 'bg-slate-500',
  emerald: 'bg-emerald-500',
  blue: 'bg-blue-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  violet: 'bg-violet-500',
  cyan: 'bg-cyan-500',
};

export const componentToneStyle = (tone) => COMPONENT_TONE_STYLES[tone] || COMPONENT_TONE_STYLES.slate;

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
