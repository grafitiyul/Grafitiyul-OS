// The CRM Tasks workspace query contract — ONE canonical filter object, ONE
// sortable whitelist, ONE where-builder. Pure: no Prisma import, no I/O, so it
// is unit-testable (this codebase has no HTTP route tests; filter logic must
// live in a pure module or it is untestable — see tours/statusFilter.js, the
// pattern this follows).
//
// The route is a thin caller: parse → build → query. Every rule lives here.
//
// SORTING (architecture §4, BINDING): a column is sortable if and only if its
// value is reachable from Task through an unbroken chain of TO-ONE relations,
// because Prisma cannot order through a to-many. Columns backed by to-many
// relations (customer, phone, email, operational tour) are DISPLAY-ONLY and are
// absent from SORTABLE below. An unknown or non-sortable sort key is a 400 —
// never a silent fallback, which is how a grid starts lying about its order.
//
// PRIORITY is the one sortable column Prisma cannot express (see priority.js:
// `high|medium|low` sorts lexicographically to `high, low, medium`). It is
// handled by the route's sort-in-memory path, NOT here; `SORTABLE.priority`
// carries `inMemory: true` and no prismaOrderBy.

import { israelToday, isValidDate, dateRangeBounds, startOfDayUtc } from '../lib/israelDate.js';
import { resolveWindow, DEFAULT_WINDOW, isValidWindow } from './windows.js';
import { PRIORITY_VALUES } from './priority.js';

export const TASK_STATUS_FILTERS = Object.freeze(['open', 'completed', 'all']);
export const PRIORITY_FILTERS = Object.freeze([...PRIORITY_VALUES, 'none']);

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

// Ceiling for the sort-in-memory path (priority). Bounded like every other
// scan in this codebase (cf. search/lookups.js CANDIDATE_CAP), and the response
// carries `truncated` so the UI can say so rather than imply completeness.
export const PRIORITY_SORT_CAP = 5000;

/**
 * The sortable whitelist. Client key -> how to order.
 *  - prismaOrderBy(dir): the Prisma orderBy fragment
 *  - inMemory: true     : Prisma cannot express it; the route sorts the page set
 *
 * Everything absent from this map is display-only and rejected with 400.
 */
export const SORTABLE = Object.freeze({
  // ── Task's own scalars ──
  taskType: { prismaOrderBy: (dir) => ({ taskType: { sortOrder: dir } }) },
  title: { prismaOrderBy: (dir) => ({ title: dir }) },
  dueDate: { prismaOrderBy: (dir) => ({ dueDate: dir }) },
  dueTime: { prismaOrderBy: (dir) => ({ dueTime: dir }) },
  status: { prismaOrderBy: (dir) => ({ status: dir }) },
  completedAt: { prismaOrderBy: (dir) => ({ completedAt: dir }) },
  createdAt: { prismaOrderBy: (dir) => ({ createdAt: dir }) },
  // Semantic order (high > medium > low > none) — see priority.js.
  priority: { inMemory: true },
  // ── to-one: Task -> AdminUser ──
  // displayName is nullable and username is the fallback the UI renders, so the
  // sort mirrors the display: name first, handle as tiebreak.
  owner: {
    prismaOrderBy: (dir) => [{ owner: { displayName: dir } }, { owner: { username: dir } }],
  },
  // ── to-one chains: Task -> Deal -> ... ──
  dealOrderNo: { prismaOrderBy: (dir) => ({ deal: { orderNo: dir } }) },
  dealTitle: { prismaOrderBy: (dir) => ({ deal: { title: dir } }) },
  // Pipeline position, not alphabetical.
  dealStage: { prismaOrderBy: (dir) => ({ deal: { dealStage: { sortOrder: dir } } }) },
  dealStatus: { prismaOrderBy: (dir) => ({ deal: { status: dir } }) },
  organization: { prismaOrderBy: (dir) => ({ deal: { organization: { name: dir } } }) },
  product: { prismaOrderBy: (dir) => ({ deal: { product: { nameHe: dir } } }) },
  // ProductVariant has no name of its own — it is product x location.
  variant: { prismaOrderBy: (dir) => ({ deal: { productVariant: { location: { nameHe: dir } } } }) },
  // The deal's OPERATIONAL city — may be a manual override with no variant.
  city: { prismaOrderBy: (dir) => ({ deal: { location: { nameHe: dir } } }) },
  participants: { prismaOrderBy: (dir) => ({ deal: { participants: dir } }) },
  // The Deal's PLANNED tour date (a pre-WON sales field), NOT the operational
  // TourEvent date, which is to-many and display-only. Never merge them.
  plannedTourDate: { prismaOrderBy: (dir) => ({ deal: { tourDate: dir } }) },
  communicationLanguage: { prismaOrderBy: (dir) => ({ deal: { communicationLanguage: dir } }) },
});

