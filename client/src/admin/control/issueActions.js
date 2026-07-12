// Client-side runner for 'api'-kind issue actions — actions that reuse an
// EXISTING endpoint instead of a new /api/control mutation (reuse, never
// duplicate). Keyed by `${issueType}:${actionKey}`; each handler receives the
// full issue and performs the existing API call. After a handler resolves,
// the dashboard calls api.control.recheck(issue.id) so the card reflects
// reality immediately.
//
// Handlers may return { needsInput: 'reschedule' } instead of acting — the
// card then opens the matching input dialog and re-invokes with the payload.

const HANDLERS = new Map();

export function registerApiAction(issueType, actionKey, handler) {
  HANDLERS.set(`${issueType}:${actionKey}`, handler);
}

export function apiActionHandler(issueType, actionKey) {
  return HANDLERS.get(`${issueType}:${actionKey}`) || null;
}

// (Per-module handlers register below as their slices land.)
