import { woo as realWoo, wooConfigured } from '../tours/woo/wooClient.js';
import { reconcileTourWoo } from '../tours/woo/syncWorker.js';
import { wooPendingPatch } from '../tours/woo/service.js';
import { parseDurationHours, readableSlug } from '../tours/woo/suggestConfig.js';
import { israelToday } from '../tours/slotGeneration.js';

// Server-side, durable, idempotent maintenance job (runs on Railway where the
// canonical GOS DB is reachable): safely attach the EXISTING global taxonomy
// attribute pa_משך (id 4) to WooCommerce product #167, build the per-product
// duration map from the REAL GOS durations + the live Woo terms, then backfill +
// reconcile every eligible Tel Aviv occurrence so its variations carry the
// correct duration. Snapshot-safe, non-destructive, aborts BEFORE any live write
// if a canonical duration can't map to exactly one term. Uses the MaintenanceJob
// marker (claim/run/reclaim-stale) so it runs once across restarts/instances.

// v2: v1's reconcile threw (worker selected durationHoursOverride on TourEvent,
// which lives on OpenTourTemplate) so the attribute attached but variations never
// got pa_משך. v3: v2 reconciled synchronously and raced the background worker,
// creating orphan duplicate variations — v3 stops reconciling here (worker is the
// single owner) and disables the orphan duplicates.
const KEY = 'attach_pa_meshech_167_v3';
const PRODUCT_ID = 167;
const DURATION_ATTR_ID = 4;
const STALE_MS = 15 * 60 * 1000;

const projectAttrs = (attrs) =>
  (attrs || []).map((a) => ({ id: a.id, name: a.name, position: a.position, visible: a.visible, variation: a.variation, options: a.options || [] }));

// The pure core, exported for tests. Never marks 'done' unless the attribute was
// attached AND every eligible occurrence converged (all cards complete).
export async function attachAndBackfill(client, woo, reconcile, log = console) {
  // 1. TA sellable cards mapped to #167.
  const mappings = await client.wooProductMapping.findMany({ where: { wooProductId: PRODUCT_ID, active: true } });
  if (!mappings.length) return { ok: false, error: 'no_mappings_for_167' };
  const cardGroupIds = mappings.map((m) => m.cardGroupId);

  // 2. Resolve the REAL GOS durations from the offered operational variants.
  const offered = await client.openTourTemplateProduct.findMany({
    where: { cardGroupId: { in: cardGroupIds } },
    select: { templateId: true, cardGroupId: true, productVariant: { select: { durationHours: true } } },
  });
  const durations = [...new Set(offered.map((p) => p.productVariant?.durationHours).filter((v) => v != null))];
  if (!durations.length) return { ok: false, error: 'no_gos_durations' };

  // 3. Snapshot #167.
  const product = await woo.getProduct(PRODUCT_ID);
  const attrsBefore = product.attributes || [];
  const variationsBefore = await woo.listVariations(PRODUCT_ID);
  const snapshot = { attrsBefore: projectAttrs(attrsBefore), variationIdsBefore: variationsBefore.map((v) => v.id) };

  // 4. Verify taxonomy + map every GOS duration to EXACTLY ONE existing term.
  const terms = await woo.listAttributeTerms(DURATION_ATTR_ID);
  if (!terms.length) return { ok: false, error: 'no_duration_terms', snapshot };
  const localDup = attrsBefore.find((a) => !a.id && /משך|duration/i.test(a.name || ''));
  if (localDup) return { ok: false, error: 'local_duration_attribute_exists', snapshot };
  const map = {};
  const termNamesByOption = {};
  const unmapped = [];
  for (const hours of durations) {
    const matches = terms.filter((t) => parseDurationHours(t.name) === Number(hours));
    if (matches.length !== 1) {
      unmapped.push({ hours, matched: matches.map((t) => t.name) });
      continue;
    }
    const option = readableSlug(matches[0].name);
    map[String(Number(hours))] = option;
    termNamesByOption[option] = matches[0].name;
  }
  // 5. ABORT before writing if any duration is missing/ambiguous — leave #167 untouched.
  if (unmapped.length) return { ok: false, error: 'unmapped_or_ambiguous_durations', unmapped, snapshot };

  // 6. Attach pa_משך to #167 (idempotent) — preserve every existing attribute/option.
  const alreadyDeclared = attrsBefore.some((a) => a.id === DURATION_ATTR_ID);
  const durAttrName = product.attributes.find((a) => a.id === DURATION_ATTR_ID)?.name || 'משך';
  let attrsAfter = projectAttrs(attrsBefore);
  if (!alreadyDeclared) {
    const durAttr = { id: DURATION_ATTR_ID, name: durAttrName, visible: true, variation: true, options: Object.keys(map).map((h) => termNamesByOption[map[h]]) };
    attrsAfter = [...projectAttrs(attrsBefore), durAttr];
    await woo.updateProduct(PRODUCT_ID, { attributes: attrsAfter });
    // Re-read + guard: the attribute must now be declared, nothing removed.
    const check = await woo.getProduct(PRODUCT_ID);
    if (!(check.attributes || []).some((a) => a.id === DURATION_ATTR_ID)) {
      return { ok: false, error: 'attribute_attach_failed', snapshot };
    }
    if ((check.attributes || []).length < attrsBefore.length) {
      return { ok: false, error: 'attribute_attach_dropped_existing', snapshot };
    }
  }

  // 7. Write the duration map into each TA card's mapping config (canonical, from GOS).
  const durationNode = { attrId: DURATION_ATTR_ID, attrName: durAttrName, map };
  for (const m of mappings) {
    const cfg = { ...(m.config || {}), duration: durationNode };
    await client.wooProductMapping.update({ where: { id: m.id }, data: { config: cfg } });
  }

  // 8. Mark eligible Tel Aviv occurrences Woo-pending (bumps the canonical
  // revision). We do NOT reconcile synchronously here — the background worker is
  // the SINGLE owner of convergence; reconciling in parallel raced it and created
  // orphan duplicate variations. Marking pending lets the worker converge each
  // occurrence (now with config.duration) exactly once.
  //
  // REPAIR-ONLY: only occurrences that ALREADY have a WooVariationLink are
  // marked (wooVariationLinks: some). A maintenance job must never become a
  // bulk-publication mechanism — never-linked occurrences stay unpublished until
  // explicit sync-one or WOO_SYNC_BULK_ENABLED (the worker's first-publication
  // gate also enforces this; the filter here keeps the job honest at the source).
  const templateIds = [...new Set(offered.map((p) => p.templateId))];
  const tours = await client.tourEvent.findMany({
    where: {
      openTourTemplateId: { in: templateIds },
      kind: 'group_slot',
      date: { gte: israelToday() },
      status: 'scheduled',
      wooVariationLinks: { some: {} },
    },
    select: { id: true },
  });
  if (tours.length) await client.tourEvent.updateMany({ where: { id: { in: tours.map((t) => t.id) } }, data: wooPendingPatch('maintenance') });

  // 9. Dedup: disable orphan duplicate GOS variations (same tour+card+variantKey
  // as a linked one, but NOT the linked id — an artifact of an earlier
  // job-vs-worker race). Disable → private/0 stock; NEVER delete (order integrity).
  const meta = (v, k) => (v.meta_data || []).find((m) => m.key === k)?.value;
  const links = await client.wooVariationLink.findMany({
    where: { wooProductId: PRODUCT_ID },
    select: { tourEventId: true, cardGroupId: true, variantKey: true, wooVariationId: true },
  });
  const canonical = new Map();
  for (const l of links) if (l.wooVariationId) canonical.set(`${l.tourEventId}|${l.cardGroupId}|${l.variantKey}`, l.wooVariationId);
  const variationsAfter = await woo.listVariations(PRODUCT_ID);
  const disabledIds = [];
  for (const v of variationsAfter) {
    const tour = meta(v, '_gos_tourevent_id');
    if (!tour) continue; // never touch legacy variations
    const canon = canonical.get(`${tour}|${meta(v, '_gos_card_group_id')}|${meta(v, '_gos_variant_key')}`);
    if (canon && v.id !== canon) {
      if (v.status !== 'private') {
        await woo.updateVariation(PRODUCT_ID, v.id, { status: 'private', manage_stock: true, stock_quantity: 0, stock_status: 'outofstock' });
      }
      disabledIds.push(v.id);
    }
  }

  return {
    ok: true,
    durations,
    durationMap: map,
    attrsBefore: snapshot.attrsBefore,
    attrsAfter,
    attachedAttribute: !alreadyDeclared,
    toursMarkedPending: tours.length,
    canonicalLinks: canonical.size,
    orphansDisabled: disabledIds.length,
    disabledIds,
  };
}

