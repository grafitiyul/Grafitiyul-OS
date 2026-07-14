import { woo as realWoo, wooConfigured } from '../tours/woo/wooClient.js';
import { wooPendingPatch } from '../tours/woo/service.js';
import { kickWooSync } from '../tours/woo/syncWorker.js';
import { reconcileProductOptions } from '../tours/woo/productOptions.js';

// Durable one-time repair of the LIVE sellable state for every GOS-mapped Woo
// product (currently #167):
//   1. every ALREADY-LINKED occurrence (any status — scheduled AND cancelled)
//      of the mapped templates is marked Woo-pending with 'maintenance'
//      provenance, so the worker re-converges each variation with the corrected
//      PER-CARD duration (tour-only 1.5h vs tour+workshop 2.5h). Repair-only by
//      construction: never-linked occurrences are NOT marked — first-time
//      publication stays behind explicit sync-one / WOO_SYNC_BULK_ENABLED.
//   2. the product's public attribute options are reconciled from the actual
//      published variation set (cancelled/stale dates disappear from the
//      selector; shared dates survive) and the global date/time terms get a
//      chronological menu_order (fixes lexicographic dd/mm/yyyy ordering).
// Idempotent + claim-guarded (MaintenanceJob) — runs once across restarts.
const KEY = 'woo_sellable_repair_v1';
const STALE_MS = 15 * 60 * 1000;

// The core, exported for tests. deps: { woo, log }.
export async function repairWooSellableState(client, woo, log = console) {
  const mappings = await client.wooProductMapping.findMany({ where: { active: true } });
  if (!mappings.length) return { ok: true, note: 'no_active_mappings', products: [] };

  const cardGroupIds = [...new Set(mappings.map((m) => m.cardGroupId))];
  const offered = await client.openTourTemplateProduct.findMany({
    where: { cardGroupId: { in: cardGroupIds } },
    select: { templateId: true },
  });
  const templateIds = [...new Set(offered.map((p) => p.templateId))];

  // 1. Repair-only re-convergence: LINKED occurrences of the mapped templates.
  const tours = templateIds.length
    ? await client.tourEvent.findMany({
        where: {
          openTourTemplateId: { in: templateIds },
          kind: 'group_slot',
          wooVariationLinks: { some: {} },
        },
        select: { id: true },
      })
    : [];
  if (tours.length) {
    await client.tourEvent.updateMany({
      where: { id: { in: tours.map((t) => t.id) } },
      data: wooPendingPatch('maintenance'),
    });
  }

  // 2. Public selector truth + chronological order, per mapped product.
  const productIds = [...new Set(mappings.map((m) => m.wooProductId))];
  const products = [];
  for (const productId of productIds) {
    const before = (await woo.getProduct(productId)).attributes || [];
    const result = await reconcileProductOptions({ db: client, woo, log }, productId);
    products.push({
      productId,
      changed: result.changed,
      removed: result.removed,
      optionsBefore: Object.fromEntries(before.map((a) => [a.id ?? a.name, a.options || []])),
    });
  }

  return { ok: true, toursMarkedPending: tours.length, products };
}

export async function runWooSellableRepairOnce(client, deps = {}, log = console) {
  const woo = deps.woo || realWoo;
  const configured = deps.wooConfigured ? deps.wooConfigured() : wooConfigured();
  if (!configured) {
    log?.warn?.(`[maintenance:${KEY}] skipped — Woo not configured`);
    return { skipped: true, reason: 'woo_not_configured' };
  }
  await client.maintenanceJob.upsert({ where: { key: KEY }, create: { key: KEY }, update: {} });
  const staleBefore = new Date(Date.now() - STALE_MS);
  const claimed = await client.maintenanceJob.updateMany({
    where: {
      key: KEY,
      OR: [{ status: 'pending' }, { status: 'failed' }, { status: 'running', startedAt: { lt: staleBefore } }],
    },
    data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } },
  });
  if (!claimed.count) return { skipped: true };

  try {
    const summary = await repairWooSellableState(client, woo, log);
    await client.maintenanceJob.update({
      where: { key: KEY },
      data: { status: summary.ok ? 'done' : 'failed', finishedAt: new Date(), summary, error: summary.ok ? null : summary.error },
    });
    kickWooSync();
    log?.log?.(
      `[maintenance:${KEY}] ${summary.ok ? 'done' : 'FAILED'} — pending=${summary.toursMarkedPending ?? 0} products=${JSON.stringify(
        (summary.products || []).map((p) => ({ id: p.productId, changed: p.changed, removed: p.removed })),
      )}`,
    );
    return summary.ok ? { done: true, summary } : { failed: true, summary };
  } catch (e) {
    await client.maintenanceJob
      .update({ where: { key: KEY }, data: { status: 'failed', error: String(e?.message || e) } })
      .catch(() => {});
    log?.warn?.(`[maintenance:${KEY}] FAILED: ${e?.message || e}`);
    return { failed: true };
  }
}

export function startWooSellableRepair(client, log = console) {
  runWooSellableRepairOnce(client, {}, log).catch((e) =>
    log?.warn?.(`[maintenance:${KEY}] runner error: ${e?.message || e}`),
  );
}
