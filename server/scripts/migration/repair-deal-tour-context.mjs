// MIGRATION COMPLETION REPAIR — the two gaps the cutover left on future deals.
//
//   node server/scripts/migration/repair-deal-tour-context.mjs [--execute]
//
// Scope: every FUTURE private/business TourEvent that is still live (scheduled |
// postponed) and carries an ACTIVE booking, plus the Deal behind that booking.
//
// ── GAP 1 — the Deal never received the canonical tour context ───────────────
// Wave-1/cutover imported the TourEvent, and match-tour-products.mjs later
// resolved product/variant/location ON THE TOUR (fill-null-only) so the calendar
// could derive duration and title. Nothing ever wrote that context back to the
// DEAL. pendingTourUpdate() compares deal-vs-tour field by field, so a NULL deal
// product against a resolved tour product reads as "the operator changed the
// deal and has not applied it yet" — the yellow "יש שינויים שעדיין לא הוחלו על
// הסיור" bar, plus one open בקרה issue per deal. It was never a real pending
// change; it was missing context on the deal side.
//
// Repair: copy the tour's own linked context onto the Deal, FILL-NULL-ONLY. A
// deal that already carries a value keeps it — that is a genuine operator
// decision and must keep pending until "עדכון סיור" is pressed.
//
// ── GAP 2 — the commercial evidence never reached the canonical Builder ──────
// builderImport.js deliberately wrote the historical Pipedrive breakdown as a
// FROZEN read-only QuoteVersion (sourceKind='pipedrive_import', isWorking=false)
// and never touched Deal.valueMinor. So the Deal header shows the agreed price
// while the Price Builder — which reads the WORKING version — shows 0.
//
// Repair: seed the WORKING version from that frozen evidence. Amounts, labels,
// quantities, notes and order are copied verbatim. The only thing chosen is the
// VAT INTERPRETATION of those amounts, and it is chosen by proof, not taste: the
// interpretation whose composed gross reproduces the already-agreed
// Deal.valueMinor to the agora. (Pipedrive's `tax_method` was mapped to
// vatMode='excluded' for rows whose amounts were in fact VAT-inclusive — e.g.
// ₪1,947 = ₪1,650 + VAT — so composing them as net would silently inflate every
// total by 18%.) If NO interpretation reproduces the agreed total, the deal is
// left untouched and reported: that is a business decision, not a repair.
//
// INVARIANTS
//   * Deal.valueMinor is NEVER written. The Builder gross is made to equal the
//     already-agreed value; the value is not bent to fit the lines.
//   * The frozen pipedrive_import version is NEVER modified — it stays the
//     immutable imported evidence, still served by /price-lines/historical.
//   * No QuoteDocument (issued or draft) is touched.
//   * No TourEvent is touched. Not one field. The tour is already correct; it is
//     the deal that was incomplete.
//   * Idempotent: preconditions are re-checked INSIDE each transaction, so a
//     re-run — or a concurrent operator edit — can never overwrite live work.
import { PrismaClient } from '@prisma/client';
import { splitVat } from '../../src/pricing/engine.js';

const EXECUTE = process.argv.includes('--execute');
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const TODAY = new Date().toISOString().slice(0, 10);
const SIGN = (k) => (k === 'discount' || k === 'credit' ? -1 : 1);
const ILS = (m) => (m == null ? '—' : (m / 100).toFixed(2));

// Compose exactly as pricing/builderCompose.js does for non-engine lines
// (every imported line is kind 'manual'/'discount', so the engine never prices
// them). `forceMode` tests one VAT interpretation of the same amounts.
function grossOf(lines, vatDefault, forceMode) {
  let gross = 0;
  for (const ln of lines) {
    if (ln.active === false) continue;
    let qty = parseInt(ln.quantity, 10);
    if (!Number.isFinite(qty) || qty < 0) qty = 1;
    const unit = Number(ln.unitPriceMinor) || 0;
    const mode = forceMode || (!ln.vatMode || ln.vatMode === 'inherit' ? vatDefault.mode : ln.vatMode);
    const rate = mode === 'exempt' ? 0 : ln.vatRate != null ? Number(ln.vatRate) : vatDefault.rate;
    gross += splitVat(SIGN(ln.kind) * unit * qty, mode, rate).grossMinor;
  }
  return gross;
}

// The ONE decision rule for gap 2. Returns the interpretation that reproduces
// the agreed total, or null when none does (→ operator review).
export function chooseVatInterpretation(lines, valueMinor, vatDefault) {
  for (const [forceMode, why] of [
    [null, 'as-imported'],
    ['included', 'imported amounts are VAT-inclusive'],
    ['excluded', 'imported amounts are net of VAT'],
  ]) {
    const gross = grossOf(lines, vatDefault, forceMode);
    if (Math.abs(gross - Number(valueMinor)) < 100) return { forceMode, why, gross };
  }
  return null;
}

