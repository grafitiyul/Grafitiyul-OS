// A locked historical Builder for migrated deals that have NO quote version at
// all.
//
// 8,010 migrated deals carry a frozen Pipedrive version and the Builder now
// shows it read-only. 201 have nothing — the import found a deal and a price but
// no commercial breakdown. 120 of those are priced, and showing an empty Builder
// on a deal with a known agreed amount is exactly what the owner ruled
// unacceptable.
//
// So: ONE aggregated line carrying the agreed total, created as a FROZEN version
// (isWorking=false, sourceKind='historical_fallback'). The Builder's read-only
// historical mode picks it up like any other imported version — same code path,
// same banner, same refusal to save. It is the commercial record of what was
// agreed, not a quote to re-price.
//
// WHAT IT IS NOT
//   • not editable, not working, never re-priced from the current catalogue;
//   • not a ticket breakdown — it does not pretend to know the adult/child split
//     that Pipedrive never recorded. The line says so in its own label;
//   • it cannot reach registrations, seats or a completed TourEvent: nothing
//     resyncs from a non-working version, and the dialog has no save path.
//
// Deals with valueMinor = 0 are SKIPPED. There is no agreed amount to record,
// and inventing a zero line would be a fake commercial record.

export const FALLBACK_SOURCE_KIND = 'historical_fallback';
export const FALLBACK_LABEL = 'הזמנה היסטורית שיובאה מפייפדרייב';

export async function buildHistoricalFallbackQuotes(client, { log = console, dryRun = false, limit = 0 } = {}) {
  const targets = await client.$queryRawUnsafe(`
    select d.id, d."orderNo", d."valueMinor"::text val, d.participants, d.title,
           p."nameHe" product_name
      from "Deal" d
      left join "Product" p on p.id = d."productId"
     where d.status = 'won'
       and d."valueMinor" > 0
       and not exists (select 1 from "QuoteVersion" v where v."dealId" = d.id)`);

  if (dryRun || !targets.length) {
    log.log?.(`[historical-fallback] ${targets.length} priced deals with no quote version${dryRun ? ' (dry run)' : ''}`);
    return { candidates: targets.length, created: 0, sample: targets.slice(0, 8).map((t) => ({ orderNo: t.orderNo, value: Number(t.val), product: t.product_name })) };
  }

  const batch = limit ? targets.slice(0, limit) : targets;
  let created = 0;
  for (const t of batch) {
    // Idempotent: a fallback already built is never duplicated.
    const existing = await client.quoteVersion.findFirst({
      where: { dealId: t.id, sourceKind: FALLBACK_SOURCE_KIND },
      select: { id: true },
    });
    if (existing) continue;

    const qty = Number(t.participants) > 0 ? Number(t.participants) : 1;
    const total = BigInt(t.val);
    // The agreed total is GROSS — that is what Deal.valueMinor means everywhere
    // in this system — so the version is 'included' and the single line carries
    // the whole amount. Quantity stays 1: splitting the total by participants
    // would invent a per-head price nobody agreed.
    await client.$transaction(async (tx) => {
      const version = await tx.quoteVersion.create({
        data: {
          dealId: t.id,
          isWorking: false,
          status: 'draft',
          sourceKind: FALLBACK_SOURCE_KIND,
          vatMode: 'included',
        },
      });
      await tx.quoteLine.create({
        data: {
          quoteVersionId: version.id,
          kind: 'manual',
          sourceKind: FALLBACK_SOURCE_KIND,
          label: [FALLBACK_LABEL, t.product_name || null, qty > 1 ? `${qty} משתתפים` : null]
            .filter(Boolean)
            .join(' · '),
          quantity: 1,
          unitPriceMinor: total,
          vatMode: 'inherit',
          active: true,
          sortOrder: 0,
          overridden: true,
          note:
            'סכום העסקה כפי שסוכם ויובא מהמערכת הקודמת. פייפדרייב לא שמר פירוט כרטיסים, ולכן זו שורה מסכמת אחת — ' +
            'רשומה היסטורית לצפייה בלבד, שאינה ניתנת לעריכה ואינה מתמחרת מחדש לפי המחירון הנוכחי.',
        },
      });
    });
    created += 1;
  }
  log.log?.(`[historical-fallback] created ${created} locked historical builders (of ${targets.length} priced deals with no version)`);
  return { candidates: targets.length, created };
}
