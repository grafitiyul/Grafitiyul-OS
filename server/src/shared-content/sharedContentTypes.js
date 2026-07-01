// Shared Content Library — the canonical Type vocabulary (single source of truth).
//
// No imports, no DB — a tiny pure module (same shape as quoteBlocks.js) so the
// API validator, the resolver, and the future admin UI all read ONE list and can
// never drift. `type` on a SharedContent row is validated against this.
//
// `cardinality` governs how many links of a type a single consumer may hold:
//   'single' — at most one (meeting point, ending point, map …)
//   'list'   — many, ordered (safety notes, walking notes, custom …)
// The DB does not enforce this (type lives on the row, not the link); the API
// layer enforces it. Adding a new type later = add a row here (+ a Hebrew label);
// nothing downstream is hardcoded.
export const SHARED_CONTENT_TYPES = [
  { key: 'meeting_point', labelHe: 'נקודת מפגש', cardinality: 'single' },
  { key: 'ending_point', labelHe: 'נקודת סיום', cardinality: 'single' },
  { key: 'arrival_instructions', labelHe: 'הוראות הגעה', cardinality: 'single' },
  { key: 'walking_notes', labelHe: 'הערות הליכה', cardinality: 'list' },
  { key: 'safety', labelHe: 'בטיחות', cardinality: 'list' },
  { key: 'map', labelHe: 'מפה', cardinality: 'single' },
  { key: 'custom', labelHe: 'תוכן כללי', cardinality: 'list' },
];

export const SHARED_CONTENT_TYPE_KEYS = SHARED_CONTENT_TYPES.map((t) => t.key);

const BY_KEY = Object.fromEntries(SHARED_CONTENT_TYPES.map((t) => [t.key, t]));

export function isValidSharedContentType(key) {
  return Object.prototype.hasOwnProperty.call(BY_KEY, key);
}

export function getSharedContentType(key) {
  return BY_KEY[key] || null;
}

// True when a consumer may hold at most one link of this type. Unknown types are
// treated as single (the safe default — the caller should have validated first).
export function isSingleType(key) {
  return (BY_KEY[key]?.cardinality ?? 'single') === 'single';
}
