// Payroll real-time invalidation bus — the ONE server→client notification
// path for payroll changes (Admin screens + Guide Portal Pay page).
//
// MECHANISM (subscriber registry, fan-out, SSE plumbing, heartbeat) now lives
// in the shared realtime hub (realtime/sse.js), extracted from this file when
// the CRM Tasks workspace became the second realtime consumer. This module
// keeps payroll POLICY, unchanged:
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
// Every export keeps its original name and behaviour — the existing tests are
// the regression net proving the extraction changed nothing.

import { prisma } from '../db.js';
import { subscribe, subscribersOf, subscriberCount, openStream, sseData, SSE_HEARTBEAT, SSE_RETRY, HEARTBEAT_MS } from '../realtime/sse.js';

export const PAYROLL_CHANGED_TYPE = 'payroll.changed';
export const PAYROLL_CHANNEL = 'payroll';
export { sseData, SSE_HEARTBEAT, SSE_RETRY, HEARTBEAT_MS };

// ── subscriber registry (now channelised in the shared hub) ─────
// sub: { scope: 'admin' } | { scope: 'guide', externalPersonId }, plus send(event).
export function subscribePayrollEvents(sub) {
  return subscribe(PAYROLL_CHANNEL, sub);
}

export function payrollSubscriberCount() {
  return subscriberCount(PAYROLL_CHANNEL);
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
// through emitPayrollChanged below. Payroll does NOT use the hub's plain
// publish(): guide filtering + payload stripping are policy, so it iterates
// the subscriber snapshot itself.
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

  const subs = subscribersOf(PAYROLL_CHANNEL);

  // Resolve the affected-person set only if a guide is actually listening.
  let persons = null;
  const hasGuideSubs = subs.some((s) => s.scope === 'guide');
  if (hasGuideSubs) {
    if (externalPersonIds) persons = externalPersonIds;
    else if (externalPersonId) persons = [externalPersonId];
    else if (activityId) persons = await loadPersons(activityId).catch(() => []);
    else persons = [];
  }

  for (const sub of subs) {
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

// ── SSE plumbing (shared hub) ───────────────────────────────────
export function openPayrollStream(req, res, scope) {
  openStream(req, res, { channel: PAYROLL_CHANNEL, ...scope });
}
