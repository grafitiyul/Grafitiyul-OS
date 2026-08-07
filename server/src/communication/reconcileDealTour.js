// Pending-delivery reconciliation when a Deal MOVES from one tour to another.
//
// ── The defect this closes ──────────────────────────────────────────────────
//
// CommunicationDelivery.tourEventId is frozen when the delivery is created
// (engine.js), and at send time the worker rebuilds context with
// `loadTriggerContext({ dealId, sessionId, tourEventId: row.tourEventId })` —
// where context.js gives the FROZEN id precedence over the deal's current
// booking. The worker has exactly one escape hatch for a stale anchor: the
// tour being cancelled.
//
// A GROUP SLOT IS NEVER CANCELLED WHEN ONE DEAL LEAVES IT (tourFromDeal.js —
// group slots are explicitly excluded from auto-cancel, because other customers
// are still on them). So after a group → private conversion, every pending
// tour-anchored delivery still points at a live group slot: it fires at the OLD
// date, renders the OLD meeting point, and tells a customer to show up
// somewhere they are no longer booked. Nothing in the system noticed.
//
// ── The two-phase design, and why ───────────────────────────────────────────
//
// PARK (inside the conversion transaction, cheap, no context loading)
//   Re-point every pending delivery at the new tour and hold it in
//   `waiting_dependency` for a short grace period. Nothing can send with the
//   old operational state from the instant the conversion commits — that is
//   §11's invariant, and it has to hold inside the transaction to be real.
//
// FINALIZE (post-commit, needs the full trigger context)
//   Re-evaluate the message against the deal's NEW state and either release it
//   with a correctly recomputed send time, or cancel it. A message scoped to
//   group deals must not reach a deal that is no longer one, and a "3 days
//   before the tour" reminder has to be re-timed off the new tour's date.
//
// Splitting it this way is deliberate: applicability and timing need
// loadTriggerContext (which reads through the global client, not the caller's
// tx), and holding a transaction open across those loads to save 60 seconds of
// grace would be the wrong trade. If FINALIZE never runs, the worst case is the
// grace period lapsing and the worker applying its OWN anchor re-resolution to
// the NEW tour — already-correct behaviour, just without the applicability
// re-check. Failure is therefore degraded, never wrong, and it raises a
// recovery card.
//
// Re-pointing rather than blanket-cancelling is also deliberate: "your tour is
// tomorrow" is still the right message to send, about a different tour.
// Cancelling everything would silently drop customer communications.
//
// SENT rows are never touched. What GOS told a customer is history.

import { prisma as defaultPrisma } from '../db.js';
import { loadTriggerContext, applyTriggerOverrides } from './context.js';
import { evaluateApplicability } from './conditions.js';
import { resolveAnchorMs, applyOffset } from './timing.js';

// Every state a delivery can sit in before it has been sent. 'failed' is
// retryable and therefore still pending; 'failed_final', 'sent', 'skipped' and
// 'cancelled' are terminal and out of scope.
export const PENDING_DELIVERY_STATUSES = [
  'scheduled',
  'waiting_window',
  'waiting_dependency',
  'failed',
];

// How long a parked delivery is held before the worker would pick it up on its
// own. Long enough for the post-commit finalize to win the race in every normal
// case; short enough that a crashed finalize does not strand a real customer
// message. The worker's own dependency recheck is 10 minutes, so this is
// deliberately the tighter of the two.
export const PARK_GRACE_MS = 2 * 60_000;

const PARK_REASON_HE = 'הדיל הועבר לסוג פעילות אחר — מועד השליחה מחושב מחדש';
const CANCEL_REASON_HE = 'בוטל: הדיל הועבר לסוג פעילות אחר והמסר אינו חל עליו יותר';

/**
 * PHASE 1 — runs INSIDE the conversion transaction.
 *
 * Re-points the deal's pending deliveries from the old tour to the new one and
 * parks them. Returns the parked delivery ids so the caller can hand them to
 * finalize; an empty array means there was nothing scheduled and phase 2 is a
 * no-op.
 *
 * Idempotent: a second run finds nothing on `fromTourEventId` (the rows now
 * carry `toTourEventId`) and returns [].
 */
