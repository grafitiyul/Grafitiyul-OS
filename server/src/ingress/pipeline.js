// Ingress Platform — THE shared pipeline.
//
// Every external lead/order source runs through this exact function. Adapters
// authenticate their source and translate its payload into the canonical
// contract; from that point on there is one code path, so two sources can never
// drift in how they normalize, attribute, deduplicate or create records.
//
// Stages, in order:
//   1. RECEIVE   persist the raw payload FIRST (source truth for replay), keyed
//                by (source, idempotencyKey). A second delivery of the same
//                payload short-circuits here as `duplicate` and does nothing.
//   2. VALIDATE  structural contract check.
//   3. NORMALIZE canonical shapes (phone/email/name/money/date).
//   4. ATTRIBUTE UTM + campaign resolution.
//   5. RESOLVE   identity: contact match, organization match, dedupe decision.
//   6. PERSIST   one transaction: Contact/Deal + notes + history.
//
// Dry-run stops after stage 5 with a full decision recorded and nothing
// written. That is what makes shadow-mode comparison against the legacy
// automation safe: identical inputs, identical decisions, zero side effects.

import { prisma } from '../db.js';
import { validateEvent, hasUsableIdentity } from './contract.js';
import { normalizeEvent } from './normalize.js';
import { buildIdempotencyKey, buildDedupeKey, decideDedupe, dedupeWindowStart } from './identity.js';
import { resolveContact, findOpenDealForContact, findDealForExternalOrder } from './resolve.js';
import {
  createLeadDeal,
  writeIntakeNote,
  writeOrderStatusNote,
  updateOrderDeal,
  annotateExistingDeal,
  emitIngressHistory,
  buildIntakeNoteBody,
  buildOrderStatusNoteBody,
} from './records.js';
import { IngressError, toIngressError, STAGES } from './errors.js';
import { platformConfig } from './config.js';
import { fireNewLeadReport } from '../adminReports/newLeadEvent.js';
import { ensureInitialCallTask } from '../tasks/autoTasks.js';
import { statusMeaning } from './adapters/woocommerce.js';
import { transitionDealToWon, emitWonTransitionEffects } from '../deals/wonTransition.js';
import { publicOrigin } from '../communication/context.js';

export const MAX_ATTEMPTS = 8;
const RETRY_BASE_MS = 60 * 1000; // 1m, 2m, 4m … capped at 1h
const RETRY_CAP_MS = 60 * 60 * 1000;

export function retryDelayMs(attemptCount) {
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1));
}

/**
 * An order that has reached a PAID status wins the deal — through the canonical
 * transition, inside the caller's transaction.
 *
 * Idempotency is the service's own: transitionDealToWon guards on
 * `status != 'won'` atomically, so processing → completed wins once and the
 * second delivery is a no-op. Nothing here re-implements that.
 *
 * Non-paid statuses NEVER change the business status. In particular a refund or
 * a cancellation after payment leaves the deal WON with a loud pinned note —
 * reversing a win automatically would silently undo real revenue, tour bookings
 * and sent confirmations. That is an office decision, not a webhook's.
 *
 * Returns { wonNow, wonAt } so the caller can fire post-commit effects.
 */
async function maybeWinOrder(tx, dealId, normalized) {
  if (normalized.kind !== 'order' || !normalized.order?.paid) return { wonNow: false };
  try {
    const t = await transitionDealToWon(tx, { dealId, publicOrigin: publicOrigin() });
    return { wonNow: t.wonNow, wonAt: t.wonAt };
  } catch (err) {
    // A missing final stage must not lose the order. The deal, its note and its
    // history are already correct; the win is what failed, and it is visible.
    console.error(`[ingress] WON transition failed for deal ${dealId}: ${err?.message || err}`);
    return { wonNow: false, error: err?.code || 'won_transition_failed' };
  }
}

// Record one attempt. Never throws — an audit-write failure must not mask the
// real outcome.
async function recordAttempt(db, eventId, attemptNo, fields) {
  try {
    await db.ingressAttempt.create({ data: { eventId, attemptNo, ...fields } });
  } catch (err) {
    console.error('[ingress] attempt audit write failed', err?.message);
  }
}

