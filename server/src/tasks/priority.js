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
// `comparePriority` is the ONE definition of that order. Its consumer is the
// workspace grid's priority-sort path (routes/tasks.js).
//
// On the raw-SQL escape hatch that §4.4 PERMITTED but which is NOT used:
// Prisma cannot order by a CASE, so the plan sanctioned one narrowly-contained
// SQL CASE as a fallback. In implementation the fallback turned out to buy
// nothing. The canonical `where` is built by Prisma (tasks/taskQuery.js), so a
// raw ORDER BY would STILL need the filtered id set first — and expressing the
// filter in SQL as well would fork it into a second implementation, which the
// project forbids. Both routes therefore fetch the same id set; ordering it in
// memory with this comparator is strictly simpler and adds no SQL surface. The
// fetch is bounded (taskQuery.PRIORITY_SORT_CAP) and the response carries
// `truncated`. If that ever stops scaling, the answer is a Postgres STORED
// GENERATED column — computed by the database from `priority`, so still not a
// second WRITABLE truth — never a hand-maintained rank field.
//
// See docs/architecture/GOS-crm-tasks-workspace-plan.md §4.4.
//
// Pure: no Prisma import, no I/O.

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
 * @param {string|null|undefined} priority
 * @returns {boolean} true for a storable value (null means "no priority").
 */
export function isValidPriority(priority) {
  return priority === null || priority === undefined || PRIORITY_VALUES.includes(priority);
}
