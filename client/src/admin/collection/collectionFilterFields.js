// Collection advanced-filter FIELD REGISTRY — the Collection screen's
// vocabulary for the SHARED advanced-filter engine
// (admin/common/filters/advancedFilterCore.js), the same one the Tours screen
// uses. No new filtering system: adding a filter later is one entry here, and
// the engine and panel never change.
//
// Every matcher runs on the rows the table ALREADY loads (the collection list
// DTO), so the filter count and the visible rows can never disagree.
//
// Pure (no React) and unit-tested against list-row fixtures.

import { matchOrdered, matchIsAmong } from '../common/filters/advancedFilterCore.js';
import {
  COLLECTION_STATUS_LABELS,
  COLLECTION_REVIEW_STATUS_LABELS,
  PAYMENT_REVIEW_STATUS_LABELS,
} from './collectionConfig.js';

// Distinct values of a row accessor across the loaded rows → select options.
function derivedOptions(rows, get) {
  const all = new Set();
  for (const r of rows || []) {
    const v = get(r);
    if (Array.isArray(v)) v.forEach((x) => x && all.add(x));
    else if (v) all.add(v);
  }
  return [...all].sort((a, b) => String(a).localeCompare(String(b), 'he')).map((v) => ({ value: v, label: v }));
}

const labelOptions = (labels) => Object.entries(labels).map(([value, label]) => ({ value, label }));

const orgName = (r) => r.organization?.name || '';
const productName = (r) => r.product?.name || '';
const variantName = (r) => r.productVariant?.name || '';
const cityName = (r) => r.city?.name || '';
const guideNames = (r) => r.guides || [];

// Money is filtered in MAJOR units — an operator thinks in shekels, not agorot.
const majorOf = (minor) => Number(minor || 0) / 100;

export const ACTIVITY_TYPE_LABELS = {
  group: 'קבוצה',
  private: 'פרטי',
  business: 'עסקי',
};

export const CUSTOMER_KIND_LABELS = {
  business: 'עסקי',
  private: 'פרטי',
};

export const COLLECTION_FILTER_FIELDS = [
  // ── The operational question this screen exists to answer ────────────────
  {
    key: 'collectionReviewStatus',
    label: 'סטטוס טיפול בגבייה',
    type: 'select',
    options: () => labelOptions(COLLECTION_REVIEW_STATUS_LABELS),
    match: (r, op, v) => matchIsAmong([r.collectionReviewStatus].filter(Boolean), op, v),
  },
  {
    key: 'status',
    label: 'סטטוס תשלום',
    type: 'select',
    options: () => labelOptions(COLLECTION_STATUS_LABELS),
    match: (r, op, v) => matchIsAmong([r.status].filter(Boolean), op, v),
  },
  {
    key: 'paymentReviewStatus',
    label: 'בדיקת מקדמה/תשלום מלא',
    type: 'select',
    options: () => labelOptions(PAYMENT_REVIEW_STATUS_LABELS),
    match: (r, op, v) => matchIsAmong([r.paymentReviewStatus].filter(Boolean), op, v),
  },
  // ── Customer ─────────────────────────────────────────────────────────────
  {
    key: 'customerKind',
    label: 'פרטי / עסקי',
    type: 'select',
    options: () => labelOptions(CUSTOMER_KIND_LABELS),
    match: (r, op, v) => matchIsAmong([r.customerKind].filter(Boolean), op, v),
  },
  {
    key: 'organization',
    label: 'ארגון',
    type: 'select',
    options: (rows) => derivedOptions(rows, orgName),
    match: (r, op, v) => matchIsAmong([orgName(r)].filter(Boolean), op, v),
  },
  {
    key: 'owner',
    label: 'אחראי עסקה',
    type: 'select',
    options: (rows) => derivedOptions(rows, (r) => r.ownerName),
    match: (r, op, v) => matchIsAmong([r.ownerName].filter(Boolean), op, v),
  },
  // ── Tour context ─────────────────────────────────────────────────────────
  {
    key: 'activityType',
    label: 'סוג פעילות',
    type: 'select',
    options: () => labelOptions(ACTIVITY_TYPE_LABELS),
    match: (r, op, v) => matchIsAmong([r.activityType].filter(Boolean), op, v),
  },
  {
    key: 'product',
    label: 'מוצר',
    type: 'select',
    options: (rows) => derivedOptions(rows, productName),
    match: (r, op, v) => matchIsAmong([productName(r)].filter(Boolean), op, v),
  },
  {
    key: 'productVariant',
    label: 'וריאנט',
    type: 'select',
    options: (rows) => derivedOptions(rows, variantName),
    match: (r, op, v) => matchIsAmong([variantName(r)].filter(Boolean), op, v),
  },
  {
    key: 'city',
    label: 'עיר',
    type: 'select',
    options: (rows) => derivedOptions(rows, cityName),
    match: (r, op, v) => matchIsAmong([cityName(r)].filter(Boolean), op, v),
  },
  {
    key: 'guide',
    label: 'מדריך',
    type: 'staff',
    options: (rows) => derivedOptions(rows, guideNames),
    match: (r, op, v) => matchIsAmong(guideNames(r), op, v),
  },
  // ── Dates ────────────────────────────────────────────────────────────────
  {
    key: 'tourDate',
    label: 'תאריך סיור',
    type: 'date',
    match: (r, op, v) => matchOrdered(r.tourDate, op, v),
  },
  {
    key: 'createdAt',
    label: 'תאריך יצירה',
    type: 'date',
    match: (r, op, v) => matchOrdered(r.createdAt ? String(r.createdAt).slice(0, 10) : '', op, v),
  },
  {
    key: 'wonAt',
    label: 'תאריך סגירה',
    type: 'date',
    match: (r, op, v) => matchOrdered(r.wonAt ? String(r.wonAt).slice(0, 10) : '', op, v),
  },
  {
    key: 'lastPaymentAt',
    label: 'תשלום אחרון',
    type: 'date',
    match: (r, op, v) => matchOrdered(r.lastPaymentAt ? String(r.lastPaymentAt).slice(0, 10) : '', op, v),
  },
  // ── Money (shekels, not agorot — the operator's unit) ────────────────────
  {
    key: 'balance',
    label: 'יתרה לגבייה',
    type: 'number',
    match: (r, op, v) => matchOrdered(majorOf(r.balanceMinor), op, Number(v)),
  },
  {
    key: 'total',
    label: 'סך העסקה',
    type: 'number',
    match: (r, op, v) => matchOrdered(majorOf(r.totalMinor), op, Number(v)),
  },
  {
    key: 'paid',
    label: 'שולם',
    type: 'number',
    match: (r, op, v) => matchOrdered(majorOf(r.paidMinor), op, Number(v)),
  },
];

export const COLLECTION_FILTER_FIELDS_BY_KEY = Object.fromEntries(
  COLLECTION_FILTER_FIELDS.map((f) => [f.key, f]),
);
