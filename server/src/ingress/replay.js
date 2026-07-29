// Ingress Platform — the replay framework.
//
// Replay re-runs the REAL adapter translation against the stored raw payload.
// It deliberately does not reuse the previously-computed `normalized` blob:
// the whole point is to exercise the current mapping code, so a fixed adapter
// can be validated against yesterday's traffic and a shadow comparison reflects
// what would actually happen today.
//
// Two modes:
//   replayEvent(id)                 — reprocess for real (used by the retry
//                                     worker and the admin "retry" action)
//   replayEvent(id, {asDryRun:true})— decide everything, write nothing
//
// Because processing is idempotent at the event level, replaying an already
// processed event is a no-op rather than a duplicate.

import { prisma } from '../db.js';
import { processEvent } from './pipeline.js';
import { metaAdapter } from './adapters/meta.js';
import { wooAdapter } from './adapters/woocommerce.js';
import { websiteFormAdapter } from './adapters/websiteForm.js';
import { ingressError, STAGES } from './errors.js';

/**
 * Rebuild the canonical event from a stored raw payload, using the adapter's
 * current translation code. Pure with respect to the database.
 */
export async function rebuildCanonicalEvent(row, { fetchImpl } = {}) {
  const raw = row.rawPayload || {};
  switch (row.source) {
    case metaAdapter.key: {
      const lead = raw.notification || {};
      // Details may be absent when the original fetch failed — fetch again on
      // replay, which is exactly how a transient Graph outage recovers.
      const details = raw.details || (await metaAdapter.fetchLeadDetails(lead.leadgenId, { fetchImpl }));
      return metaAdapter.toCanonicalEvent(details, lead);
    }
    case wooAdapter.key: {
      const order = raw.order || (await wooAdapter.fetchOrder(row.sourceKey, raw.orderId || row.externalId, { fetchImpl }));
      return wooAdapter.toCanonicalEvent(order, { storeKey: row.sourceKey });
    }
    case websiteFormAdapter.key:
      return websiteFormAdapter.toCanonicalEvent(raw, { formKey: row.sourceKey });
    default:
      throw ingressError('source_unknown', { stage: STAGES.VALIDATE, detail: row.source });
  }
}

export async function replayEvent(eventId, { db = prisma, asDryRun = false, fetchImpl } = {}) {
  const row = await db.ingressEvent.findUnique({ where: { id: eventId } });
  if (!row) throw ingressError('event_not_found', { stage: STAGES.RECEIVE, retryable: false });

  const canonicalEvent = await rebuildCanonicalEvent(row, { fetchImpl });

  if (asDryRun) {
    // Never mutate the stored event when only inspecting: run the decision on a
    // detached copy so a dry-run inspection cannot disturb real state.
    const probe = { ...row, dryRun: true, status: 'pending' };
    const detachedDb = {
      ...db,
      ingressEvent: {
        ...db.ingressEvent,
        findUnique: async () => probe,
        update: async ({ data }) => Object.assign(probe, data),
      },
      ingressAttempt: { create: async () => ({}) },
    };
    return processEvent(eventId, { db: detachedDb, canonicalEvent });
  }

  // A real replay of a terminal event must be explicitly reset first, otherwise
  // processEvent short-circuits. Only failed/dead are resettable — never a
  // processed one, which would risk a duplicate deal.
  if (['failed', 'dead'].includes(row.status)) {
    await db.ingressEvent.update({
      where: { id: eventId },
      data: { status: 'pending', nextRetryAt: null, claimedAt: null, claimedBy: null },
    });
  }
  return processEvent(eventId, { db, canonicalEvent });
}

/**
 * Shadow comparison helper: run a batch of stored events through the current
 * mapping WITHOUT writing, and return what the platform would have decided.
 * This is what makes pre-cutover validation against the legacy automation
 * concrete rather than a promise.
 */
export async function dryRunBatch({ source, limit = 50, db = prisma, fetchImpl } = {}) {
  const rows = await db.ingressEvent.findMany({
    where: { ...(source ? { source } : {}) },
    orderBy: { receivedAt: 'desc' },
    take: limit,
    select: { id: true },
  });
  const out = [];
  for (const r of rows) {
    try {
      const res = await replayEvent(r.id, { db, asDryRun: true, fetchImpl });
      out.push({ eventId: r.id, ok: true, decision: res.decision?.action || res.outcome, dealId: res.dealId || null });
    } catch (err) {
      out.push({ eventId: r.id, ok: false, error: err.code || 'internal_error' });
    }
  }
  return out;
}
