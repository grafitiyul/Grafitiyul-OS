// Semantic ordering for Task.priority — the ONE place it is defined.
//
// `Task.priority` is `String?` with values null | low | medium | high, and it is
// the SINGLE SOURCE OF TRUTH. A denormalized `priorityRank` column was considered
// and REJECTED (architecture decision #11): a second writable representation of
// the same fact can drift from it.
//
// The problem this module solves: lexicographic order is wrong.
//   ORDER BY priority ASC  ->  high, low, medium   (nonsense)
// The business order is:
//   high > medium > low > none
//
// Two consumers, one definition:
//   - comparePriority()  — in-memory sorting / tests
//   - PRIORITY_ORDER_SQL — the CASE fragment for the canonical Tasks query
//
// See docs/architecture/GOS-crm-tasks-workspace-plan.md §4.4.
//
// Pure: no Prisma import, no I/O, no interpolation of caller input.

/** Valid non-null priorities, most urgent first. */
export const PRIORITY_VALUES = Object.freeze(['high', 'medium', 'low']);

/**
 * Rank for ORDER BY: lower sorts first under ASC.
 * Anything unrecognised (including null, '', and junk) ranks last, so a bad
 * value can never jump to the top of an operator's task list.
 */
const RANKS = Object.freeze({ high: 0, medium: 1, low: 2 });
const NO_PRIORITY_RANK = 3;

/**
 * @param {string|null|undefined} priority
 * @returns {number} 0..3
 */
export function priorityRank(priority) {
  if (typeof priority !== 'string') return NO_PRIORITY_RANK;
  const rank = RANKS[priority.trim()];
  return rank === undefined ? NO_PRIORITY_RANK : rank;
}

/**
 * Comparator in semantic order.
 * 'asc'  => high, medium, low, none   (most urgent first — the useful default)
 * 'desc' => none, low, medium, high
 *
 * NOTE: 'none' stays at the *end* under asc and at the *start* under desc — it
 * is a genuine rank, not a null to be shuffled. Reversing the direction
 * reverses the whole list, which is what an operator clicking the header twice
 * expects to see.
 *
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 * @param {'asc'|'desc'} [dir='asc']
 */
export function comparePriority(a, b, dir = 'asc') {
  const diff = priorityRank(a) - priorityRank(b);
  return dir === 'desc' ? -diff : diff;
}

/**
 * The SQL ordering expression.
 *
 * This is a server-controlled CONSTANT. It interpolates nothing: no caller
 * input, no column name, no fragment ever reaches this string. Callers choose
 * only a direction, and only through PRIORITY_ORDER_SQL_DIR below, which maps a
 * validated token to another constant.
 *
 * Values are inlined as literals rather than bound as parameters because they
 * are fixed identifiers in this module's own source, and because keeping the
 * fragment parameter-free lets it compose into an ORDER BY without disturbing
 * the caller's positional parameter numbering.
 */
export const PRIORITY_ORDER_SQL =
  `CASE "Task"."priority" WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END`;

/**
 * Direction-applied ordering fragments. Constants, selected by an exact match —
 * never string-built from a caller's value.
 * @param {'asc'|'desc'} dir
 * @returns {string}
 */
export function priorityOrderSql(dir) {
  if (dir === 'asc') return `${PRIORITY_ORDER_SQL} ASC`;
  if (dir === 'desc') return `${PRIORITY_ORDER_SQL} DESC`;
  throw new Error(`priorityOrderSql: direction must be 'asc' or 'desc', got ${JSON.stringify(dir)}`);
}

/**
 * @param {string|null|undefined} priority
 * @returns {boolean} true for a storable value (null means "no priority").
 */
export function isValidPriority(priority) {
  return priority === null || priority === undefined || PRIORITY_VALUES.includes(priority);
}
