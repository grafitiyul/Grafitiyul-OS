import { reconcileAllOpenTourProducts } from '../tours/reconcileProducts.js';

// Automatic one-time reconciliation of stale open-tour operational products,
// gated by a durable MaintenanceJob MARKER so it runs EXACTLY ONCE across
// restarts and across multiple Railway instances. Triggered from server startup;
// the marker (not the in-memory call) is what guarantees single execution.
//
// Concurrency-safe CLAIM: a conditional updateMany flips the row to 'running'
// only when it is pending / failed / stale-running — Postgres serializes the
// UPDATEs, so exactly one instance's claim matches (count===1) and proceeds; the
// others see count===0 and skip. Retry-safe: a 'failed' or a crashed 'running'
// (older than STALE_MS) is reclaimed on the next deploy. Non-destructive and
// idempotent (a run with nothing stale changes nothing). Bump the KEY for a new
// versioned reconciliation.

// v2: v1 recomputed the tour product FROM the registrations but never corrected
// the registrations' own stale (workshop) variants, so a plain-only tour kept
// re-deriving workshop. v2 re-aligned deal-registration variants to their deal
// first, then recomputed.
// v3: v2 aligned to deal.productVariantId, which is ITSELF a stale snapshot for a
// group deal (it never reflects the Group Ticket Builder card edits). v3 re-aligns
// each deal registration to its CANONICAL offering resolved from the deal's
// group-ticket quote lines (the cards actually bought) — variant AND breakdown —
// so a plain-only card selection heals a tour even when deal.productVariantId is
// stale workshop. A new KEY forces the corrected job to re-run once.
const KEY = 'reconcile_open_tour_products_v3';
const STALE_MS = 15 * 60 * 1000;

// Extracted for tests. Returns { done, skipped, failed, summary? }.
export async function runReconcileOpenTourProductsOnce(client, log = console, { now = () => new Date() } = {}) {
  // Ensure the marker row exists (idempotent).
  await client.maintenanceJob.upsert({ where: { key: KEY }, create: { key: KEY }, update: {} });

  const staleBefore = new Date(now().getTime() - STALE_MS);
  const claimed = await client.maintenanceJob.updateMany({
    where: {
      key: KEY,
      OR: [{ status: 'pending' }, { status: 'failed' }, { status: 'running', startedAt: { lt: staleBefore } }],
    },
    data: { status: 'running', startedAt: now(), attempts: { increment: 1 } },
  });
  if (!claimed.count) {
    // Already done, or being handled by another instance.
    return { skipped: true };
  }

  try {
    const summary = await reconcileAllOpenTourProducts(client, { force: false, realign: true, log });
    await client.maintenanceJob.update({
      where: { key: KEY },
      data: { status: 'done', finishedAt: now(), summary, error: null },
    });
    log?.log?.(
      `[maintenance:${KEY}] done — scanned=${summary.scanned} changed=${summary.changed} unchanged=${summary.unchanged} regsRealigned=${summary.regsRealigned} pinsCleared=${summary.pinsCleared} pinnedSkipped=${summary.pinnedSkipped} failed=${summary.failed}`,
    );
    if (summary.changedIds.length) log?.log?.(`[maintenance:${KEY}] changed ids: ${summary.changedIds.join(', ')}`);
    if (summary.stillWorkshopIds.length)
      log?.log?.(`[maintenance:${KEY}] still workshop (genuine or pinned): ${summary.stillWorkshopIds.join(', ')}`);
    return { done: true, summary };
  } catch (e) {
    // Leave it 'failed' so a later deploy reclaims and retries.
    await client.maintenanceJob
      .update({ where: { key: KEY }, data: { status: 'failed', error: String(e?.message || e) } })
      .catch(() => {});
    log?.warn?.(`[maintenance:${KEY}] FAILED: ${e?.message || e}`);
    return { failed: true };
  }
}

// Fire-and-forget wrapper for startup: never throws into the boot sequence.
export function startReconcileOpenTourProducts(client, log = console) {
  runReconcileOpenTourProductsOnce(client, log).catch((e) =>
    log?.warn?.(`[maintenance:${KEY}] runner error: ${e?.message || e}`),
  );
}