/**
 * Stage 1 — durable receipt. Returns { event, duplicate }.
 * Called by the HTTP layer BEFORE any processing so nothing is ever lost.
 */
export async function receiveEvent(
  { source, sourceKey = null, externalId = null, rawPayload, rawHeaders = null, idempotencyKey = null, dryRun = false },
  db = prisma,
) {
  const key = idempotencyKey || buildIdempotencyKey({ source, sourceKey, externalId, rawBody: rawPayload });
  const forcedDryRun = platformConfig().dryRun || Boolean(dryRun);

  const existing = await db.ingressEvent.findUnique({
    where: { source_idempotencyKey: { source, idempotencyKey: key } },
    select: { id: true, status: true, dealId: true, outcome: true },
  });
  if (existing) return { event: existing, duplicate: true };

  try {
    const event = await db.ingressEvent.create({
      data: {
        source,
        sourceKey,
        externalId,
        idempotencyKey: key,
        status: 'pending',
        dryRun: forcedDryRun,
        rawPayload,
        rawHeaders,
      },
      select: { id: true, status: true, dealId: true, outcome: true },
    });
    return { event, duplicate: false };
  } catch (err) {
    // Unique-constraint race: another concurrent delivery won. That IS the
    // idempotency guarantee working — report it as a duplicate, not an error.
    if (err?.code === 'P2002') {
      const row = await db.ingressEvent.findUnique({
        where: { source_idempotencyKey: { source, idempotencyKey: key } },
        select: { id: true, status: true, dealId: true, outcome: true },
      });
      if (row) return { event: row, duplicate: true };
    }
    throw toIngressError(err, STAGES.RECEIVE);
  }
}

/**
 * Stages 2-6 — process one already-received event.
 * Pure orchestration: every decision is delegated to the shared modules.
 */
