// Stable keys + display metadata for the payroll module. Logic references
// keys, never the Hebrew labels. Statuses are DERIVED server-side
// (routes/payroll.js activityDisplayStatus) — this file only styles them.

export const ACTIVITY_STATUS_META = {
  missing: { label: 'חסר שכר', cls: 'bg-gray-100 text-gray-600' },
  draft: { label: 'טיוטה', cls: 'bg-amber-50 text-amber-700' },
  waiting_guide: { label: 'ממתין למדריך', cls: 'bg-blue-50 text-blue-700' },
  inquiry: { label: 'בבירור', cls: 'bg-orange-50 text-orange-700' },
  completed: { label: 'הושלם', cls: 'bg-emerald-50 text-emerald-700' },
  cancelled: { label: 'בוטל', cls: 'bg-gray-100 text-gray-400' },
};

export const GUIDE_STATUS_META = {
  pending: { label: 'ממתין לאישור', cls: 'bg-blue-50 text-blue-700' },
  approved: { label: 'אושר', cls: 'bg-emerald-50 text-emerald-700' },
  inquiry: { label: 'בבירור', cls: 'bg-orange-50 text-orange-700' },
};

export const ROLE_LABELS = {
  lead_guide: 'מדריך ראשי',
  guide: 'מדריך',
  workshop_assistant: 'עוזר סדנה',
};