export async function parkDealTourDeliveries(
  tx,
  { dealId, fromTourEventId, toTourEventId = null, now = new Date() },
) {
  if (!dealId || !fromTourEventId || fromTourEventId === toTourEventId) return [];

  const rows = await tx.communicationDelivery.findMany({
    where: {
      dealId,
      tourEventId: fromTourEventId,
      status: { in: PENDING_DELIVERY_STATUSES },
    },
    select: { id: true },
  });
  if (!rows.length) return [];

  await tx.communicationDelivery.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: {
      // The new operational truth. When the deal has no new tour (it cannot
      // happen in a conversion, but the signature allows it) the delivery is
      // left pointing nowhere and finalize resolves it from the deal alone.
      tourEventId: toTourEventId,
      status: 'waiting_dependency',
      waitReason: PARK_REASON_HE,
      effectiveAt: null,
      nextRetryAt: new Date(now.getTime() + PARK_GRACE_MS),
    },
  });
  return rows.map((r) => r.id);
}

/**
 * PHASE 2 — runs AFTER the conversion commits.
 *
 * For each parked delivery: re-evaluate the message against the deal's new
 * state, then either cancel it or release it with a send time recomputed from
 * the new tour.
 *
 * Idempotent by construction — it only acts on rows still sitting in
 * `waiting_dependency` with the park reason, so a repeat run (retry, second
 * click) finds nothing left to do. Never throws: the caller is a fire-and-forget
 * post-commit site, and a reconciliation failure must not look like a failed
 * conversion.
 *
 * Returns { released, cancelled, waiting, failed } for the audit record.
 */
export async function finalizeDealTourDeliveries(
  { deliveryIds, dealId },
  { db = defaultPrisma, log = console } = {},
) {
  const out = { released: 0, cancelled: 0, waiting: 0, failed: 0 };
  if (!deliveryIds?.length) return out;

  for (const id of deliveryIds) {
    try {
      const row = await db.communicationDelivery.findUnique({
        where: { id },
        include: { message: { include: { event: true } } },
      });
      // Someone else already resolved it (the worker won the race, an operator
      // cancelled it by hand) — leave it exactly as it is.
      if (!row || row.status !== 'waiting_dependency' || row.waitReason !== PARK_REASON_HE) continue;

      const event = row.message?.event;
      if (!event) {
        await db.communicationDelivery.update({
          where: { id },
          data: { status: 'cancelled', cancelledAt: new Date(), waitReason: CANCEL_REASON_HE },
        });
        out.cancelled++;
        continue;
      }

      const ctx = applyTriggerOverrides(
        await loadTriggerContext({
          dealId: row.dealId || dealId,
          sessionId: row.sessionId,
          tourEventId: row.tourEventId,
        }),
        row.triggerData,
      );

      // Does this message still apply to what the deal has BECOME? The same
      // pure evaluator the engine used to create the delivery in the first
      // place — a group-only message must not survive onto a private deal.
      const { applicable } = evaluateApplicability(event, ctx);
      if (!applicable) {
        await db.communicationDelivery.update({
          where: { id },
          data: { status: 'cancelled', cancelledAt: new Date(), waitReason: CANCEL_REASON_HE },
        });
        out.cancelled++;
        continue;
      }

      // Re-time against the new tour using the WORKER'S OWN pure helpers, so a
      // reconciled delivery and a naturally-rescheduled one can never land on
      // different instants.
      const anchor = resolveAnchorMs(event, ctx, row.intendedAt.getTime());
      if (anchor == null) {
        // The new tour has no date yet (a postponed private tour). Hand it back
        // to the worker's ordinary dependency wait rather than inventing a time.
        await db.communicationDelivery.update({
          where: { id },
          data: {
            waitReason: 'ממתין לעוגן זמן (לסיור אין עדיין מועד)',
            nextRetryAt: new Date(Date.now() + PARK_GRACE_MS),
          },
        });
        out.waiting++;
        continue;
      }
      await db.communicationDelivery.update({
        where: { id },
        data: {
          status: 'scheduled',
          intendedAt: new Date(applyOffset(anchor, event)),
          waitReason: null,
          effectiveAt: null,
          nextRetryAt: null,
        },
      });
      out.released++;
    } catch (err) {
      out.failed++;
      log.error(`[communication] delivery reconcile failed for ${id}: ${err?.message || err}`);
    }
  }
  return out;
}

/**
 * Read-only: what is still scheduled for this deal on this tour?
 *
 * The conversion PREVIEW shows the operator the real number before they commit,
 * so "N future messages will be re-timed or cancelled" is a fact rather than a
 * promise. Never writes.
 */
export async function pendingDeliveryCount(client, { dealId, tourEventId }) {
  if (!dealId) return 0;
  return client.communicationDelivery.count({
    where: {
      dealId,
      ...(tourEventId ? { tourEventId } : {}),
      status: { in: PENDING_DELIVERY_STATUSES },
    },
  });
}
