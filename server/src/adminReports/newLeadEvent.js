// A genuinely NEW external lead → Manager Report #25.
//
// ── The origin rule, carried over unchanged ─────────────────────────────────
// This is the same single fan-out point AUT-004 used, moved from
// automations/sources/ to sit beside its siblings (agentOrderEvent,
// quoteSignedEvent, openTourParticipantEvent). What decides whether a lead is
// "external" is NOT re-implemented here — it is WHO CALLS THIS:
//
//   * ingress/pipeline.js — outcome 'created_deal' of kind 'lead', which covers
//     Meta Lead Ads, website forms and every adapter added later;
//   * mirror/creators.js — the Pipedrive create-only lead bridge, on a
//     genuinely new open deal (atomicCreate's alreadyExisted guard runs first).
//
// That origin-based wiring IS the external/internal distinction. Manual
// creation, deals opened from a WhatsApp or Email conversation, creation from
// an existing contact, duplication, migration imports, repairs and backfills
// simply never call it — there is no flag to get wrong and no screen to infer
// from.
//
// ── Exactly once ────────────────────────────────────────────────────────────
// The deal id is the immutable creation identity. A replayed webhook, an
// ingress retry or a worker restart all resolve to the same deal, so the
// unique (reportNumber, idempotencyKey) index drops the second attempt. This
// is the same guarantee AUT-004 gave via AutomationRun, on the index that now
// owns it.

import { fireAdminReport } from './dispatch.js';

/** The idempotency identity of one lead notification. */
export const newLeadKey = (dealId) => `new_lead:${dealId}`;

/** Report ONE newly created external lead. Never throws into the caller. */
export async function reportNewLead({ dealId, origin = null, eventRef = null }, log = console) {
  if (!dealId) return { ok: false, reason: 'no_deal' };
  return fireAdminReport({
    number: 25,
    idempotencyKey: newLeadKey(dealId),
    dealId,
    // Provenance is frozen onto the delivery row for the audit trail; the
    // message itself reads the lead source from canonical deal data.
    data: { leadOrigin: origin, leadEventRef: eventRef },
  }, log);
}

/**
 * Fire-and-forget entry point for the intake paths. Never awaited by the
 * caller, never able to fail a lead creation.
 */
export function fireNewLeadReport(payload, log = console) {
  setImmediate(() => {
    reportNewLead(payload, log).catch((err) => {
      log.error?.(`[admin-reports] new-lead report failed: ${err?.message || err}`);
    });
  });
}
