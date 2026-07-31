// Mirror ↔ Operations Control registration.
//
// A new issue family is ONE registry entry, exactly like every other detector
// in the control module. The בקרה dashboard needs no changes.

import { registerIssueType } from '../control/registry.js';
import { CONFLICT_TYPE, conflictIssueDef } from './conflicts.js';

let registered = false;

export function registerMirrorIssueTypes() {
  if (registered) return;
  try {
    registerIssueType(CONFLICT_TYPE, conflictIssueDef);
    // Imported tours whose legacy activity name matches no CRM product — their
    // calendar duration stays at the default until a product is assigned.
    registerIssueType('legacy_tour_product_unmatched', {
      buildActions(issue) {
        const ref = (issue.entityRefs || [])[0];
        return ref ? [{ key: 'open', label: 'פתח את הסיור', kind: 'link', target: { type: 'tour_event', id: ref.id } }] : [];
      },
    });
    registered = true;
  } catch (e) {
    // registerIssueType throws on a duplicate key. A double call during a hot
    // reload must not take the server down.
    if (!/already registered/i.test(String(e?.message))) throw e;
    registered = true;
  }
}
