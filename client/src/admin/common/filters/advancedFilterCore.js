// THE advanced-filter engine — a generic, screen-agnostic condition tree in
// the style of Pipedrive/Airtable filters. Pure data + pure functions (no
// React, no fetch) so the whole thing is unit-testable with node --test.
//
// Tree shape (persisted as-is in localStorage / future saved views):
//   group:     { kind: 'group', op: 'and' | 'or', children: [node, …] }
//   condition: { kind: 'condition', field, operator, value }
// `value` is a scalar, or { from, to } for 'between' operators. Groups nest
// freely — there is deliberately no depth limit.
//
// A screen supplies FIELD DEFINITIONS and stays the owner of its vocabulary:
//   { key, label, type, operators?, options?(rows), match(row, operator, value) }
// The engine itself knows nothing about tours/deals/tasks — adding a filter
// to a screen is one entry in that screen's field registry, never a change
// here. `type` only drives the panel's value editor:
//   'select' | 'staff' (searchable single-select) | 'date' | 'time' | 'text'
//
// Evaluation semantics (CRM convention):
//   • an INCOMPLETE condition (no field / operator / required value yet) is
//     IGNORED — the user is mid-edit, the table never blanks under them;
//   • an empty group (or one whose children are all incomplete) matches all;
//   • unknown field keys (stale persisted state after a registry change) are
//     ignored rather than crashing or filtering everything out.

// ---------- operators ----------

// Canonical operator vocabulary per editor type. A field def may narrow this
// via its own `operators` array, never widen it.
export const OPERATORS_BY_TYPE = {
  select: ['is', 'isNot'],
  staff: ['is', 'isNot'],
  date: ['on', 'before', 'after', 'between'],
  time: ['before', 'after', 'between'],
  text: ['contains'],
};

export const OPERATOR_LABELS = {
  is: 'הוא',
  isNot: 'אינו',
  on: 'בתאריך',
  before: 'לפני',
  after: 'אחרי',
  between: 'בין',
  contains: 'מכיל',
};

export function operatorsFor(def) {
  const all = OPERATORS_BY_TYPE[def?.type] || ['is'];
  if (!Array.isArray(def?.operators) || !def.operators.length) return all;
  return def.operators.filter((op) => all.includes(op));
}

// ---------- node constructors ----------

export function emptyGroup(op = 'and') {
  return { kind: 'group', op, children: [] };
}

export function emptyCondition(field = '') {
  return { kind: 'condition', field, operator: '', value: null };
}

// ---------- validation / normalization ----------

// Persisted trees survive registry changes: unknown shapes collapse to an
// empty root, malformed children are dropped, ops are coerced.
export function normalizeTree(raw) {
  const norm = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 8) return null;
    if (node.kind === 'condition') {
      return {
        kind: 'condition',
        field: typeof node.field === 'string' ? node.field : '',
        operator: typeof node.operator === 'string' ? node.operator : '',
        value: node.value ?? null,
      };
    }
    if (node.kind === 'group') {
      return {
        kind: 'group',
        op: node.op === 'or' ? 'or' : 'and',
        children: (Array.isArray(node.children) ? node.children : [])
          .map((c) => norm(c, depth + 1))
          .filter(Boolean),
      };
    }
    return null;
  };
  return norm(raw, 0) || emptyGroup();
}

function isBetween(op) {
  return op === 'between';
}

export function isConditionComplete(cond, def) {
  if (!def || !cond.field || !cond.operator) return false;
  if (!operatorsFor(def).includes(cond.operator)) return false;
  if (isBetween(cond.operator)) {
    return !!(cond.value && cond.value.from && cond.value.to);
  }
  return cond.value !== null && cond.value !== undefined && cond.value !== '';
}

function isNodeActive(node, fieldsByKey) {
  if (!node) return false;
  if (node.kind === 'condition') return isConditionComplete(node, fieldsByKey[node.field]);
  return (node.children || []).some((c) => isNodeActive(c, fieldsByKey));
}

// Count of COMPLETE conditions — the button badge ("סינון · 3").
export function countActiveConditions(node, fieldsByKey) {
  if (!node) return 0;
  if (node.kind === 'condition') {
    return isConditionComplete(node, fieldsByKey[node.field]) ? 1 : 0;
  }
  return (node.children || []).reduce((n, c) => n + countActiveConditions(c, fieldsByKey), 0);
}

// ---------- evaluation ----------

export function evaluateTree(node, row, fieldsByKey) {
  if (!node) return true;
  if (node.kind === 'condition') {
    const def = fieldsByKey[node.field];
    if (!isConditionComplete(node, def)) return true; // mid-edit — ignored
    return !!def.match(row, node.operator, node.value);
  }
  const active = (node.children || []).filter((c) => isNodeActive(c, fieldsByKey));
  if (!active.length) return true;
  return node.op === 'or'
    ? active.some((c) => evaluateTree(c, row, fieldsByKey))
    : active.every((c) => evaluateTree(c, row, fieldsByKey));
}

// ---------- immutable tree editing (path = array of child indices) ----------

function editAt(node, path, fn) {
  if (!path.length) return fn(node);
  const [i, ...rest] = path;
  const children = node.children.map((c, idx) => (idx === i ? editAt(c, rest, fn) : c));
  return { ...node, children: children.filter(Boolean) };
}

export function updateNodeAt(tree, path, patch) {
  return editAt(tree, path, (n) => ({ ...n, ...patch }));
}

export function removeNodeAt(tree, path) {
  return editAt(tree, path, () => null);
}

export function addChildAt(tree, groupPath, child) {
  return editAt(tree, groupPath, (g) => ({ ...g, children: [...(g.children || []), child] }));
}

// ---------- shared value matchers (for field registries) ----------

// Ordered-string comparison helpers — correct for both "YYYY-MM-DD" dates and
// "HH:MM" times (lexicographic == chronological for these formats).
export function matchOrdered(actual, operator, value) {
  if (!actual) return false;
  if (operator === 'on') return actual === value;
  if (operator === 'before') return actual < value;
  if (operator === 'after') return actual > value;
  if (operator === 'between') return actual >= value.from && actual <= value.to;
  return false;
}

// is / isNot over a set of candidate values (e.g. staff names on a tour).
export function matchIsAmong(candidates, operator, value) {
  const has = (candidates || []).includes(value);
  return operator === 'isNot' ? !has : has;
}
