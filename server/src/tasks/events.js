// Tasks real-time invalidation — the workspace's server→client hint channel,
// the SECOND consumer of the shared realtime hub (realtime/sse.js).
//
// Same contract as payroll:
//   • INVALIDATION HINTS only — { type, taskId, dealId, reason, occurredAt }.
//     taskId/dealId are advisory; the workspace refetches its canonical DTOs
//     wholesale (self-correcting, same convention as gos:tour-changed).
//   • POST-COMMIT ONLY: emitTasksChanged(client, …) refuses unless `client` IS
//     the root prisma singleton. taskService threads its `db` handle here, so
//     production emits fire and a test's fake db (or a tx client) silently
//     skips — a rollback can never leak an event.
//   • No per-subscriber filtering: every subscriber is an admin (the stream is
//     mounted behind requireAdminAuth), so this uses the hub's plain publish.
//
// This is what makes "another admin edited a task" and "the WhatsApp worker
// completed a send" appear in the workspace without a refresh — the halves the
// same-browser event bus (client taskEvents.js) can never see.

import { prisma } from '../db.js';
import { publish } from '../realtime/sse.js';

export const TASKS_CHANGED_TYPE = 'tasks.changed';
export const TASKS_CHANNEL = 'tasks';

export function emitTasksChanged(client, { taskId = null, dealId = null, reason }) {
  if (client !== prisma) return; // post-commit only (payroll's proven guard)
  if (!reason) return;
  queueMicrotask(() => {
    try {
      publish(TASKS_CHANNEL, {
        type: TASKS_CHANGED_TYPE,
        taskId,
        dealId,
        reason,
        occurredAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[tasks] realtime publish failed:', e?.message);
    }
  });
}
