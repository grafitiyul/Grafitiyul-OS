// External-lead-created → automation events.
//
// ONE hook, called by the canonical EXTERNAL intake code paths after their
// transaction commits:
//   * ingress/pipeline.js — outcome 'created_deal' of kind 'lead' (covers Meta
//     Lead Ads, website forms, and every future adapter automatically);
//   * mirror/creators.js — the Pipedrive create-only lead bridge, on a
//     genuinely NEW open deal (never a replay: atomicCreate's alreadyExisted
//     guard runs before this).
//
// This origin-based wiring IS the external/internal distinction: internal
// creation paths (manual UI, WhatsApp, Email, duplication, migration import)
// simply never call it. Detached and swallowed — lead creation ALWAYS
// succeeds, whatever automations do.

import { prisma } from '../../db.js';
import { automationsForTrigger } from '../registry.js';
import { runAutomation } from '../runtime.js';

/** Run every external-lead automation for one created deal. */
export async function runExternalLeadAutomations(
  { dealId, origin = null, eventRef = null },
  { db = prisma, log = console } = {},
) {
  if (!dealId) return { ran: 0 };
  const defs = automationsForTrigger({ kind: 'external_lead_created' });
  if (!defs.length) return { ran: 0 };

  const refs = { dealId, leadOrigin: origin, leadEventRef: eventRef };
  let ran = 0;
  for (const def of defs) {
    // Isolated per definition — one failing automation never stops the next.
    try {
      const res = await runAutomation(def, { refs, firstSubmit: true }, { db, log });
      if (res?.recorded) ran++;
    } catch (err) {
      log.error?.(`[automations] ${def.id} threw outside the runtime: ${err?.message || err}`);
    }
  }
  return { ran };
}

/**
 * Fire-and-forget entry point for the intake paths. Never awaited by the
 * caller, never able to fail a lead creation.
 */
export function fireExternalLeadAutomations(payload, opts = {}) {
  setImmediate(() => {
    runExternalLeadAutomations(payload, opts).catch((err) => {
      (opts.log || console).error?.(`[automations] lead-created source failed: ${err?.message || err}`);
    });
  });
}
