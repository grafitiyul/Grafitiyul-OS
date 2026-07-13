// Read-only production diagnostic for the operational-product ("workshop shown
// for a plain-only tour") bug. Prints the full end-to-end trace (checklist items
// 1–11) for every group_slot tour that DISPLAYS workshop but has NO active
// workshop-capable registration, plus any specific tour id passed as an arg.
//
// Run against production (nothing is written):
//   railway run node server/scripts/diagnose-tour-product.mjs [tourEventId]
// or set DATABASE_URL to the prod URL and run the same command.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const CAPACITY = ['active', 'held', 'confirmed'];
const only = process.argv[2] || null;

function variantIsWorkshop(v) {
  return (v?.activityComponents || []).some((c) => c.activityComponent?.isWorkshop);
}

const TOUR_SELECT = {
  id: true, date: true, startTime: true, status: true,
  productId: true, productVariantId: true, productManualOverride: true, openTourTemplateId: true,
  product: { select: { nameHe: true } },
  productVariant: { select: { id: true, product: { select: { nameHe: true } } } },
  activityComponents: { select: { activityComponentId: true, activityComponent: { select: { nameHe: true, isWorkshop: true } } } },
  ticketRegistrations: {
    select: {
      id: true, status: true, quantity: true, source: true, productVariantId: true, cardGroupId: true, priceRuleId: true,
      productVariant: { select: { id: true, activityComponents: { select: { activityComponent: { select: { nameHe: true, isWorkshop: true } } } } } },
    },
  },
};

async function reportTour(t) {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`(1) TourEvent ${t.id} | ${t.date} ${t.startTime} | status=${t.status}`);
  console.log(`    productId=${t.productId} product.nameHe=${JSON.stringify(t.product?.nameHe)} productVariantId=${t.productVariantId}`);
  console.log(`(2) productManualOverride=${t.productManualOverride}`);
  console.log(`(3)/(4) registrations:`);
  let anyActiveWorkshop = false;
  const staleIncluded = [];
  for (const r of t.ticketRegistrations) {
    const ws = variantIsWorkshop(r.productVariant);
    const counts = CAPACITY.includes(r.status);
    if (counts && ws) anyActiveWorkshop = true;
    if (!counts && ws) staleIncluded.push(r.id);
    console.log(`      - ${r.id} status=${r.status} counts=${counts} qty=${r.quantity} src=${r.source} variant=${r.productVariantId || 'NULL'} card=${r.cardGroupId || '-'} variantIsWorkshop=${ws}`);
  }
  console.log(`(4) inactive workshop-capable registrations still present (should NOT affect derivation): ${staleIncluded.length ? staleIncluded.join(', ') : 'none'}`);

  // (5)(6)(7) offered products + base
  const offered = t.openTourTemplateId
    ? await prisma.openTourTemplateProduct.findMany({
        where: { templateId: t.openTourTemplateId },
        orderBy: { sortOrder: 'asc' },
        select: { productVariantId: true, isDefault: true, productVariant: { select: { product: { select: { nameHe: true } }, activityComponents: { select: { activityComponent: { select: { nameHe: true, isWorkshop: true } } } } } } },
      })
    : [];
  console.log(`(5) OpenTourTemplate ${t.openTourTemplateId} offered products:`);
  for (const o of offered) {
    const ws = variantIsWorkshop(o.productVariant);
    console.log(`      - variant=${o.productVariantId} product=${JSON.stringify(o.productVariant?.product?.nameHe)} isDefault=${o.isDefault} hasWorkshop=${ws} comps=[${(o.productVariant?.activityComponents || []).map((c) => `${c.activityComponent?.nameHe}${c.activityComponent?.isWorkshop ? '(WS)' : ''}`).join(', ')}]`);
  }
  const plain = offered.filter((o) => !variantIsWorkshop(o.productVariant));
  const basePool = plain.length ? plain : offered;
  const base = basePool.find((o) => o.isDefault) || basePool[0];
  console.log(`(6) resolved PLAIN base variant = ${base?.productVariantId || '(none)'} (${plain.length ? 'a no-workshop offered product' : 'fallback: all offered are workshop'})`);
  console.log(`(7) current tour activity components: [${t.activityComponents.map((c) => `${c.activityComponent?.nameHe}${c.activityComponent?.isWorkshop ? '(WS)' : ''}`).join(', ') || 'none'}]`);

  // (8) what derivation WOULD produce now
  const activeVariantIds = [...new Set(t.ticketRegistrations.filter((r) => CAPACITY.includes(r.status) && r.productVariantId).map((r) => r.productVariantId))];
  const usedIds = activeVariantIds.length ? activeVariantIds : (base ? [base.productVariantId] : []);
  console.log(`(8) derivation inputs (active variant ids or base): [${usedIds.join(', ') || 'NONE'}]`);
  console.log(`    → operational product SHOULD be ${anyActiveWorkshop ? 'WORKSHOP' : 'PLAIN'} (any active workshop-capable registration = ${anyActiveWorkshop})`);
  console.log(`(9) persisted product fields right now: productId=${t.productId} variantId=${t.productVariantId}`);
  const persistedShowsWorkshop = /סדנ/.test(t.product?.nameHe || '') || t.activityComponents.some((c) => c.activityComponent?.isWorkshop);
  console.log(`(10) Tours DTO shows product.nameHe = ${JSON.stringify(t.product?.nameHe)} (+ component chips). persistedShowsWorkshop=${persistedShowsWorkshop}`);
  console.log(`(11) Google Calendar title derives from tour.product/productVariant (same persisted fields) — so it matches whatever (9) holds.`);
  const verdict = persistedShowsWorkshop && !anyActiveWorkshop ? 'STALE PERSISTED PRODUCT (recompute never re-ran, or a pin blocks it)' : persistedShowsWorkshop && anyActiveWorkshop ? 'correctly workshop (a workshop registration counts)' : 'plain (OK)';
  console.log(`>>> VERDICT: ${verdict}`);
}

if (only) {
  const t = await prisma.tourEvent.findUnique({ where: { id: only }, select: TOUR_SELECT });
  if (!t) console.log(`Tour ${only} not found`);
  else await reportTour(t);
} else {
  const tours = await prisma.tourEvent.findMany({ where: { kind: 'group_slot' }, select: TOUR_SELECT, orderBy: { date: 'desc' }, take: 1000 });
  const flagged = tours.filter((t) => {
    const persistedShowsWorkshop = /סדנ/.test(t.product?.nameHe || '') || t.activityComponents.some((c) => c.activityComponent?.isWorkshop);
    const anyActiveWorkshop = t.ticketRegistrations.some((r) => CAPACITY.includes(r.status) && variantIsWorkshop(r.productVariant));
    const hasActive = t.ticketRegistrations.some((r) => CAPACITY.includes(r.status));
    return persistedShowsWorkshop && !anyActiveWorkshop && hasActive;
  });
  console.log(`Scanned ${tours.length} group_slot tours; ${flagged.length} show workshop with NO active workshop registration.`);
  for (const t of flagged.slice(0, 20)) await reportTour(t);
  if (flagged.length) {
    console.log(`\nTo heal these safely: POST /api/open-tours/reconcile-products (admin), or run reconcile-tour-products.mjs.`);
  }
}
await prisma.$disconnect();
