import { computeCollection } from '../collection.js';
import { loadVatDefault, seedWorkingFromFrozen } from '../quote/importedBuilderSeed.js';

// Editable Builder for migrated WON deals that still owe money — regardless of
// tour date.
//
// THE BUSINESS RULE (owner, 2026-08-02): a frozen imported Builder may stay
// locked while the deal is FULLY PAID — it is closed commercial history. But a
// migrated WON deal with a known agreed amount whose canonical Collection state
// says money is still outstanding must have an editable working Builder,
// whether its tour is in the future, today, or already done. The activity date
// is irrelevant once money is still owed.
//
// THE DEFECT THIS RETIRES: Builder editability was never actually a rule — the
// one-off repair-deal-tour-context.mjs (GAP 2, 2026-08-01) seeded working
// versions for the population it walked, which was "future live tours" only.
// Deals whose tour had already passed were simply never visited, so identical
// unpaid deals ended up editable or locked depending on their tour date at the
// moment the script happened to run.
//
// WHAT THIS RUNNER DOES: applies the SAME seeding mechanism (shared module
// src/quote/importedBuilderSeed.js — copy the frozen evidence verbatim into a
// working version, VAT interpretation chosen by proof against Deal.valueMinor)
// to every WON deal with frozen imported evidence, a locked Builder, and an
// outstanding balance per the CANONICAL resolver (collection.js — never a
// second payment computation). Re-runs on every boot, so a deal that becomes
// unpaid later (e.g. a refund) unlocks too.
//
// WHAT IT NEVER DOES:
//   * touch a fully paid deal — 'paid'/'overpaid' stay exactly as they are;
//   * touch the frozen imported version (it stays isWorking=false, unmodified,
//     visible in history);
//   * overwrite a working version that has lines (operator work always wins;
//     re-checked inside the seeding transaction);
//   * fabricate commercial state — no agreed amount (valueMinor<=0), no frozen
//     evidence, or no VAT interpretation that reproduces the agreed total →
//     the deal is left alone and reported;
//   * write Deal fields, TourEvents, registrations, timeline rows or
//     lastMeaningfulActivityAt — plain quote rows only;
//   * decide anything from a tour date. There is deliberately no date term.
//   * seed deals under collection REVIEW ('review' status) — their payment
//     state is disputed, which is an operator question, not a machine unlock.

export async function unlockUnpaidMigratedBuilders(client, { log = console, dryRun = false } = {}) {
  // Population: WON, priced, has frozen imported evidence, Builder locked
  // (no working version, or a working version with zero lines).
  const deals = await client.deal.findMany({
    where: {
      status: 'won',
      valueMinor: { gt: 0 },
      quoteVersions: {
        some: {
          isWorking: false,
          sourceKind: { in: ['pipedrive_import', 'historical_fallback'] },
          lines: { some: { active: true } },
        },
      },
      NOT: { quoteVersions: { some: { isWorking: true, lines: { some: {} } } } },
    },
    select: { id: true, orderNo: true, valueMinor: true, currency: true, collectionReview: true },
  });

  const stats = { scanned: deals.length, seeded: 0, paidLocked: 0, review: 0, ambiguous: 0, noEvidence: 0, raced: 0 };
  if (!deals.length) {
    log.log?.('[unlock-unpaid-builders] nothing locked — population empty');
    return stats;
  }

  // Payment state exactly as the collection service reads it — same two bulk
  // queries, canonical computeCollection, never a reimplementation.
  const ids = deals.map((d) => d.id);
  const [documents, evidence] = await Promise.all([
    client.icountDocument.findMany({ where: { status: 'issued', dealId: { in: ids } } }),
    client.dealCollectionEvidence.findMany({ where: { status: 'active', dealId: { in: ids } } }),
  ]);
  const docsBy = new Map();
  for (const d of documents) {
    if (!docsBy.has(d.dealId)) docsBy.set(d.dealId, []);
    docsBy.get(d.dealId).push(d);
  }
  const evBy = new Map();
  for (const e of evidence) {
    if (!evBy.has(e.dealId)) evBy.set(e.dealId, []);
    evBy.get(e.dealId).push(e);
  }

  const vatDefault = await loadVatDefault(client);
  const seededOrderNos = [];
  const ambiguousOrderNos = [];

  for (const deal of deals) {
    const summary = computeCollection(deal, docsBy.get(deal.id) || [], evBy.get(deal.id) || []);
    if (summary.status === 'review') {
      stats.review += 1;
      continue;
    }
    if (summary.status !== 'unpaid' && summary.status !== 'partial') {
      // paid / overpaid / no_amount → correctly locked historical record.
      stats.paidLocked += 1;
      continue;
    }
    const result = await seedWorkingFromFrozen(client, deal, {
      vatDefault,
      execute: !dryRun,
      auditContext: { rule: 'unpaid_migrated_unlock', collectionStatus: summary.status, balanceMinor: summary.balanceMinor },
    });
    if (result.outcome === 'seeded' || result.outcome === 'would_seed') {
      stats.seeded += 1;
      seededOrderNos.push(deal.orderNo);
    } else if (result.outcome === 'ambiguous') {
      stats.ambiguous += 1;
      ambiguousOrderNos.push(deal.orderNo);
    } else if (result.outcome === 'no_evidence') {
      stats.noEvidence += 1;
    } else {
      stats.raced += 1; // became editable between the scan and the seed — fine
    }
  }

  log.log?.(
    `[unlock-unpaid-builders] ${stats.scanned} locked migrated deals scanned — ` +
    `${stats.seeded} ${dryRun ? 'would be ' : ''}unlocked (outstanding balance)` +
    `${seededOrderNos.length ? ` [${seededOrderNos.map((n) => `#${n}`).join(', ')}]` : ''}, ` +
    `${stats.paidLocked} fully paid stay locked, ${stats.review} under collection review, ` +
    `${stats.ambiguous} VAT-ambiguous → operator` +
    `${ambiguousOrderNos.length ? ` [${ambiguousOrderNos.map((n) => `#${n}`).join(', ')}]` : ''}, ` +
    `${stats.noEvidence} without usable evidence`,
  );
  return { ...stats, seededOrderNos, ambiguousOrderNos };
}
