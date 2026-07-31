// Mirror real-time invalidation — the THIRD consumer of the shared realtime hub
// (realtime/sse.js; decision #7: one realtime system, never two).
//
// Same contract as payroll/tasks:
//   • INVALIDATION HINTS only — { type, entity, entityId, dealId, reason }.
//     The surface refetches its canonical REST DTOs wholesale.
//   • POST-COMMIT ONLY: emit refuses unless `client` IS the root prisma
//     singleton, so a test's fake db or a mid-transaction handle never leaks
//     an event for a write that might roll back.
//   • Admin-only stream (mounted behind requireAdminAuth) → plain publish.
//
// This is what makes a note added in Pipedrive appear on the open Deal page
// without a manual refresh: webhook → pipeline applies → hint → the page
// refetches its timeline.

import { prisma } from '../db.js';
import { publish } from '../realtime/sse.js';

export const MIRROR_CHANGED_TYPE = 'mirror.changed';
export const MIRROR_CHANNEL = 'mirror';

export function emitMirrorApplied(client, { entity = null, entityId = null, dealId = null, reason }) {
  if (client !== prisma) return; // post-commit only (payroll's proven guard)
  if (!reason) return;
  queueMicrotask(() => {
    try {
      publish(MIRROR_CHANNEL, {
        type: MIRROR_CHANGED_TYPE,
        entity,
        entityId,
        dealId,
        reason,
        occurredAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[mirror] realtime publish failed:', e?.message);
    }
  });
}
