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

// Runtime-registered fields (server-driven registries, e.g. the Communication
// Center variable list from GET /api/communication/meta). Same chip rendering
// path — registered labels resolve everywhere DynamicFieldNode renders.
const registered = new Map();

export function registerDynamicFields(fields) {
  for (const f of fields || []) {
    if (f?.key) registered.set(f.key, { key: f.key, label: f.label, description: f.description || null });
  }
}

export function getDynamicFieldByKey(key) {
  return byKey.get(key) || registered.get(key) || null;
}

// Shape check — callers may still accept unregistered keys (e.g. content
// saved before a field was registered). Validates syntax only.
const KEY_RE = /^[a-z][a-z0-9_]*$/;
export function isValidFieldKeyShape(key) {
  return typeof key === 'string' && KEY_RE.test(key);
}
