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

// Every registered type MUST document itself. "There are bubbles here whose
// purpose is unclear" is a product failure, not a UI one: the meaning of a
// detector belongs next to the code that raises it, or it drifts.
//
//   labelHe   — the family's name, for the detector catalogue
//   purposeHe — what condition raises it, in one plain sentence
//   fixHe     — what makes it go away (usually "it auto-resolves when …")
const TYPES = new Map();

export function registerIssueType(type, def) {
  if (TYPES.has(type)) throw new Error(`issue type already registered: ${type}`);
  TYPES.set(type, def);
}

/**
 * The detector catalogue the בקרה screen renders under "מה המערכת בודקת".
 * Generated from the registered types themselves, so a detector can never exist
 * without an explanation and an explanation can never outlive its detector.
 */
export function detectorCatalogue() {
  return [...TYPES.entries()]
    .map(([type, def]) => ({
      type,
      labelHe: def.labelHe || type,
      purposeHe: def.purposeHe || null,
      fixHe: def.fixHe || null,
      sourceModule: def.sourceModule || null,
    }))
    .sort((a, b) => a.labelHe.localeCompare(b.labelHe, 'he'));
}

/** Types registered without documentation — asserted empty by a guard test. */
export function undocumentedIssueTypes() {
  return [...TYPES.entries()]
    .filter(([, def]) => !def.labelHe || !def.purposeHe)
    .map(([type]) => type);
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
