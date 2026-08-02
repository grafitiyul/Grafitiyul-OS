// Deterministic VAT-mode repair of IMPORTED (frozen) quote versions.
//
// THE DEFECT. The Pipedrive migration wrote many versions with
// vatMode='excluded' while the amount it stored was the agreed GROSS. Read back
// through the canonical resolver those versions total amount × 1.18 — so the
// Builder shows a number the customer never agreed to and that disagrees with
// Deal.valueMinor. #26354 was one instance; there are 1,179.
//
// THE TEST, and the only one accepted. A version qualifies when its line sum
// ALREADY EQUALS Deal.valueMinor while its mode claims the amounts are net.
// That equality is the proof: if the stored numbers were really net, the deal
// total would be 18% higher. Switching the mode to 'included' makes the Builder
// read exactly the agreed total — it does not change a single amount.
//
// This never runs on a version whose arithmetic already works ('excluded' with
// gross = sum × 1.18 is a correct representation and is left alone — the owner
// was explicit that a precise ×1.18 relationship is not a defect), and never on
// a working version: live quotes belong to their operator.
//
// Per-line 'excluded' overrides are cleared to 'inherit' so the order-level mode
// actually governs, which is the canonical VAT model (shared/vatMode.mjs).

const TOLERANCE_MINOR = 10;

/** Pure: does this version qualify, and what will it total afterwards? */
export function qualifies({ vatMode, lineSumMinor, dealValueMinor }) {
  if (vatMode !== 'excluded') return false;
  const val = Number(dealValueMinor);
  if (!(val > 0)) return false;
  const sum = Number(lineSumMinor);
  if (!(sum > 0)) return false;
  // Already-correct 'excluded' (gross = sum × 1.18) must be left alone.
  if (Math.abs(Math.round(sum * 1.18) - val) <= 100) return false;
  // The stored amounts ARE the gross.
  return Math.abs(sum - val) <= TOLERANCE_MINOR;
}

export async function repairImportedVatMode(client, { log = console, dryRun = false, limit = 0 } = {}) {
  const rows = await client.$queryRawUnsafe(`
    select v.id, v."dealId", d."orderNo", d."valueMinor"::text val,
           (select coalesce(sum(l."unitPriceMinor" * l.quantity), 0)
              from "QuoteLine" l where l."quoteVersionId" = v.id and l.active)::text ls
      from "QuoteVersion" v
      join "Deal" d on d.id = v."dealId"
     where v."isWorking" = false
       and v."vatMode" = 'excluded'
       and d."valueMinor" > 0
       and exists (select 1 from "QuoteLine" l where l."quoteVersionId" = v.id and l.active)`);

  const targets = rows.filter((r) =>
    qualifies({ vatMode: 'excluded', lineSumMinor: r.ls, dealValueMinor: r.val }),
  );

  if (dryRun || !targets.length) {
    log.log?.(`[imported-vat] ${rows.length} imported 'excluded' versions · ${targets.length} where the amount is really the gross${dryRun ? ' (dry run)' : ''}`);
    return { scanned: rows.length, qualifying: targets.length, repaired: 0, sample: targets.slice(0, 10).map((t) => ({ orderNo: t.orderNo, sum: Number(t.ls), value: Number(t.val) })) };
  }

  const batch = limit ? targets.slice(0, limit) : targets;
  let repaired = 0;
  const CHUNK = 100;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const slice = batch.slice(i, i + CHUNK);
    const ids = slice.map((t) => t.id);
    await client.$transaction([
      client.quoteVersion.updateMany({ where: { id: { in: ids } }, data: { vatMode: 'included' } }),
      // A line keeping its own 'excluded' override would defeat the order mode
      // and reintroduce the inflated total.
      client.quoteLine.updateMany({
        where: { quoteVersionId: { in: ids }, vatMode: 'excluded' },
        data: { vatMode: 'inherit' },
      }),
    ]);
    repaired += slice.length;
  }
  log.log?.(`[imported-vat] repaired ${repaired} imported versions: order vatMode → included, line overrides → inherit (builder gross now equals Deal.valueMinor)`);
  return { scanned: rows.length, qualifying: targets.length, repaired };
}
