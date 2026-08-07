// ── THE definition of "retired", and how history is resolved through a merge ──
//
// When two deals are merged, one survives and the other is RETIRED — its row
// stays in the database forever, keeps its orderNo, keeps every financial
// document it ever produced, and serves a tombstone at its own URL. What it
// stops being is ACTIVE.
//
// That single distinction is what this module owns. Two things follow from it,
// and both live here so no surface can invent its own answer:
//
//   activeDealWhere()  — a retired deal must not appear in any list, count,
//                        summary, picker, queue, detector or report that means
//                        "the deals we are working on". Every such query goes
//                        through this. The guard test (mergeLineage.guard.test.js)
//                        fails the build if a new deal query forgets.
//
//   lineageIdsFor()    — the survivor's history, money and search context are
//                        the UNION of its own and everything retired into it.
//                        Nothing is copied to achieve that: rows keep their real
//                        owner, and readers ask this module which ids to read.
//
// ── Why the walk is transitive ──────────────────────────────────────────────
// Merges chain. If B is merged into A, and A is later merged into C, then:
//     B.mergedIntoDealId = A     (unchanged — that IS what happened)
//     A.mergedIntoDealId = C
// C's history must include both A and B, so the walk follows the tree rather
// than one level. Re-pointing B at C would be faster and would be a lie: B was
// never merged into C, and the audit record says so.

import { prisma as defaultPrisma } from '../db.js';

// Depth/size caps. A merge tree deeper than this is not a legitimate business
// situation — it is a runaway loop or corrupted lineage — and the caps make a
// pathological row incapable of hanging a request. The integrity detector is
// what reports such a tree; this only refuses to walk it forever.
const MAX_DEPTH = 12;
const MAX_LINEAGE = 200;

/** THE filter clause meaning "not retired by a merge". */
export const ACTIVE_DEAL_FILTER = Object.freeze({ mergedIntoDealId: null });

/**
 * Add the retired-deal exclusion to a Prisma `where`.
 *
 * Top-level keys are ANDed by Prisma, so this composes with any existing
 * clause — including one that already uses OR — without changing its meaning.
 *
 *   prisma.deal.findMany({ where: activeDealWhere({ status: 'open' }) })
 */
export function activeDealWhere(where = {}) {
  return { ...where, ...ACTIVE_DEAL_FILTER };
}

/**
 * Every deal id whose rows belong to `dealId`'s combined history: the deal
 * itself first, then everything retired into it, transitively.
 *
 * Returns `[dealId]` for the overwhelming majority of deals (one query, no
 * merges), so callers can use it unconditionally without a fast path.
 */
export async function lineageIdsFor(db, dealId) {
  if (!dealId) return [];
  const all = [dealId];
  let frontier = [dealId];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth += 1) {
    const rows = await db.deal.findMany({
      where: { mergedIntoDealId: { in: frontier } },
      select: { id: true },
    });
    // A cycle would be corrupted data (the DB cannot prevent one), so ids
    // already seen are dropped rather than trusted.
    frontier = rows.map((r) => r.id).filter((id) => !all.includes(id));
    if (!frontier.length) break;
    all.push(...frontier);
    if (all.length >= MAX_LINEAGE) break;
  }
  return all.slice(0, MAX_LINEAGE);
}

/**
 * The same walk for MANY deals at once — Map<dealId, string[]>, each value
 * starting with its own id. Used by batch surfaces (collection summaries, list
 * pages) so a page of 50 deals still costs a bounded number of queries rather
 * than 50 walks.
 */
export async function lineageIdsForMany(db, dealIds) {
  const roots = [...new Set((dealIds || []).filter(Boolean))];
  const out = new Map(roots.map((id) => [id, [id]]));
  if (!roots.length) return out;

  // rootOf tracks which ORIGINAL root each discovered id belongs to, so one
  // breadth-first sweep serves every root at once.
  const rootOf = new Map(roots.map((id) => [id, id]));
  let frontier = roots;
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth += 1) {
    const rows = await db.deal.findMany({
      where: { mergedIntoDealId: { in: frontier } },
      select: { id: true, mergedIntoDealId: true },
    });
    const next = [];
    for (const r of rows) {
      if (rootOf.has(r.id)) continue; // seen — cycle or diamond
      const root = rootOf.get(r.mergedIntoDealId);
      if (!root) continue;
      rootOf.set(r.id, root);
      const list = out.get(root);
      if (list && list.length < MAX_LINEAGE) list.push(r.id);
      next.push(r.id);
    }
    frontier = next;
  }
  return out;
}

