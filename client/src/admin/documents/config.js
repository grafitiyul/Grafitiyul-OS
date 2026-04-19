// Stable internal keys — never rely on the Hebrew labels for logic.
// Order reflects primary → secondary: instances list first, templates demoted.
export const DOC_TABS = [
  { key: 'index', path: '', label: 'מסמכים', glyph: '📄' },
  { key: 'templates', path: 'templates', label: 'תבניות', glyph: '🗂' },
  { key: 'signers', path: 'signers', label: 'חותמים', glyph: '✒️' },
  { key: 'fields', path: 'fields', label: 'שדות קבועים', glyph: '🏷' },
];

export const FIELD_TYPES = [
  { key: 'text', label: 'טקסט' },
  { key: 'date', label: 'תאריך' },
  { key: 'number', label: 'מספר' },
  { key: 'phone', label: 'טלפון' },
  { key: 'email', label: 'אימייל' },
  { key: 'signature', label: 'חתימה' },
  { key: 'stamp', label: 'חותמת' },
  { key: 'combined', label: 'חתימה + חותמת' },
];

export const VALUE_SOURCES = [
  { key: 'business_field', label: 'שדה קבוע של העסק' },
  { key: 'signer_field', label: 'שדה של חותם' },
  { key: 'signer_asset', label: 'חתימה/חותמת של חותם' },
  { key: 'static', label: 'טקסט קבוע' },
  { key: 'override_only', label: 'רק ברמת מסמך' },
];

// Built-in signer fields that every SignerPerson has. Extra fields come from
// the SignerPerson.extraFields JSON (rendered alongside these in the picker).
export const SIGNER_BUILTIN_FIELDS = [
  { key: 'displayName', label: 'שם מלא' },
  { key: 'role', label: 'תפקיד' },
  { key: 'email', label: 'אימייל' },
  { key: 'phone', label: 'טלפון' },
];

export const SIGNER_ASSET_MODES = [
  { key: 'draw', label: 'חתימה' },
  { key: 'stamp', label: 'חותמת' },
  { key: 'combined', label: 'חתימה + חותמת' },
];

// Mapping between DocumentField.fieldType and allowed SignerAsset mode values
// when valueSource is signer_asset. Keeps the dropdown honest.
export const IMAGE_FIELD_TYPES = new Set(['signature', 'stamp', 'combined']);