// Durable runner (claim/run/reclaim-stale), same pattern as reconcileOpenTourProducts.
export async function runAttachDurationOnce(client, deps = {}, log = console) {
  const woo = deps.woo || realWoo;
  const reconcile = deps.reconcileTourWoo || reconcileTourWoo;
  const configured = deps.wooConfigured ? deps.wooConfigured() : wooConfigured();
  if (!configured) {
    log?.warn?.(`[maintenance:${KEY}] skipped — Woo not configured`);
    return { skipped: true, reason: 'woo_not_configured' };
  }
  await client.maintenanceJob.upsert({ where: { key: KEY }, create: { key: KEY }, update: {} });
  const staleBefore = new Date(Date.now() - STALE_MS);
  const claimed = await client.maintenanceJob.updateMany({
    where: { key: KEY, OR: [{ status: 'pending' }, { status: 'failed' }, { status: 'running', startedAt: { lt: staleBefore } }] },
    data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } },
  });
  if (!claimed.count) return { skipped: true };

  try {
    const summary = await attachAndBackfill(client, woo, reconcile, log);
    await client.maintenanceJob.update({
      where: { key: KEY },
      data: { status: summary.ok ? 'done' : 'failed', finishedAt: new Date(), summary, error: summary.ok ? null : summary.error },
    });
    log?.log?.(`[maintenance:${KEY}] ${summary.ok ? 'done' : 'FAILED'} — ${JSON.stringify({ ok: summary.ok, error: summary.error, tours: summary.tourIds?.length, links: summary.linkCount, map: summary.durationMap })}`);
    return summary.ok ? { done: true, summary } : { failed: true, summary };
  } catch (e) {
    await client.maintenanceJob.update({ where: { key: KEY }, data: { status: 'failed', error: String(e?.message || e) } }).catch(() => {});
    log?.warn?.(`[maintenance:${KEY}] FAILED: ${e?.message || e}`);
    return { failed: true };
  }
}

export function startAttachDurationTelAviv(client, log = console) {
  runAttachDurationOnce(client, {}, log).catch((e) => log?.warn?.(`[maintenance:${KEY}] runner error: ${e?.message || e}`));
}
