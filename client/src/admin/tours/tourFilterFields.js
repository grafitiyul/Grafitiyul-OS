// Tours advanced-filter FIELD REGISTRY — the tours screen's vocabulary for the
// shared advanced-filter engine (admin/common/filters/advancedFilterCore.js).
// Adding a filter later = adding one entry here; the engine and the panel UI
// never change. Pure (no React) — unit-tested against list-row fixtures.
//
// Every matcher runs on the rows the table ALREADY loads (the tours list DTO
// with its compact staff/customer summaries) — filtering is client-side, the
// same dataset the table renders, so the counter and the rows always agree.

import {
  matchOrdered,
  matchIsAmong,
} from '../common/filters/advancedFilterCore.js';
import {
  TOUR_KIND_LABELS,
  TOUR_STATUS_LABELS,
  TOUR_LANG_LABELS,
  ASSIGNMENT_ROLE_LABELS,
} from './config.js';

// ---------- row accessors (one place; the DTO shape is the contract) ----------

const names = (list) => (list || []).map((s) => s.name).filter(Boolean);

export function rowGuideNames(t) {
  return names(t.guides);
}
export function rowLeadGuideNames(t) {
  return t.leadGuide?.name ? [t.leadGuide.name] : [];
}
export function rowAssistantNames(t) {
  return names(t.workshopAssistants);
}
export function rowTeamNames(t) {
  return names(t.team);
}
export function rowTeamRoles(t) {
  return [...new Set((t.team || []).map((s) => s.role).filter(Boolean))];
}

// All staff names present in the loaded rows — the value options for the
// staff fields. Deriving from the rows keeps the options exactly the
// matchable values (someone assigned to nothing can never match anyway).
function staffOptions(rows) {
  const all = new Set();
  for (const t of rows || []) for (const n of rowTeamNames(t)) all.add(n);
  return [...all].sort((a, b) => a.localeCompare(b, 'he')).map((n) => ({ value: n, label: n }));
}

function labelOptions(labels) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

// Distinct values of a row accessor across the loaded rows → select options.
function derivedOptions(rows, get) {
  const all = new Set();
  for (const t of rows || []) {
    const v = get(t);
    if (v) all.add(v);
  }
  return [...all].sort((a, b) => a.localeCompare(b, 'he')).map((v) => ({ value: v, label: v }));
}

const productName = (t) => t.product?.nameHe || '';
const cityName = (t) => t.location?.nameHe || t.productVariant?.location?.nameHe || '';

// ---------- the registry ----------

export const TOUR_FILTER_FIELDS = [
  // Staff — the four role scopes the owner asked for, each combinable with
  // AND/OR groups ("מדריך OR מדריך ראשי = שיר" is one OR group of two rows).
  {
    key: 'guide',
    label: 'מדריך',
    type: 'staff',
    options: staffOptions,
    match: (t, op, v) => matchIsAmong(rowGuideNames(t), op, v),
  },
  {
    key: 'leadGuide',
    label: 'מדריך ראשי',
    type: 'staff',
    options: staffOptions,
    match: (t, op, v) => matchIsAmong(rowLeadGuideNames(t), op, v),
  },
  {
    key: 'workshopAssistant',
    label: 'עוזר סדנה',
    type: 'staff',
    options: staffOptions,
    match: (t, op, v) => matchIsAmong(rowAssistantNames(t), op, v),
  },
  {
    key: 'anyStaff',
    label: 'איש צוות (כל תפקיד)',
    type: 'staff',
    options: staffOptions,
    match: (t, op, v) => matchIsAmong(rowTeamNames(t), op, v),
  },
  // "יש בסיור תפקיד X" — role presence regardless of who fills it.
  {
    key: 'staffRole',
    label: 'תפקיד משובץ',
    type: 'select',
    options: () => labelOptions(ASSIGNMENT_ROLE_LABELS),
    match: (t, op, v) => matchIsAmong(rowTeamRoles(t), op, v),
  },
  // Schedule
  {
    key: 'date',
    label: 'תאריך',
    type: 'date',
    match: (t, op, v) => matchOrdered(t.date, op, v),
  },
  {
    key: 'startTime',
    label: 'שעת התחלה',
    type: 'time',
    match: (t, op, v) => matchOrdered(t.startTime, op, v),
  },
  // Classification
  {
    key: 'kind',
    label: 'סוג פעילות',
    type: 'select',
    options: () => labelOptions(TOUR_KIND_LABELS),
    match: (t, op, v) => matchIsAmong([t.kind], op, v),
  },
  {
    key: 'status',
    label: 'סטטוס',
    type: 'select',
    options: () => labelOptions(TOUR_STATUS_LABELS),
    match: (t, op, v) => matchIsAmong([t.status], op, v),
  },
  {
    key: 'product',
    label: 'מוצר',
    type: 'select',
    options: (rows) => derivedOptions(rows, productName),
    match: (t, op, v) => matchIsAmong([productName(t)], op, v),
  },
  {
    key: 'city',
    label: 'עיר',
    type: 'select',
    options: (rows) => derivedOptions(rows, cityName),
    match: (t, op, v) => matchIsAmong([cityName(t)], op, v),
  },
  {
    key: 'language',
    label: 'שפה',
    type: 'select',
    options: () => labelOptions(TOUR_LANG_LABELS),
    match: (t, op, v) => matchIsAmong([t.tourLanguage], op, v),
  },
  {
    key: 'notes',
    label: 'הערות',
    type: 'text',
    match: (t, op, v) =>
      op === 'contains' && String(t.notes || '').toLowerCase().includes(String(v).toLowerCase()),
  },
];

export const TOUR_FILTER_FIELDS_BY_KEY = Object.fromEntries(
  TOUR_FILTER_FIELDS.map((f) => [f.key, f]),
);
