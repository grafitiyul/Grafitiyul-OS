import { normalizeBuilderVatMode } from '../../../shared/vatMode.mjs';

// One-time, idempotent repair of Deal #26354's Price Builder representation.
//
// THE FACT (owner, 2026-08-01): two tickets, group tour without workshop, total
// ₪300 INCLUDING VAT.
//
// WHAT WAS WRONG. The Pipedrive migration wrote the line as ₪300 VAT-EXCLUSIVE
// on a version whose order-level mode was also 'excluded'. Read back through the
// canonical resolver that is ₪354 gross against a ₪300 Deal.valueMinor — the
// Builder was showing a different total from the one the customer agreed and
// paid.
//
// THE REPAIR, through the canonical VAT architecture and nothing else:
// VAT is an ORDER-level decision stored once on QuoteVersion.vatMode
// (shared/vatMode.mjs). The agreed ₪300 is gross, so the order mode becomes
// 'included' and the line drops its per-line 'excluded' override back to
// 'inherit' — the order governs, which is the whole point of that model.
// The line's amount is NOT touched: ₪300 typed under 'included' IS ₪300 gross.
//
// Deliberately NOT done:
//   • Deal.valueMinor is not written. It is already ₪300 and correct; the bug
//     was the Builder disagreeing with it, not the other way round.
//   • VAT is not hidden or zeroed — net ₪254.24 + VAT ₪45.76 = ₪300.
//   • TicketRegistration is untouched. The deal already holds one confirmed
//     registration for 2 seats (source 'migration'); resyncDealGroupTours
//     ignores migration-sourced rows, so invoking it here would silently do
//     nothing while risking a duplicate seat row.
//   • No issued document is modified.

export const DEAL_ORDER_NO = 26354;

/** Pure: what the version and its lines must become. */
export function plannedVatRepair({ version, lines, dealValueMinor }) {
  if (!version) return { skip: 'no_version' };
  const grossUnder = (mode) =>
    lines.reduce((sum, l) => {
      const lineTotal = Number(l.quantity || 0) * Number(l.unitPriceMinor || 0);
      const effective = l.vatMode && l.vatMode !== 'inherit' ? l.vatMode : mode;
      const rate = l.vatRate != null && Number.isFinite(Number(l.vatRate)) ? Number(l.vatRate) : 18;
      if (effective === 'exempt') return sum + lineTotal;
      if (effective === 'excluded') return sum + Math.round(lineTotal * (1 + rate / 100));
      return sum + lineTotal;
    }, 0);

  const before = grossUnder(normalizeBuilderVatMode(version.vatMode) || 'included');
  // Under 'included' with every line inheriting, the typed amounts ARE the gross.
  const after = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitPriceMinor || 0), 0);
  return {
    versionId: version.id,
    lineIds: lines.filter((l) => l.vatMode && l.vatMode !== 'inherit').map((l) => l.id),
    grossBefore: before,
    grossAfter: after,
    dealValueMinor: Number(dealValueMinor),
    // The repair is only correct if it lands exactly on the agreed total.
    valid: Math.abs(after - Number(dealValueMinor)) <= 10,
  };
}

export async function repairDeal26354Vat(client, { log = console, dryRun = false } = {}) {
  const deal = await client.deal.findFirst({
    where: { orderNo: DEAL_ORDER_NO },
    select: { id: true, orderNo: true, valueMinor: true },
  });
  if (!deal) return { skipped: 'deal_not_found' };

  // The deal's builder version — working if one exists, else the single migrated
  // one. 8,012 migrated WON deals carry a version that was never marked working;
  // repairing this deal means the Builder must actually load what we fixed.
  const versions = await client.quoteVersion.findMany({
    where: { dealId: deal.id },
    include: { lines: { where: { active: true }, orderBy: { sortOrder: 'asc' } } },
    orderBy: [{ isWorking: 'desc' }, { createdAt: 'asc' }],
  });
  const version = versions[0];
  if (!version) return { skipped: 'no_version' };

  const plan = plannedVatRepair({ version, lines: version.lines, dealValueMinor: deal.valueMinor });
  if (!plan.valid) {
    log.warn?.(
      `[repair-26354] refusing: under 'included' the builder would total ${plan.grossAfter} but the deal is ${plan.dealValueMinor}`,
    );
    return { skipped: 'would_not_match_deal_value', plan };
  }

  const alreadyRepaired = version.vatMode === 'included' && version.isWorking && plan.lineIds.length === 0;
  if (alreadyRepaired) return { skipped: 'already_repaired', plan };

  if (dryRun) return { dryRun: true, plan, currentVatMode: version.vatMode, isWorking: version.isWorking };

  await client.$transaction(async (tx) => {
    await tx.quoteVersion.update({
      where: { id: version.id },
      data: { vatMode: 'included', isWorking: true },
    });
    // Drop per-line overrides so the ORDER owns the decision — a line that keeps
    // its own 'excluded' would defeat the order mode and reintroduce the bug.
    if (plan.lineIds.length) {
      await tx.quoteLine.updateMany({ where: { id: { in: plan.lineIds } }, data: { vatMode: 'inherit' } });
    }
  });

  log.log?.(
    `[repair-26354] builder gross ${plan.grossBefore / 100} → ${plan.grossAfter / 100} ` +
    `(deal value ${plan.dealValueMinor / 100}); order vatMode → included, ${plan.lineIds.length} line override(s) → inherit`,
  );
  return { repaired: true, plan };
}
