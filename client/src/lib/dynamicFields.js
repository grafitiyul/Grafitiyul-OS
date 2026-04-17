// Dynamic field registry. The `key` is the stable identifier — logic and
// storage reference it only. The `label` is display-only and can change
// without breaking saved content.
//
// Saved content persists only the key, never the label.

export const DYNAMIC_FIELDS = [
  { key: 'first_name', label: 'שם פרטי' },
  { key: 'last_name', label: 'שם משפחה' },
  { key: 'full_name', label: 'שם מלא' },
  { key: 'role', label: 'תפקיד' },
  { key: 'team', label: 'צוות' },
];

const byKey = new Map(DYNAMIC_FIELDS.map((f) => [f.key, f]));

export function getDynamicFieldByKey(key) {
  return byKey.get(key) || null;
}

// Shape check — callers may still accept unregistered keys (e.g. content
// saved before a field was registered). This just validates the syntax.
const KEY_RE = /^[a-z][a-z0-9_]*$/;
export function isValidFieldKeyShape(key) {
  return typeof key === 'string' && KEY_RE.test(key);
}