export const SORTABLE_KEYS = Object.freeze(Object.keys(SORTABLE));

/** Columns that exist in the grid but must never claim to sort (§4.2). */
export const DISPLAY_ONLY_KEYS = Object.freeze([
  'customer', 'phone', 'email', 'upcomingTour', 'whatsappScheduled',
]);

export const DEFAULT_SORT = Object.freeze([{ key: 'dueDate', dir: 'asc' }]);

function csv(value) {
  if (value == null || value === '') return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Parse `sort=key:dir,key2:dir2` into a validated multi-sort spec.
 * @returns {{ok:true, sort:Array<{key,dir}>} | {ok:false, error:string}}
 */
export function parseSort(raw) {
  const parts = csv(raw);
  if (!parts.length) return { ok: true, sort: [...DEFAULT_SORT] };
  const sort = [];
  const seen = new Set();
  for (const part of parts) {
    const [key, dirRaw = 'asc'] = part.split(':');
    if (!Object.prototype.hasOwnProperty.call(SORTABLE, key)) return { ok: false, error: 'invalid_sort_key' };
    if (dirRaw !== 'asc' && dirRaw !== 'desc') return { ok: false, error: 'invalid_sort_dir' };
    if (seen.has(key)) continue; // first occurrence wins; a repeated key is not an error
    seen.add(key);
    sort.push({ key, dir: dirRaw });
  }
  return { ok: true, sort };
}

/**
 * Parse the HTTP query into the canonical filter object (architecture §3).
 * The chips are NOT a separate filtering system — they are the one control
 * that writes `window`, and everything here ANDs with it.
 *
 * @param {object} query  req.query (plain object)
 * @param {object} [opts] { nowMs, today } — injectable clock
 */
export function parseTaskQuery(query = {}, opts = {}) {
  const q = query || {};

  const window = q.window ? String(q.window) : DEFAULT_WINDOW;
  if (!isValidWindow(window)) return { ok: false, error: 'invalid_window' };

  const today = opts.today ?? israelToday(opts.nowMs);
  const resolved = resolveWindow(window, {
    today,
    rangeFrom: q.rangeFrom ? String(q.rangeFrom) : undefined,
    rangeTo: q.rangeTo ? String(q.rangeTo) : undefined,
  });
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const status = q.status ? String(q.status) : 'open';
  if (!TASK_STATUS_FILTERS.includes(status)) return { ok: false, error: 'invalid_status' };

  // באיחור pins status=open (§3.2): "overdue" is meaningless for a completed
  // task. Asking for both is contradictory, so it is a 400 rather than a
  // silently-empty grid. The UI disables the control while overdue is active.
  if (resolved.openOnly && status === 'completed') return { ok: false, error: 'overdue_requires_open' };

  const priorities = csv(q.priorities);
  for (const p of priorities) {
    if (!PRIORITY_FILTERS.includes(p)) return { ok: false, error: 'invalid_priority' };
  }

  const sortResult = parseSort(q.sort);
  if (!sortResult.ok) return sortResult;

  const pageSize = Math.min(Math.max(parseInt(q.pageSize, 10) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);

  return {
    ok: true,
    today,
    filters: {
      window,
      rangeFrom: window === 'range' ? String(q.rangeFrom) : null,
      rangeTo: window === 'range' ? String(q.rangeTo) : null,
      typeKeys: csv(q.typeKeys),
      ownerIds: csv(q.ownerIds),
      priorities,
      stageIds: csv(q.stageIds),
      status,
    },
    resolved,
    sort: sortResult.sort,
    page,
    pageSize,
  };
}

/**
 * Build the Prisma `where` from the canonical filter object.
 *
 * Convention (matching routes/tours.js): start from a base object and add keys
 * conditionally. An absent filter omits its key entirely — never `undefined`,
 * never a no-op clause.
 *
 * @param {object} filters  the canonical filter object
 * @param {object} resolved the result of resolveWindow for filters.window
 */
export function buildTaskWhere(filters, resolved) {
  const where = buildBaseWhere(filters);

  // ── time window ──
  if (resolved.bounds.from == null && resolved.bounds.to != null) {
    // overdue: unbounded backwards, exclusive of today.
    where.dueDate = { lt: dateRangeBounds(resolved.bounds.to, resolved.bounds.to).lt };
  } else if (resolved.bounds.from != null) {
    where.dueDate = dateRangeBounds(resolved.bounds.from, resolved.bounds.to);
  }

  // באיחור pins open regardless of the status filter (§3.2).
  if (resolved.openOnly) where.status = 'open';

  return where;
}

/**
 * Everything in the canonical filter object EXCEPT the time window.
 *
 * This exists so the counts endpoint applies exactly the same filters as the
 * grid while varying only the window — one filter implementation, not two. If
 * these ever diverge, the chip counts start lying about what the grid will show.
 */
export function buildBaseWhere(filters) {
  const where = {};

  // 'open'/'completed' map to the literal status. 'all' adds no constraint, and
  // is the only way to see cancelled / sent / not_sent tasks.
  if (filters.status === 'open') where.status = 'open';
  else if (filters.status === 'completed') where.status = 'completed';

  if (filters.typeKeys?.length) where.taskType = { key: { in: filters.typeKeys } };
  if (filters.ownerIds?.length) where.ownerUserId = { in: filters.ownerIds };
  if (filters.stageIds?.length) where.deal = { dealStageId: { in: filters.stageIds } };

  // 'none' means priority IS NULL, which cannot ride in the same `in` list.
  if (filters.priorities?.length) {
    const named = filters.priorities.filter((p) => p !== 'none');
    const wantsNone = filters.priorities.includes('none');
    if (wantsNone && named.length) where.OR = [{ priority: { in: named } }, { priority: null }];
    else if (wantsNone) where.priority = null;
    else where.priority = { in: named };
  }

  return where;
}

/**
 * The Prisma orderBy array, always ending in a STABLE tiebreak so offset
 * pagination cannot skip or duplicate a row across pages.
 * Returns null when the sort must happen in memory (priority).
 */
export function buildTaskOrderBy(sort) {
  if (sort.some((s) => SORTABLE[s.key]?.inMemory)) return null;
  const out = [];
  for (const { key, dir } of sort) {
    const frag = SORTABLE[key].prismaOrderBy(dir);
    if (Array.isArray(frag)) out.push(...frag);
    else out.push(frag);
  }
  if (!sort.some((s) => s.key === 'dueDate')) out.push({ dueDate: 'asc' });
  out.push({ id: 'asc' });
  return out;
}

/** True when this sort needs the bounded sort-in-memory path. */
export function needsInMemorySort(sort) {
  return sort.some((s) => SORTABLE[s.key]?.inMemory);
}

/** Bounds for the counts scan, as a Prisma dueDate filter. */
export function countScanWhere(from, to) {
  return { gte: startOfDayUtc(from), lt: dateRangeBounds(to, to).lt };
}

export { isValidDate };