const audit = async (tx, sourceType, dealId, cardData) =>
  tx.legacyRecord.upsert({
    where: { sourceSystem_sourceType_sourceId: { sourceSystem: 'gos', sourceType, sourceId: dealId } },
    create: { sourceSystem: 'gos', sourceType, sourceId: dealId, entityType: 'Deal', entityId: dealId, cardData },
    update: { cardData },
  });

const priceList = await prisma.priceList.findFirst({
  where: { isDefault: true },
  select: { defaultVatMode: true, defaultVatRate: true },
});
const vatDefault = {
  mode: priceList?.defaultVatMode || 'included',
  rate: priceList?.defaultVatRate != null ? priceList.defaultVatRate : 18,
};

const tours = await prisma.tourEvent.findMany({
  where: {
    kind: { in: ['private', 'business'] },
    date: { gte: TODAY },
    status: { in: ['scheduled', 'postponed'] },
    supersededByTourEventId: null,
  },
  select: {
    id: true, date: true, startTime: true, kind: true,
    productId: true, productVariantId: true, locationId: true,
    product: { select: { id: true, nameHe: true, active: true } },
    productVariant: {
      select: {
        id: true, productId: true, locationId: true,
        location: { select: { id: true, nameHe: true } },
      },
    },
    bookings: { where: { status: 'active' }, select: { id: true, dealId: true, seats: true } },
  },
  orderBy: [{ date: 'asc' }],
});

console.log(`${EXECUTE ? 'EXECUTE' : 'DRY RUN'} · today ${TODAY} · VAT default ${vatDefault.mode}/${vatDefault.rate}%`);
console.log(`future live private/business tours: ${tours.length}`);

const ctx = { repaired: [], already: [], blocked: [] };
const com = { repaired: [], already: [], ambiguous: [], noEvidence: [] };

