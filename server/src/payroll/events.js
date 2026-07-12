// Payroll real-time invalidation bus — the ONE server→client notification
// path for payroll changes (Admin screens + Guide Portal Pay page).
//
// Design rules (product spec):
//   • Events are INVALIDATION HINTS only: { type, activityId, entryId,
//     externalPersonId, reason, occurredAt }. No amounts, no comments, no VAT
//     facts, no bank data ever ride the stream — clients refetch their own
//     permission-gated REST DTOs.
//   • POST-COMMIT ONLY: emitPayrollChanged(client, …) refuses to emit unless
//     `client` IS the root prisma singleton. A Prisma transaction client is a
//     different object, so an emit attempted inside a tx (or from a test
//     stub) is silently skipped — a rollback can never leak an event. All
//     payroll writes already run on the root client (tours/completion.js
//     guards its hooks the same way); tx paths self-heal via the lazy ensure.
//   • Guide filtering is server-side: a guide subscriber receives an event
//     ONLY when the event's affected-person set contains their own
//     externalPersonId — subscription scope is fixed at connect time from the
//     resolved portal token, never from a query parameter.
//   • Guide payloads are extra-minimal: the externalPersonId field is
//     stripped (they only ever match their own, and other guides' identifiers
//     must not travel on their stream).
//
// Delivery is in-process (single Railway service). If GOS ever scales to
// multiple instances this module is the seam to swap for pg NOTIFY/Redis.

import { prisma } from '../db.js';

export const PAYROLL_CHANGED_TYPE = 'payroll.changed';
export const SSE_HEARTBEAT = ':hb\n\n';
export const SSE_RETRY = 'retry: 5000\n\n';
export const HEARTBEAT_MS = 25_000; // well under Railway's edge idle timeout

// ── subscriber registry ─────────────────────────────────────────
// sub: { scope: 'admin' } | { scope: 'guide', externalPersonId }, plus send(event).
const subscribers = new Set();

export function subscribePayrollEvents(sub) {
  subscribers.add(sub);
  return () => subscribers.delete(sub);
}

export function payrollSubscriberCount() {
  return subscribers.size;
}

// ── emission ────────────────────────────────────────────────────
// Default affected-person resolver: an activity-scoped event (approve-all,
// void activity, schedule move…) fans out to every person with an entry on
// the activity. Queried lazily and ONLY when guide subscribers exist.
async function loadActivityPersons(activityId) {
  const rows = await prisma.payrollEntry.findMany({
    where: { activityId },
    select: { externalPersonId: true },
  });
  return rows.map((r) => r.externalPersonId);
}

// Exported for tests (injectable loader, awaitable). Production code goes
// through emitPayrollChanged below.
export async function dispatchPayrollChanged(
  { activityId = null, entryId = null, externalPersonId = null, externalPersonIds = null, reason },
  { loadPersons = loadActivityPersons } = {},
) {
  if (!reason) return;
  const event = {
    type: PAYROLL_CHANGED_TYPE,
    activityId,
    entryId,
    externalPersonId,
    reason,
    occurredAt: new Date().toISOString(),
  };

  // Resolve the affected-person set only if a guide is actually listening.
  let persons = null;
  const hasGuideSubs = [...subscribers].some((s) => s.scope === 'guide');
  if (hasGuideSubs) {
    if (externalPersonIds) persons = externalPersonIds;
    else if (externalPersonId) persons = [externalPersonId];
    else if (activityId) persons = await loadPersons(activityId).catch(() => []);
    else persons = [];
  }

  for (const sub of subscribers) {
    try {
      if (sub.scope === 'admin') {
        sub.send(event);
      } else if (sub.scope === 'guide' && persons && persons.includes(sub.externalPersonId)) {
        // Minimal guide payload — no person identifiers on the wire.
        const { externalPersonId: _omit, ...guideEvent } = event;
        sub.send(guideEvent);
      }
    } catch {
      // A dead socket must never break delivery to the others.
    }
  }
}

// THE canonical publisher. `client` is the prisma handle the mutation ran on;
// the identity check is the post-commit guarantee (see header).
export function emitPayrollChanged(client, fields) {
  if (client !== prisma) return;
  queueMicrotask(() => {
    dispatchPayrollChanged(fields).catch((e) =>
      console.warn('[payroll] realtime dispatch failed:', e.message),
    );
  });
}

// ── SSE plumbing ────────────────────────────────────────────────
export function sseData(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// Attach an SSE stream to an Express response and register the subscriber.
// One stream per mounted client surface; heartbeat keeps proxies from closing
// the idle connection; close cleans everything up (no leaked listeners).
export function openPayrollStream(req, res, scope) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(SSE_RETRY);
  res.write(':connected\n\n');

  const sub = { ...scope, send: (event) => res.write(sseData(event)) };
  const unsubscribe = subscribePayrollEvents(sub);
  const heartbeat = setInterval(() => {
    try {
      res.write(SSE_HEARTBEAT);
    } catch {
      cleanup();
    }
  }, HEARTBEAT_MS);
  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', cleanup);
}
