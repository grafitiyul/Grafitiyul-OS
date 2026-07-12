// Issue-type registry — the single place that knows, per issue type:
//   * which actions an operator can take (buildActions → descriptors the
//     dashboard renders as buttons);
//   * how to re-check ONE issue against live domain state (recheck — used
//     right after an action so the card resolves immediately instead of
//     waiting for the next sweep tick);
//   * server-side action handlers for operations that have no existing
//     endpoint (serverActions — e.g. approving a gallery purge).
// Future modules plug in here + a detector file; the dashboard never changes.
//
// Action descriptor shape (consumed by client/src/admin/control/):
//   { key, label, kind: 'link' | 'api' | 'server',
//     style?: 'primary' | 'default' | 'danger',
//     confirm?: '…' (client confirm text),
//     target?: { type: 'deal'|'tour_event'|'whatsapp', id, orderNo? } (links) }
// 'api' actions are executed by the client against EXISTING endpoints (reuse,
// never duplicate); 'server' actions POST to /api/control/issues/:id/actions/:key.

const TYPES = new Map();

export function registerIssueType(type, def) {
  if (TYPES.has(type)) throw new Error(`issue type already registered: ${type}`);
  TYPES.set(type, def);
}

export function issueTypeDef(type) {
  return TYPES.get(type) || null;
}

export function buildIssueActions(issue) {
  const def = TYPES.get(issue.type);
  if (!def?.buildActions) return [];
  try {
    return def.buildActions(issue) || [];
  } catch {
    return [];
  }
}
