// Stable keys and display labels for the guide management module.
// Logic always references keys, never Hebrew labels.

export const IDENTITY_SOURCES = {
  RECRUITMENT: 'recruitment',
  MANAGEMENT: 'management',
};

export const IDENTITY_SOURCE_LABELS = {
  [IDENTITY_SOURCES.RECRUITMENT]: 'מקור: מערכת הגיוס',
  [IDENTITY_SOURCES.MANAGEMENT]: 'מקור: ניהול',
};

export const PERSON_STATUSES = {
  ACTIVE: 'active',
  BLOCKED: 'blocked',
};

export const PERSON_STATUS_LABELS = {
  [PERSON_STATUSES.ACTIVE]: 'פעיל',
  [PERSON_STATUSES.BLOCKED]: 'חסום',
};

// Procedure-state labels for the three sections in the admin guide profile
// and (later) the learner portal. Keys come back from /api/people/:id/procedures.
export const PROCEDURE_STATES = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  WAITING: 'waiting_for_approval',
  NEEDS_CORRECTION: 'needs_correction',
  APPROVED: 'approved',
};

export const PROCEDURE_STATE_LABELS = {
  [PROCEDURE_STATES.NOT_STARTED]: 'לא התחיל',
  [PROCEDURE_STATES.IN_PROGRESS]: 'בתהליך',
  [PROCEDURE_STATES.WAITING]: 'ממתין לאישור',
  [PROCEDURE_STATES.NEEDS_CORRECTION]: 'חזר לתיקון',
  [PROCEDURE_STATES.APPROVED]: 'אושר',
};

export const PROCEDURE_STATE_COLORS = {
  [PROCEDURE_STATES.NOT_STARTED]: 'bg-gray-100 text-gray-700',
  [PROCEDURE_STATES.IN_PROGRESS]: 'bg-blue-100 text-blue-800',
  [PROCEDURE_STATES.WAITING]: 'bg-amber-100 text-amber-800',
  [PROCEDURE_STATES.NEEDS_CORRECTION]: 'bg-red-100 text-red-800',
  [PROCEDURE_STATES.APPROVED]: 'bg-green-100 text-green-800',
};

// VAT status (payroll) — ONE options list for the profile editor, the list
// column, inline editing and bulk editing. Values match the server enum.
export const VAT_OPTIONS = [
  { value: '', label: '—' },
  { value: 'exempt', label: 'פטור ממע״מ' },
  { value: 'vat_18', label: '18% מע״מ' },
];
export const VAT_LABELS = Object.fromEntries(
  VAT_OPTIONS.filter((o) => o.value).map((o) => [o.value, o.label]),
);

export const PEOPLE_TABS = [
  { key: 'guides', path: '', label: 'מדריכים', glyph: '👥' },
  { key: 'teams', path: 'teams', label: 'צוותים', glyph: '🏷️' },
];
