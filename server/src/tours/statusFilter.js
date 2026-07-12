// Tour status filter — ONE parser for the list + calendar endpoints, so the
// two views can never interpret the same query differently.
//
// Accepted query shapes:
//   • statuses=scheduled,postponed  — the canonical MULTI-SELECT set (client)
//   • status=active|all|<one status> — LEGACY single-select (kept for
//     back-compat: old tabs, external callers, saved links)
//   • neither — the endpoint's own default (`fallback`): the calendar keeps
//     its historical 'active' default; the list keeps returning everything
//     (fallback null) so untouched API consumers see no behavior change.
//
// Cancelled/postponed semantics stay server-owned: cancelled rows are
// returned ONLY when explicitly requested (in the set, status=cancelled, or
// 'all'/full set).

import { TOUR_EVENT_STATUSES } from './requiredFields.js';

const ACTIVE = ['scheduled', 'postponed'];

export function tourStatusWhere(query, { fallback = null } = {}) {
  const rawSet = String(query.statuses || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (rawSet.length) {
    if (rawSet.some((s) => !TOUR_EVENT_STATUSES.includes(s))) {
      return { ok: false, error: 'invalid_status' };
    }
    const set = [...new Set(rawSet)];
    // Full set = unrestricted — no clause (identical to 'all').
    if (set.length >= TOUR_EVENT_STATUSES.length) return { ok: true, where: null };
    return { ok: true, where: { in: set } };
  }

  const legacy = query.status != null && query.status !== '' ? String(query.status) : fallback;
  if (legacy == null) return { ok: true, where: null };
  if (legacy === 'all') return { ok: true, where: null };
  if (legacy === 'active') return { ok: true, where: { in: ACTIVE } };
  if (!TOUR_EVENT_STATUSES.includes(legacy)) return { ok: false, error: 'invalid_status' };
  return { ok: true, where: legacy };
}
