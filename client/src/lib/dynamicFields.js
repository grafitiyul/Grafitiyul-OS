// Dynamic field registry. The `key` is the stable identifier — logic and
// storage reference it only. `label` and `description` are display-only
// and can change without breaking saved content.
//
// Saved content persists only the key, never the label or description.

export const DYNAMIC_FIELDS = [
  {
    key: 'first_name',
    label: 'שם פרטי',
    description: 'השם הפרטי של העובד',
  },
  {
    key: 'last_name',
    label: 'שם משפחה',
    description: 'שם המשפחה של העובד',
  },
  {
    key: 'full_name',
    label: 'שם מלא',
    description: 'שם פרטי ושם משפחה',
  },
  {
    key: 'role',
    label: 'תפקיד',
    description: 'תפקיד העובד בארגון',
  },
  {
    key: 'team',
    label: 'צוות',
    description: 'הצוות אליו משויך העובד',
  },
];

const byKey = new Map(DYNAMIC_FIELDS.map((f) => [f.key, f]));

export function getDynamicFieldByKey(key) {
  return byKey.get(key) || null;
}

// Shape check — callers may still accept unregistered keys (e.g. content
// saved before a field was registered). Validates syntax only.
const KEY_RE = /^[a-z][a-z0-9_]*$/;
export function isValidFieldKeyShape(key) {
  return typeof key === 'string' && KEY_RE.test(key);
}