export async function processEvent(eventId, { db = prisma, canonicalEvent = null, stageKey = null } = {}) {
  const row = await db.ingressEvent.findUnique({ where: { id: eventId } });
  if (!row) throw new IngressError('event_not_found', { stage: STAGES.RECEIVE, retryable: false });
  if (row.status === 'processed' || row.status === 'duplicate') {
    return { status: row.status, dealId: row.dealId, outcome: row.outcome, skipped: true };
  }

  const attemptNo = (row.attemptCount || 0) + 1;
  const started = Date.now();
  let stage = STAGES.VALIDATE;

  try {
    // The adapter's translated contract. On a replay the caller re-supplies it
    // by re-running the adapter against the stored raw payload, so replay
    // exercises the real translation rather than a cached shortcut.
    const event = canonicalEvent;
    if (!event) throw new IngressError('canonical_event_missing', { stage: STAGES.VALIDATE, retryable: false });
    validateEvent(event);

    stage = STAGES.NORMALIZE;
    const normalized = normalizeEvent(event);
    if (!hasUsableIdentity(normalized)) {
      throw new IngressError('no_usable_identity', { stage: STAGES.NORMALIZE });
    }

    stage = STAGES.ATTRIBUTE;
    const dedupeKey = buildDedupeKey(normalized);

    stage = STAGES.RESOLVE;
    const match = await resolveContact(db, normalized);
    normalized.resolvedContactId = match.contactId;
    const priorDealId = match.contactId
      ? await findOpenDealForContact(db, match.contactId, dedupeWindowStart())
      : null;
    // The order's OWN stable identity (store + provider order id), resolved
    // independently of the person and of anything mutable on the order. This is
    // what makes pending → processing → completed one deal.
    const priorOrder = normalized.kind === 'order'
      ? await findDealForExternalOrder(db, {
          source: row.source,
          sourceKey: row.sourceKey,
          externalId: normalized.externalId,
        })
      : null;
    const decision = decideDedupe({
      kind: normalized.kind,
      priorDealId,
      priorEvent: null,
      priorOrderDealId: priorOrder?.dealId || null,
    });
    // The status this order was last seen in — rendered in the note as the
    // transition an operator is actually reading about.
    const previousStatus = priorOrder?.priorNormalized?.order?.status || null;
    const meaning = normalized.kind === 'order' ? statusMeaning(normalized.order?.status) : null;

    // ── Dry-run: everything decided, nothing written ────────────────────────
    if (row.dryRun) {
      // Render the intake note through the SAME pure builder the real write
      // uses, so shadow mode shows the exact text that would be created rather
      // than an approximation of it. Purely in-memory; nothing is persisted
      // beyond the event's own audit row.
      const notePreview =
        decision.action === 'create' && normalized.kind !== 'order'
          ? buildIntakeNoteBody(normalized, { ambiguous: match.ambiguous })
          : meaning
            ? buildOrderStatusNoteBody(normalized, meaning, { previousStatus })
            : null;
      await db.ingressEvent.update({
        where: { id: eventId },
        data: {
          status: 'dry_run',
          normalized: { ...normalized, notePreview },
          attribution: normalized.attribution,
          dedupeKey,
          contactId: match.contactId,
          outcome: decision.action === 'create'
            ? 'would_create_deal'
            : decision.action === 'update_order'
              ? 'would_update_order'
              : 'would_annotate_deal',
          dealId: decision.dealId || null,
          attemptCount: attemptNo,
          processedAt: new Date(),
          failureCode: null,
          failureMessage: null,
        },
      });
      await recordAttempt(db, eventId, attemptNo, { status: 'ok', stage: 'dry_run', durationMs: Date.now() - started });
      return {
        status: 'dry_run',
        outcome: decision.action,
        dealId: decision.dealId || null,
        decision,
        normalized,
        notePreview,
      };
    }

    // ── Persist ────────────────────────────────────────────────────────────
    stage = STAGES.PERSIST;
    // Explicit, strictly increasing timestamps. The column default is
    // CURRENT_TIMESTAMP = transaction start time, identical for every row in
    // this transaction, so without these the intake note and the history entry
    // would tie and "the first note on the deal" would not be deterministic.
    const noteAt = new Date();
    const historyAt = new Date(noteAt.getTime() + 1);

    const result = await db.$transaction(async (tx) => {
      if (decision.action === 'annotate' && decision.dealId) {
        await annotateExistingDeal(tx, { dealId: decision.dealId, normalized });
        await emitIngressHistory(tx, {
          dealId: decision.dealId,
          normalized,
          outcome: 'annotated_deal',
          createdAt: historyAt,
        });
        return { dealId: decision.dealId, contactId: match.contactId, outcome: 'annotated_deal' };
      }

      // ── The same external order, again ─────────────────────────────────────
      // A status transition or an edit. One deal, updated — never a second one.
      if (decision.action === 'update_order' && decision.dealId) {
        await updateOrderDeal(tx, {
          dealId: decision.dealId,
          normalized,
          meaning,
          previousStatus,
          createdAt: noteAt,
        });
        await emitIngressHistory(tx, {
          dealId: decision.dealId,
          normalized,
          outcome: 'updated_order_deal',
          createdAt: historyAt,
        });
        const won = await maybeWinOrder(tx, decision.dealId, normalized);
        return {
          dealId: decision.dealId,
          contactId: match.contactId || priorOrder?.contactId || null,
          outcome: 'updated_order_deal',
          won,
        };
      }

      const created = await createLeadDeal(tx, { normalized, stageKey });
      // The customer's own words land FIRST — before any system history,
      // assignment or follow-up entry. An ORDER instead opens with its pinned
      // status note, which already carries the full submitted content.
      if (normalized.kind === 'order') {
        await writeOrderStatusNote(tx, {
          dealId: created.dealId,
          normalized,
          meaning,
          previousStatus: null,
          createdAt: noteAt,
        });
      } else {
        await writeIntakeNote(tx, {
          dealId: created.dealId,
          normalized,
          ambiguous: match.ambiguous,
          createdAt: noteAt,
        });
      }
      await emitIngressHistory(tx, {
        dealId: created.dealId,
        normalized,
        outcome: 'created_deal',
        createdAt: historyAt,
      });
      const won = await maybeWinOrder(tx, created.dealId, normalized);
      return { ...created, outcome: 'created_deal', won };
    });

    await db.ingressEvent.update({
      where: { id: eventId },
      data: {
        status: 'processed',
        normalized,
        attribution: normalized.attribution,
        dedupeKey,
        contactId: result.contactId,
        organizationId: result.organizationId || null,
        dealId: result.dealId,
        outcome: result.outcome,
        attemptCount: attemptNo,
        processedAt: new Date(),
        nextRetryAt: null,
        failureCode: null,
        failureMessage: null,
      },
    });
    await recordAttempt(db, eventId, attemptNo, { status: 'ok', stage: STAGES.PERSIST, durationMs: Date.now() - started });

    // A genuinely NEW external lead was just born — fire the lead-created
    // automations (AUT registry → Communication Center). AFTER the commit,
    // detached, and only for a real creation: annotations (a repeat lead
    // inside the dedupe window), orders and dry-runs never notify. This is
    // the origin-based rule: every ingress adapter is by definition an
    // external intake source, so a future channel is included automatically.
    if (result.outcome === 'created_deal' && normalized.kind === 'lead') {
      fireNewLeadReport({ dealId: result.dealId, origin: `ingress:${row.source}`, eventRef: eventId });
      // Every new sales lead opens with exactly one "שיחה ראשונית" task.
      // Deliberately LEADS ONLY: an order deal (Woo) is a purchase, not a
      // sales call — its lifecycle is owned by the order flow.
      ensureInitialCallTask({ dealId: result.dealId });
    }

    // Post-commit effects of a genuine WON transition — Communication Center
    // triggers, Manager Report #26 and the confirmation email. Fired here, from
    // the transaction that actually flipped the status, exactly as every other
    // WON path does it. `cause` marks this as an automatic, order-driven win so
    // nothing attributes it to a human who never clicked anything.
    if (result.won?.wonNow) {
      emitWonTransitionEffects({
        dealId: result.dealId,
        wonAt: result.won.wonAt,
        cause: 'woo_order',
        paymentAmountMinor: null,
      });
    }
    return { status: 'processed', ...result };
  } catch (err) {
    const ie = toIngressError(err, stage);
    // Permanent faults must not burn retries; transient ones retry with
    // exponential backoff until MAX_ATTEMPTS, then park as `dead` for a human.
    const exhausted = attemptNo >= MAX_ATTEMPTS;
    const status = !ie.retryable ? 'failed' : exhausted ? 'dead' : 'pending';
    await db.ingressEvent.update({
      where: { id: eventId },
      data: {
        status,
        attemptCount: attemptNo,
        failureCode: ie.code,
        failureMessage: ie.detail ? String(ie.detail).slice(0, 1000) : null,
        nextRetryAt: status === 'pending' ? new Date(Date.now() + retryDelayMs(attemptNo)) : null,
        claimedAt: null,
        claimedBy: null,
      },
    });
    await recordAttempt(db, eventId, attemptNo, {
      status: 'failed',
      stage: ie.stage,
      failureCode: ie.code,
      failureMessage: ie.detail ? String(ie.detail).slice(0, 1000) : null,
      durationMs: Date.now() - started,
    });
    return { status, failureCode: ie.code, retryable: ie.retryable };
  }
}

/**
 * The convenience path used by every adapter: receive + process in one call.
 * Receipt is durable before processing, so a processing crash never loses the
 * payload — the worker will pick it up.
 */
export async function ingest(
  { source, sourceKey, externalId, rawPayload, rawHeaders, idempotencyKey, dryRun, canonicalEvent, stageKey },
  db = prisma,
) {
  const { event, duplicate } = await receiveEvent(
    { source, sourceKey, externalId, rawPayload, rawHeaders, idempotencyKey, dryRun },
    db,
  );
  if (duplicate) {
    return { eventId: event.id, status: 'duplicate', dealId: event.dealId, outcome: event.outcome };
  }
  const result = await processEvent(event.id, { db, canonicalEvent, stageKey });
  return { eventId: event.id, ...result };
}
