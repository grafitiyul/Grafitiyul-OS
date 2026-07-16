// The CRM Tasks workspace filter state — ONE canonical object, mirroring the
// server's contract (server/src/tasks/taskQuery.js §3).
//
// The time chips are NOT a separate filtering system: they are the one control
// that writes `window`, and every other filter ANDs with it. A Saved View
// (Slice 5) will store exactly this object, so there is never a second concept
// of "today".
//
// State lives in the URL (deep-linkable — "look at this list" in WhatsApp, and
// the back button behaves) and the last-used state is mirrored to localStorage
// so returning to the screen restores the workspace.
//
// Pure: no React, no fetch — unit-testable with node --test.

import { sortToParam, sortFromParam } from '../../common/tableColumnsCore.js';

export const WINDOWS = Object.freeze(['overdue', 'today', 'tomorrow', 'this_week', 'next_week', 'range']);
export const STATUSES = Object.freeze(['open', 'completed', 'all']);
export const PRIORITIES = Object.freeze(['high', 'medium', 'low', 'none']);

export const STORAGE_KEY = 'crm.tasks.filters.v1';

// The chips, in the owner's order. היום is the primary state.
export const TIME_CHIPS = Object.freeze([
  { key: 'overdue', label: 'באיחור', emoji: '🔴', tone: 'danger' },
  { key: 'today', label: 'היום', emoji: '🟢', tone: 'primary' },
  { key: 'tomorrow', label: 'מחר', emoji: '🟡', tone: 'warn' },
  { key: 'this_week', label: 'השבוע', emoji: '📅', tone: 'plain' },
  { key: 'next_week', label: 'השבוע הבא', emoji: '📅', tone: 'plain' },
  { key: 'range', label: 'טווח תאריכים', emoji: '🗓️', tone: 'plain' },
]);

/**
 * First-visit workspace: owner = me, window = today, status = open.
 * `me` is the signed-in admin id; null falls back to all owners rather than
 * showing an empty grid to someone whose id we don't know yet.
 */
export function defaultFilters(me = null) {
  return {
    window: 'today',
    rangeFrom: null,
    rangeTo: null,
    typeKeys: [],
    ownerIds: me ? [me] : [],
    priorities: [],
    stageIds: [],
    status: 'open',
  };
}

const csv = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/** Read the canonical filter object out of a URLSearchParams. */
export function filtersFromParams(params, me = null) {
  const d = defaultFilters(me);
  if (![...params.keys()].length) return d;
  const window = oneOf(params.get('window'), WINDOWS, d.window);
  return {
    window,
    rangeFrom: window === 'range' ? params.get('rangeFrom') || null : null,
    rangeTo: window === 'range' ? params.get('rangeTo') || null : null,
    typeKeys: csv(params.get('typeKeys')),
    ownerIds: params.has('ownerIds') ? csv(params.get('ownerIds')) : d.ownerIds,
    priorities: csv(params.get('priorities')).filter((p) => PRIORITIES.includes(p)),
    stageIds: csv(params.get('stageIds')),
    status: oneOf(params.get('status'), STATUSES, d.status),
  };
}

/**
 * Serialize to URL params. Only NON-default values are written, so a clean
 * workspace has a clean URL. `ownerIds` is always written when set, because
 * "all owners" and "me" are both meaningful and must survive a reload.
 */
export function filtersToParams(filters, sort, page) {
  const p = new URLSearchParams();
  if (filters.window !== 'today') p.set('window', filters.window);
  if (filters.window === 'range') {
    if (filters.rangeFrom) p.set('rangeFrom', filters.rangeFrom);
    if (filters.rangeTo) p.set('rangeTo', filters.rangeTo);
  }
  if (filters.typeKeys.length) p.set('typeKeys', filters.typeKeys.join(','));
  p.set('ownerIds', filters.ownerIds.join(','));
  if (filters.priorities.length) p.set('priorities', filters.priorities.join(','));
  if (filters.stageIds.length) p.set('stageIds', filters.stageIds.join(','));
  if (filters.status !== 'open') p.set('status', filters.status);
  const s = sortToParam(sort);
  if (s && s !== 'dueDate:asc') p.set('sort', s);
  if (page && page > 1) p.set('page', String(page));
  return p;
}

/** The query the API is called with. */
export function filtersToQuery(filters, sort, page, pageSize) {
  const p = new URLSearchParams();
  p.set('window', filters.window);
  if (filters.window === 'range') {
    if (filters.rangeFrom) p.set('rangeFrom', filters.rangeFrom);
    if (filters.rangeTo) p.set('rangeTo', filters.rangeTo);
  }
  if (filters.typeKeys.length) p.set('typeKeys', filters.typeKeys.join(','));
  if (filters.ownerIds.length) p.set('ownerIds', filters.ownerIds.join(','));
  if (filters.priorities.length) p.set('priorities', filters.priorities.join(','));
  if (filters.stageIds.length) p.set('stageIds', filters.stageIds.join(','));
  p.set('status', filters.status);
  const s = sortToParam(sort);
  if (s) p.set('sort', s);
  if (page > 1) p.set('page', String(page));
  if (pageSize) p.set('pageSize', String(pageSize));
  return p.toString();
}

/**
 * Selecting a time chip.
 *
 * באיחור is the one window that implies status: overdue is meaningless for a
 * completed task, so selecting it forces status back to 'open' (the server
 * rejects overdue+completed outright). Mirrors server §3.2.
 */
export function selectWindow(filters, window) {
  if (!WINDOWS.includes(window)) return filters;
  const next = { ...filters, window };
  if (window !== 'range') {
    next.rangeFrom = null;
    next.rangeTo = null;
  }
  if (window === 'overdue' && filters.status === 'completed') next.status = 'open';
  return next;
}

/** True while the status control must be locked (באיחור implies open). */
export function statusLockedBy(filters) {
  return filters.window === 'overdue' ? 'overdue' : null;
}

/** Toggle one value inside a multi-select filter (type chips, owners, …). */
export function toggleIn(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** True when nothing is filtered beyond the window — used to offer "נקה". */
export function hasActiveFilters(filters) {
  return Boolean(
    filters.typeKeys.length ||
      filters.ownerIds.length ||
      filters.priorities.length ||
      filters.stageIds.length ||
      filters.status !== 'open',
  );
}

/** A range window is only queryable once BOTH ends are set. */
export function rangeIncomplete(filters) {
  return filters.window === 'range' && !(filters.rangeFrom && filters.rangeTo);
}

export function loadFilters(me = null) {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!raw || typeof raw !== 'object') return defaultFilters(me);
    const d = defaultFilters(me);
    return {
      window: oneOf(raw.window, WINDOWS, d.window),
      rangeFrom: raw.rangeFrom ?? null,
      rangeTo: raw.rangeTo ?? null,
      typeKeys: Array.isArray(raw.typeKeys) ? raw.typeKeys : [],
      ownerIds: Array.isArray(raw.ownerIds) ? raw.ownerIds : d.ownerIds,
      priorities: Array.isArray(raw.priorities) ? raw.priorities.filter((p) => PRIORITIES.includes(p)) : [],
      stageIds: Array.isArray(raw.stageIds) ? raw.stageIds : [],
      status: oneOf(raw.status, STATUSES, d.status),
    };
  } catch {
    return defaultFilters(me);
  }
}

export function saveFilters(filters) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export { sortToParam, sortFromParam };
