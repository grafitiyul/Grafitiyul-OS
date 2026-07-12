// Stable keys + display metadata for the payroll module. Logic references
// keys, never the Hebrew labels. Statuses are DERIVED server-side
// (routes/payroll.js activityDisplayStatus) — this file only styles them.

export const ACTIVITY_STATUS_META = {
  missing: { label: 'חסר שכר', cls: 'bg-gray-100 text-gray-600' },
  draft: { label: 'טיוטה', cls: 'bg-amber-50 text-amber-700' },
  partially_approved: { label: 'אושר חלקית', cls: 'bg-violet-50 text-violet-700' },
  waiting_guide: { label: 'ממתין למדריך', cls: 'bg-blue-50 text-blue-700' },
  inquiry: { label: 'בבירור', cls: 'bg-orange-50 text-orange-700' },
  completed: { label: 'אושר', cls: 'bg-emerald-50 text-emerald-700' },
  cancelled: { label: 'בוטל', cls: 'bg-gray-100 text-gray-400' },
  voided: { label: 'בוטל', cls: 'bg-gray-100 text-gray-400' },
};

export const GUIDE_STATUS_META = {
  pending: { label: 'ממתין לאישור', cls: 'bg-blue-50 text-blue-700' },
  approved: { label: 'אושר', cls: 'bg-emerald-50 text-emerald-700' },
  inquiry: { label: 'בבירור', cls: 'bg-orange-50 text-orange-700' },
};

// Full per-entry status (matrix column chips + focused editor header) —
// derives from state + officeStatus + guideStatus, one place.
export function entryStatusMeta(entry) {
  if (entry.state !== 'active') return { key: 'voided', label: 'בוטל', cls: 'bg-gray-100 text-gray-400' };
  if (entry.officeStatus !== 'approved') return { key: 'draft', label: 'טיוטה', cls: 'bg-amber-50 text-amber-700' };
  if (entry.guideStatus === 'inquiry') return { key: 'inquiry', label: 'בבירור', cls: 'bg-orange-50 text-orange-700' };
  if (entry.guideStatus === 'approved') return { key: 'guide_approved', label: 'אושר על ידי המדריך', cls: 'bg-emerald-50 text-emerald-700' };
  return { key: 'office_approved', label: 'ממתין לאישור מדריך', cls: 'bg-blue-50 text-blue-700' };
}

export const ROLE_LABELS = {
  lead_guide: 'מדריך ראשי',
  guide: 'מדריך',
  workshop_assistant: 'עוזר סדנה',
};
