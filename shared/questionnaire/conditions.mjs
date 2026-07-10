// Questionnaire conditional-visibility evaluator — THE single source of truth.
// Imported by BOTH the server (binding: validation + hidden-answer dropping)
// and the client (advisory: live show/hide while filling). One evaluator, one
// semantics; the server copy is authoritative (blueprint §9–10).
//
// Grammar (deliberately capped — no rule engine, no scripting):
//   Expr := { all: Expr[] } | { any: Expr[] } | { not: Expr } | Leaf
//   Leaf := { q: <questionKey>, op: <Op>, value?: any }
//   Op   := eq | neq | in | nin | gt | gte | lt | lte
//         | answered | empty | contains
//
// Semantics for a missing/empty answer: `answered`→false, `empty`→true, every
// comparison op → false (a hidden or skipped question never satisfies eq/gt/…).
// `contains`: array answer includes value; string answer includes substring.
// Numeric ops coerce both sides with Number() and fail (false) on NaN.
// A null/undefined expression means "always visible".

export const CONDITION_OPS = [
  'eq', 'neq', 'in', 'nin', 'gt', 'gte', 'lt', 'lte',
  'answered', 'empty', 'contains',
];

// "Empty" definition shared with the validation pipeline: null/undefined,
// blank string, or empty array. `false` and `0` are real answers.
export function isEmptyAnswer(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function compareLeaf(leaf, getAnswer) {
  const answer = getAnswer(leaf.q);
  const empty = isEmptyAnswer(answer);
  switch (leaf.op) {
    case 'answered':
      return !empty;
    case 'empty':
      return empty;
    case 'eq':
      return !empty && answer === leaf.value;
    case 'neq':
      // An unanswered question is not "different from X" — it is unanswered.
      return !empty && answer !== leaf.value;
    case 'in':
      return !empty && Array.isArray(leaf.value) && leaf.value.includes(answer);
    case 'nin':
      return !empty && Array.isArray(leaf.value) && !leaf.value.includes(answer);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (empty) return false;
      const a = Number(answer);
      const b = Number(leaf.value);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (leaf.op === 'gt') return a > b;
      if (leaf.op === 'gte') return a >= b;
      if (leaf.op === 'lt') return a < b;
      return a <= b;
    }
    case 'contains':
      if (empty) return false;
      if (Array.isArray(answer)) return answer.includes(leaf.value);
      if (typeof answer === 'string') return answer.includes(String(leaf.value));
      return false;
    default:
      // Unknown op — fail closed on the CONDITION (treat as not satisfied),
      // never on the question (publish-time validation rejects unknown ops,
      // so this can only happen on data written outside the builder).
      return false;
  }
}

// expr → boolean. `getAnswer(questionKey)` returns the raw stored value.
export function evaluateCondition(expr, getAnswer) {
  if (expr === null || expr === undefined) return true;
  if (typeof expr !== 'object') return true;
  if (Array.isArray(expr.all)) return expr.all.every((e) => evaluateCondition(e, getAnswer));
  if (Array.isArray(expr.any)) return expr.any.some((e) => evaluateCondition(e, getAnswer));
  if (expr.not !== undefined) return !evaluateCondition(expr.not, getAnswer);
  if (typeof expr.q === 'string' && typeof expr.op === 'string') return compareLeaf(expr, getAnswer);
  // Malformed leaf — treat as visible (publish validation is the real gate).
  return true;
}

// Structural validation (used at publish time and by the builder).
// Returns a list of problem strings ([] = valid). `allowedKeys` is the set of
// question keys the expression may reference (backward-only enforcement is the
// caller's job — it passes only the keys of EARLIER questions).
export function validateConditionShape(expr, allowedKeys) {
  const problems = [];
  const allowed = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys || []);
  const walk = (node, path) => {
    if (node === null || node === undefined) return;
    if (typeof node !== 'object' || Array.isArray(node)) {
      problems.push(`${path}: not_an_object`);
      return;
    }
    const branchKeys = ['all', 'any', 'not'].filter((k) => node[k] !== undefined);
    if (branchKeys.length > 1) {
      problems.push(`${path}: multiple_branch_keys`);
      return;
    }
    if (branchKeys.length === 1) {
      const k = branchKeys[0];
      if (k === 'not') {
        walk(node.not, `${path}.not`);
        return;
      }
      if (!Array.isArray(node[k]) || node[k].length === 0) {
        problems.push(`${path}.${k}: empty_branch`);
        return;
      }
      node[k].forEach((child, i) => walk(child, `${path}.${k}[${i}]`));
      return;
    }
    // Leaf
    if (typeof node.q !== 'string' || !node.q) {
      problems.push(`${path}: missing_question_ref`);
      return;
    }
    if (!CONDITION_OPS.includes(node.op)) {
      problems.push(`${path}: unknown_op`);
      return;
    }
    if (!allowed.has(node.q)) {
      problems.push(`${path}: forward_or_unknown_ref:${node.q}`);
    }
    if (['in', 'nin'].includes(node.op) && !Array.isArray(node.value)) {
      problems.push(`${path}: value_must_be_array`);
    }
    if (!['answered', 'empty'].includes(node.op) && node.value === undefined) {
      problems.push(`${path}: missing_value`);
    }
  };
  walk(expr, 'visibleWhen');
  return problems;
}

// Collect every question key an expression references (builder UX + tests).
export function referencedKeys(expr) {
  const keys = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (Array.isArray(node.all)) return node.all.forEach(walk);
    if (Array.isArray(node.any)) return node.any.forEach(walk);
    if (node.not !== undefined) return walk(node.not);
    if (typeof node.q === 'string') keys.add(node.q);
  };
  walk(expr);
  return [...keys];
}