for (const tour of tours) {
  for (const booking of tour.bookings) {
    const deal = await prisma.deal.findUnique({
      where: { id: booking.dealId },
      select: {
        id: true, orderNo: true, title: true, status: true,
        productId: true, productVariantId: true, locationId: true, valueMinor: true,
      },
    });
    if (!deal) continue;
    const tag = `#${deal.orderNo}`;

    // ── GAP 1 ────────────────────────────────────────────────────────────────
    const patch = {};
    if (!deal.productId && tour.productId) patch.productId = tour.productId;
    if (!deal.productVariantId && tour.productVariantId) patch.productVariantId = tour.productVariantId;
    if (!deal.locationId && (tour.locationId || tour.productVariant?.locationId))
      patch.locationId = tour.locationId || tour.productVariant.locationId;

    const blockers = [];
    // Never propagate a self-inconsistent tour: the variant must belong to the
    // tour's own product, and the product must still be a live catalogue entry.
    if (patch.productVariantId && tour.productVariant?.productId !== tour.productId)
      blockers.push('tour.productVariant belongs to a different product');
    if (patch.productId && tour.product && tour.product.active === false)
      blockers.push('tour product is inactive');
    if ((!deal.productId && !tour.productId) || (!deal.productVariantId && !tour.productVariantId))
      blockers.push('tour carries no product/variant to copy');

    if (blockers.length) {
      ctx.blocked.push({ orderNo: deal.orderNo, title: deal.title, tourId: tour.id, why: blockers.join('; ') });
    } else if (!Object.keys(patch).length) {
      ctx.already.push(deal.orderNo);
    } else {
      const entry = {
        orderNo: deal.orderNo, title: deal.title, date: tour.date,
        fields: Object.keys(patch),
        product: tour.product?.nameHe || null,
        location: tour.productVariant?.location?.nameHe || null,
      };
      if (EXECUTE) {
        await prisma.$transaction(async (tx) => {
          // Re-read inside the tx: only still-NULL fields are written, so a
          // concurrent operator edit always wins over this backfill.
          const live = await tx.deal.findUnique({
            where: { id: deal.id },
            select: { productId: true, productVariantId: true, locationId: true },
          });
          const safe = {};
          for (const [k, v] of Object.entries(patch)) if (!live[k]) safe[k] = v;
          if (!Object.keys(safe).length) return;
          await tx.deal.update({ where: { id: deal.id }, data: safe });
          await audit(tx, 'deal_context_backfill', deal.id, {
            source: 'tour_event', tourEventId: tour.id, applied: safe, at: new Date().toISOString(),
          });
        });
      }
      ctx.repaired.push(entry);
    }

    // ── GAP 2 ────────────────────────────────────────────────────────────────
    const value = deal.valueMinor == null ? 0 : Number(deal.valueMinor);
    const working = await prisma.quoteVersion.findFirst({
      where: { dealId: deal.id, isWorking: true },
      select: { id: true, _count: { select: { lines: true } } },
    });
    if (value <= 0 || (working && working._count.lines > 0)) {
      com.already.push(deal.orderNo);
      continue;
    }
    const frozen = await prisma.quoteVersion.findFirst({
      where: { dealId: deal.id, sourceKind: 'pipedrive_import' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, lines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!frozen || !frozen.lines.length) {
      com.noEvidence.push({ orderNo: deal.orderNo, title: deal.title, valueMinor: value });
      continue;
    }
    const choice = chooseVatInterpretation(frozen.lines, value, vatDefault);
    if (!choice) {
      com.ambiguous.push({
        orderNo: deal.orderNo, title: deal.title, date: tour.date, valueMinor: value,
        candidates: {
          asImported: grossOf(frozen.lines, vatDefault, null),
          asGross: grossOf(frozen.lines, vatDefault, 'included'),
          asNet: grossOf(frozen.lines, vatDefault, 'excluded'),
        },
        lines: frozen.lines.map((l) => `${l.label || '(ללא שם)'} ×${l.quantity} @ ${ILS(Number(l.unitPriceMinor))} [${l.vatMode}]`),
      });
      continue;
    }
    const entry = {
      orderNo: deal.orderNo, title: deal.title, date: tour.date,
      valueMinor: value, gross: choice.gross, interpretation: choice.why, lines: frozen.lines.length,
    };
    if (EXECUTE) {
      await prisma.$transaction(async (tx) => {
        // Re-check inside the tx — never overwrite a builder someone just filled.
        let target = await tx.quoteVersion.findFirst({
          where: { dealId: deal.id, isWorking: true },
          select: { id: true, _count: { select: { lines: true } } },
        });
        if (target && target._count.lines > 0) return;
        if (!target) {
          target = await tx.quoteVersion.create({
            data: { dealId: deal.id, isWorking: true, status: 'draft' },
            select: { id: true, _count: { select: { lines: true } } },
          });
        }
        await tx.quoteLine.createMany({
          data: frozen.lines.map((l, i) => ({
            quoteVersionId: target.id,
            kind: l.kind,
            label: l.label,
            quantity: l.quantity,
            unitPriceMinor: l.unitPriceMinor,
            // The ONE reinterpreted field — see the header. Amounts are verbatim.
            vatMode: choice.forceMode || l.vatMode,
            vatRate: l.vatRate,
            active: l.active,
            note: l.note,
            // Frozen price: the engine must never reprice these from the cards.
            overridden: true,
            sourceKind: 'pipedrive_import',
            sortOrder: i,
          })),
        });
        await audit(tx, 'deal_builder_backfill', deal.id, {
          source: 'frozen_quote_version', frozenVersionId: frozen.id, workingVersionId: target.id,
          interpretation: choice.why, vatMode: choice.forceMode, grossMinor: choice.gross,
          dealValueMinor: value, lines: frozen.lines.length, at: new Date().toISOString(),
        });
      });
    }
    com.repaired.push(entry);
  }
}

const list = (a) => a.map((x) => `#${x.orderNo}`).join(', ');
console.log('\n══ GAP 1 — Deal tour context ══');
console.log(`  backfilled     : ${ctx.repaired.length}  ${list(ctx.repaired)}`);
console.log(`  already correct: ${ctx.already.length}`);
console.log(`  blocked        : ${ctx.blocked.length}`);
for (const b of ctx.blocked) console.log(`     #${b.orderNo} ${b.title} — ${b.why}`);

console.log('\n══ GAP 2 — Builder commercial state ══');
console.log(`  seeded from frozen evidence: ${com.repaired.length}`);
for (const r of com.repaired) console.log(`     #${r.orderNo} ${r.date} — ₪${ILS(r.gross)} (${r.interpretation}, ${r.lines} lines)`);
console.log(`  already meaningful / no value: ${com.already.length}`);
console.log(`  NO frozen evidence          : ${com.noEvidence.length} ${list(com.noEvidence)}`);
console.log(`  AMBIGUOUS → operator review : ${com.ambiguous.length}`);
for (const a of com.ambiguous) {
  console.log(`     #${a.orderNo} ${a.date} ${a.title}`);
  console.log(`        deal value ₪${ILS(a.valueMinor)} · as-imported ₪${ILS(a.candidates.asImported)} · as-gross ₪${ILS(a.candidates.asGross)} · as-net ₪${ILS(a.candidates.asNet)}`);
  for (const l of a.lines) console.log(`        · ${l}`);
}
console.log(`\n${EXECUTE ? 'APPLIED' : 'NOTHING WRITTEN (dry run — pass --execute)'}`);
await prisma.$disconnect();
