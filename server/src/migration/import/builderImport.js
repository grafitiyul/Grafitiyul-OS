// HISTORICAL PRODUCT LINES → canonical QuoteVersion/QuoteLine (read-only frozen).
// Owner-approved 2026-07-21. Pure planner + reconciliation + additive executor.
//
// INVARIANTS (all enforced here):
//   - Reuses the canonical Builder model (QuoteVersion + QuoteLine). No parallel
//     pricing system.
//   - The imported version is `sourceKind='pipedrive_import'`, isWorking=false —
//     the live Builder never edits it, the engine never reprices it, and it
//     NEVER touches Deal.valueMinor.
//   - Lines are kind 'manual' with the price FROZEN in unitPriceMinor, so the
//     compose path always uses the stored price (never the current cards).
//   - Idempotent by the LegacyRecord crosswalk (sourceType 'deal_product').
//   - No Woo/iCount/calendar/quote/payment/registration side effects: rows are
//     written directly, bypassing the price-lines route entirely.
import crypto from 'node:crypto';
import { htmlToPlain } from './enrichmentImport.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const t = (s) => String(s ?? '').trim();
const minor = (major) => BigInt(Math.round((num(major) || 0) * 100));
const VAT_MODE = { inclusive: 'included', exclusive: 'excluded', none: 'exempt' };

/**
 * Map ONE Pipedrive product line to 1-2 QuoteLine payloads (a discount line is
 * synthesised only when the source carries a real discount, so unit price AND
 * total AND discount are all preserved without recomputation).
 */
export function mapProductLine(l, baseSort) {
  const qty = Math.max(1, Math.round(num(l.quantity) || 1));
  const unit = minor(l.item_price);
  const vatMode = VAT_MODE[t(l.tax_method)] || 'included';
  const vatRate = num(l.tax) && num(l.tax) > 0 ? Math.round(num(l.tax)) : null;
  const note = htmlToPlain(l.comments).slice(0, 2000) || null;
  const main = {
    kind: 'manual', label: t(l.name).slice(0, 300),
    quantity: qty, unitPriceMinor: unit, vatMode, vatRate,
    active: true, note, overridden: true, sourceKind: 'pipedrive_import',
    sortOrder: baseSort,
  };
  const out = [main];
  // Discount: source `sum` is post-discount. If gross (qty×unit) exceeds it,
  // preserve the delta as a discount line so the derived total == source sum.
  const grossMinor = unit * BigInt(qty);
  const sumMinor = minor(l.sum);
  if (num(l.discount) && grossMinor > sumMinor) {
    out.push({
      kind: 'discount', label: 'הנחה',
      quantity: 1, unitPriceMinor: grossMinor - sumMinor, vatMode, vatRate: null,
      active: true, note: `הנחה מקורית: ${num(l.discount)}${t(l.discount_type) === 'amount' ? ' ₪' : '%'}`,
      overridden: true, sourceKind: 'pipedrive_import', sortOrder: baseSort + 1,
    });
  }
  return out;
}

/** Reconciliation class for one deal: A (match) / B (zero-value) / C (differ). */
export function reconcileDeal(lineSumMinor, dealValueMinor) {
  const dv = dealValueMinor == null ? null : BigInt(dealValueMinor);
  if (dv == null || dv === 0n) return 'B';
  const diff = lineSumMinor > dv ? lineSumMinor - dv : dv - lineSumMinor;
  return diff < 100n ? 'A' : 'C'; // within ₪1
}

/**
 * Plan the import for all deals with product lines.
 * @param docs array of { dealId (pipedrive), products:[line] }
 * @param dealByLegacyId Map<pipedriveDealId(string), { id, valueMinor }>
 * @param existingXwalk Set<pipedriveDealId(string)> already imported
 */
export function planBuilderImport(docs, dealByLegacyId, existingXwalk = new Set()) {
  const payloads = [];
  const stats = { docs: docs.length, plan: 0, alreadyImported: 0, noDeal: 0, emptyProducts: 0, lines: 0, discountLines: 0, placeholderLines: 0, htmlNotes: 0, classA: 0, classB: 0, classC: 0 };
  for (const doc of [...docs].sort((a, b) => Number(a.dealId) - Number(b.dealId))) {
    const legacyId = String(doc.dealId);
    const products = Array.isArray(doc.products) ? doc.products : [];
    if (!products.length) { stats.emptyProducts += 1; continue; }
    const gosDeal = dealByLegacyId.get(legacyId);
    if (!gosDeal) { stats.noDeal += 1; continue; }
    if (existingXwalk.has(legacyId)) { stats.alreadyImported += 1; continue; }

    const ordered = [...products].sort((a, b) => (num(a.order_nr) || 0) - (num(b.order_nr) || 0) || (num(a.id) || 0) - (num(b.id) || 0));
    const lines = [];
    let lineSumMinor = 0n;
    ordered.forEach((l, i) => {
      const mapped = mapProductLine(l, i * 2);
      lines.push(...mapped);
      lineSumMinor += minor(l.sum);
      if (!t(l.name)) stats.placeholderLines += 1;
      if (/<[a-z][^>]*>/i.test(String(l.comments || ''))) stats.htmlNotes += 1;
      if (mapped.length > 1) stats.discountLines += 1;
    });
    const recon = reconcileDeal(lineSumMinor, gosDeal.valueMinor);
    stats[`class${recon}`] += 1;
    stats.lines += lines.length;
    stats.plan += 1;
    payloads.push({
      legacyDealId: legacyId, dealId: gosDeal.id, lines,
      reconciliation: { class: recon, dealValueMinor: gosDeal.valueMinor == null ? null : Number(gosDeal.valueMinor), lineSumMinor: Number(lineSumMinor), lineCount: lines.length, sourceLineCount: products.length },
    });
  }
  return { payloads, stats };
}

export async function executeBuilderImport(prisma, plan, { batchId, snapshotId, chunk = 200, log = () => {}, checkpoint = async () => {} } = {}) {
  let written = 0, linesWritten = 0;
  const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
  for (const slice of chunks(plan.payloads, chunk)) {
    for (const pl of slice) {
      await prisma.$transaction(async (tx) => {
        const version = await tx.quoteVersion.create({ data: {
          dealId: pl.dealId, isWorking: false, isSelected: false, status: 'draft', sourceKind: 'pipedrive_import',
        } });
        await tx.quoteLine.createMany({ data: pl.lines.map((l) => ({ ...l, quoteVersionId: version.id })) });
        await tx.legacyRecord.create({ data: {
          sourceSystem: 'pipedrive', sourceType: 'deal_product', sourceId: pl.legacyDealId,
          entityType: 'QuoteVersion', entityId: version.id,
          importBatchId: batchId, snapshotId, cardData: pl.reconciliation,
        } });
      });
      written += 1;
      linesWritten += pl.lines.length;
    }
    await checkpoint({ written, linesWritten });
    log(`  ✓ ${written}/${plan.payloads.length} deals`);
  }
  return { written, linesWritten };
}
