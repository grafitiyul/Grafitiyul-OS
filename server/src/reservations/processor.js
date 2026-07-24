// Travel Agency Reservations — the source-blind session processor (Slice 3).
// Turns each pending ReservationGroup into an OPEN Deal EXACTLY ONCE:
//
//   1. Claim the session (conditional updateMany + TTL — the whatsapp
//      scheduledWorker pattern). count===0 ⇒ another processor owns it.
//   2. Per group, ONE transaction: re-check createdDealId → create the Deal →
//      stamp createdDealId (unique) → emit the deal timeline event. If the tx
//      commits, the pointer exists and every future pass skips the group; if
//      it rolls back, a retry is a clean re-attempt. Double-creation is
//      impossible under concurrent workers or crash-replays.
//   3. Finalize: processed / partially_processed / failed (+ exponential
//      nextRetryAt while attempts remain), release the claim, emit the
//      session-level history events.
//
// Failed groups NEVER roll back sibling successes — a Deal is an independent
// business object from the moment it exists (approved architecture §3.3).

import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { emitTimelineEvent, systemOrigin } from '../timeline/events.js';
import { createDealFromReservationGroup } from './createDeal.js';
import { ensureReservationDocument } from './document.js';
import { writeReservationBuilder } from './reservationBuilder.js';

// The group's FROZEN pricing model (payloadSnapshot.pricingByGroup), keyed by
// the group's submission position — the SAME canonical result the preview + PDF
// use. Consumed as-is by the Builder writer; never recomputed here.
function pricingForGroup(session, group) {
  const pbg = Array.isArray(session?.payloadSnapshot?.pricingByGroup)
    ? session.payloadSnapshot.pricingByGroup
    : [];
  return pbg[group.sortOrder] ?? null;
}

export const CLAIM_TTL_MS = 2 * 60 * 1000;
export const MAX_ATTEMPTS = 8;
const RETRY_BASE_MS = 60 * 1000; // 1m, 2m, 4m … capped at 1h
const RETRY_CAP_MS = 60 * 60 * 1000;

// Statuses a processor may pick up. 'processed' and 'cancelled' are terminal.
const CLAIMABLE = ['submitted', 'processing', 'partially_processed', 'failed'];

export function retryDelayMs(attemptCount) {
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1));
}

export async function processReservationSession(sessionId, db = prisma) {
  const now = new Date();
  const claimId = crypto.randomBytes(9).toString('base64url');
  const claimed = await db.reservationSession.updateMany({
    where: {
      id: sessionId,
      status: { in: CLAIMABLE },
      OR: [{ claimId: null }, { claimExpiresAt: { lt: now } }],
    },
    data: {
      status: 'processing',
      claimId,
      claimExpiresAt: new Date(now.getTime() + CLAIM_TTL_MS),
      attemptCount: { increment: 1 },
    },
  });
  if (claimed.count === 0) return { claimed: false };

  const session = await db.reservationSession.findUnique({
    where: { id: sessionId },
    include: { groups: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!session) return { claimed: false };

  const wasProcessedBefore = !!session.processedAt;
  let processed = 0;
  let failed = 0;

  for (const group of session.groups) {
    if (group.createdDealId) {
      processed += 1;
      continue;
    }
    try {
      await db.$transaction(async (tx) => {
        // Exactly-once re-check inside the transaction boundary.
        const fresh = await tx.reservationGroup.findUnique({ where: { id: group.id } });
        if (!fresh || fresh.createdDealId) return;
        const deal = await createDealFromReservationGroup(tx, { session, group: fresh });
        // The accepted price IS the Deal's Builder state (defects #6/#7): write the
        // group's FROZEN pricing into the Deal's primary Builder version + cache the
        // gross on Deal.valueMinor. Same transaction as the exactly-once pointer, so
        // a Deal never exists without its priced Builder (and never double-writes).
        await writeReservationBuilder(tx, {
          dealId: deal.id,
          pricing: pricingForGroup(session, fresh),
          productVariantId: fresh.productVariantId,
          productLabel: fresh.productLabel,
        });
        await tx.reservationGroup.update({
          where: { id: group.id },
          data: {
            createdDealId: deal.id,
            status: 'processed',
            processedAt: new Date(),
            lastError: null,
          },
        });
        await emitTimelineEvent(tx, {
          subjectId: deal.id,
          kind: 'note',
          body: `<p>הדיל נוצר מטופס ההזמנות לסוכנים — בקשה #${session.sessionNo} (קבוצה ${group.sortOrder + 1} מתוך ${session.groups.length}).</p>`,
          data: {
            event: 'reservation_deal_created',
            reservationSessionId: session.id,
            reservationGroupId: group.id,
            sessionNo: session.sessionNo,
          },
          origin: systemOrigin(),
        });
      });
      processed += 1;
    } catch (e) {
      failed += 1;
      await db.reservationGroup
        .update({
          where: { id: group.id },
          data: {
            status: 'failed',
            lastError: (e?.code || e?.message || 'unknown').slice(0, 300),
            attemptCount: { increment: 1 },
          },
        })
        .catch(() => {});
    }
  }

  const finishedAt = new Date();
  const status = failed === 0 ? 'processed' : processed > 0 ? 'partially_processed' : 'failed';
  const retriesLeft = failed > 0 && session.attemptCount + 1 < MAX_ATTEMPTS;
  await db.reservationSession.update({
    where: { id: sessionId },
    data: {
      status,
      processedAt: failed === 0 ? finishedAt : null,
      nextRetryAt: retriesLeft
        ? new Date(finishedAt.getTime() + retryDelayMs(session.attemptCount + 1))
        : null,
      lastError: failed === 0 ? null : `${failed} group(s) failed`,
      claimId: null,
      claimExpiresAt: null,
    },
  });

  // Session-level history (post-commit, best-effort): one entry on the
  // reservation_session subject per outcome transition, plus one on the agent
  // Contact the first time the session fully processes.
  try {
    await emitTimelineEvent(db, {
      subjectType: 'reservation_session',
      subjectId: sessionId,
      kind: 'note',
      body:
        status === 'processed'
          ? `<p>כל ${session.groups.length} הקבוצות עובדו לדילים.</p>`
          : `<p>עיבוד הסתיים: ${processed} הצליחו, ${failed} נכשלו.</p>`,
      data: { event: 'reservation_processing_result', status, processed, failed },
      origin: systemOrigin(),
    });
    if (status === 'processed' && !wasProcessedBefore && session.contactId) {
      await emitTimelineEvent(db, {
        subjectType: 'contact',
        subjectId: session.contactId,
        kind: 'note',
        body: `<p>בקשת הזמנה #${session.sessionNo} עובדה — ${session.groups.length} דילים נוצרו.</p>`,
        data: { event: 'reservation_session_processed', reservationSessionId: sessionId },
        origin: systemOrigin(),
      });
    }
  } catch {
    /* history must never fail the processing result */
  }

  // Canonical summary document — generated ONCE, only after full success
  // (every group has its Deal). Best-effort: a PDF failure never affects the
  // processing result; every download path retries via the same idempotent
  // ensure, so a transient failure self-heals.
  if (status === 'processed') {
    try {
      await ensureReservationDocument(sessionId, db);
    } catch (e) {
      console.warn('[reservations] summary document generation failed:', e?.message);
    }
  }

  return { claimed: true, status, processed, failed };
}