/**
 * Follow a retired deal UP to the deal that is actually active today, across
 * chained merges. Returns null when `deal` is not retired.
 *
 * `hops` is the path taken, so the tombstone can say "merged into #A, which was
 * merged into #C" instead of silently teleporting the operator two steps away.
 */
export async function resolveSurvivor(db, deal) {
  if (!deal?.mergedIntoDealId) return null;
  const hops = [];
  let current = deal;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const next = await db.deal.findUnique({
      where: { id: current.mergedIntoDealId },
      select: { id: true, orderNo: true, title: true, status: true, mergedIntoDealId: true },
    });
    // A dangling pointer is impossible via the FK, but a caller may hand us a
    // stale object; reporting what we have beats throwing on a read path.
    if (!next) break;
    hops.push({ id: next.id, orderNo: next.orderNo, title: next.title, status: next.status });
    if (!next.mergedIntoDealId) return { survivor: next, hops };
    current = next;
  }
  // Depth exhausted → return the furthest hop we reached rather than nothing.
  const last = hops[hops.length - 1] || null;
  return last ? { survivor: last, hops, truncated: true } : null;
}

/** Is this deal retired? THE predicate — never re-derived at a call site. */
export const isRetired = (deal) => !!deal?.mergedIntoDealId;

/**
 * The write guard. A retired deal is history: it must not receive ordinary
 * mutations, because an edit there is invisible (the deal appears nowhere) and
 * silently diverges from the survivor that now represents the transaction.
 *
 * Returns an { error, ... } body to send with 409, or null when the write may
 * proceed. Deliberately a RETURNED refusal rather than a thrown error: routes
 * differ in how they answer, and a shared throw would force try/catch into
 * every handler.
 */
export async function retiredDealRefusal(db, dealIdOrOrderNo) {
  const value = String(dealIdOrOrderNo ?? '');
  if (!value) return null;
  // Accepts EITHER form of the deal URL param (cuid or "מספר הזמנה"), so the
  // guard cannot be bypassed by running before routes/dealParam.js has swapped
  // a numeric param for the cuid. Depending on middleware ordering for a
  // security-relevant check is how a guard quietly stops guarding.
  const select = { id: true, orderNo: true, mergedIntoDealId: true };
  const deal = /^\d+$/.test(value) && Number(value) <= 2147483647
    ? await db.deal.findUnique({ where: { orderNo: Number(value) }, select })
    : await db.deal.findUnique({ where: { id: value }, select });
  if (!deal || !deal.mergedIntoDealId) return null;
  const survivor = await db.deal.findUnique({
    where: { id: deal.mergedIntoDealId },
    select: { id: true, orderNo: true },
  });
  return {
    error: 'deal_retired_by_merge',
    messageHe: survivor
      ? `דיל #${deal.orderNo} אוחד לתוך דיל #${survivor.orderNo} — יש לבצע את השינוי בדיל הפעיל.`
      : `דיל #${deal.orderNo} אוחד ואינו פעיל.`,
    dealOrderNo: deal.orderNo,
    survivorDealId: survivor?.id || null,
    survivorOrderNo: survivor?.orderNo || null,
  };
}

/**
 * HTTP verbs that may touch a retired deal. A retired deal must stay fully
 * READABLE — that is the entire point of retiring instead of deleting — so only
 * mutations are refused. Shared with routes/dealParam.js, which is where the
 * refusal is actually enforced (the one resolver every deal-scoped router
 * already calls, so a new router cannot forget it).
 */
export const READ_METHODS = Object.freeze(new Set(['GET', 'HEAD', 'OPTIONS']));
