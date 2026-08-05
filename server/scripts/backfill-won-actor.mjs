// One-time backfill: Deal.wonActor for deals WON BEFORE the transition began
// freezing the closer (2026-08-05).
//
// Evidence source — never a guess: Report #26's frozen delivery payload
// (payload.wonReport = { cause, closedBy }), written at fire time by the
// canonical WON transition since 2026-08-03. A deal with a #26 delivery has a
// PROVEN closer; deals without one (older/migrated) are left NULL and render
// as the explicit "לא ידוע" — never a fabricated ADMIN.
//
// Idempotent and fill-only: touches only WON deals whose wonActor is NULL;
// re-running changes nothing. Run with --apply to write; default is dry-run.
//
//   DATABASE_URL="<prod public url>" node scripts/backfill-won-actor.mjs [--apply]

import { PrismaClient, Prisma } from '@prisma/client';
import { buildWonActor } from '../src/deals/wonActor.js';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

// Json-null filtering: `equals: null` matches NOTHING for Json columns — the
// documented Prisma trap. AnyNull covers both DB NULL and a stored JSON null.
const NO_ACTOR = { equals: Prisma.AnyNull };

const wonDeals = await prisma.deal.findMany({
  where: { status: 'won', wonActor: NO_ACTOR },
  select: { id: true, orderNo: true, wonAt: true },
});
console.log(`WON deals with no frozen actor: ${wonDeals.length}`);

const deliveries = await prisma.adminReportDelivery.findMany({
  where: { reportNumber: 26, dealId: { in: wonDeals.map((d) => d.id) } },
  orderBy: { createdAt: 'asc' },
  select: { dealId: true, payload: true },
});
const evidenceByDeal = new Map();
for (const row of deliveries) {
  // First delivery per deal wins — it is the one the transition itself fired.
  if (!evidenceByDeal.has(row.dealId)) evidenceByDeal.set(row.dealId, row.payload?.wonReport || null);
}

let users = 0;
let systems = 0;
let unproven = 0;
for (const deal of wonDeals) {
  const w = evidenceByDeal.get(deal.id);
  if (!w) { unproven++; continue; }
  const actor = {
    ...buildWonActor({
      user: w.closedBy?.id ? w.closedBy : null,
      cause: w.cause || null,
      at: deal.wonAt,
    }),
    backfilled: true, // honest provenance: recovered from #26 evidence, not frozen live
  };
  actor.type === 'user' ? users++ : systems++;
  console.log(`${APPLY ? 'SET' : 'would set'} deal #${deal.orderNo}: ${actor.type}${actor.userId ? ` ${actor.displayName || actor.username}` : ''} (cause=${actor.cause || '—'})`);
  if (APPLY) {
    // Fill-only guard repeated at write time — a concurrent live transition wins.
    await prisma.deal.updateMany({
      where: { id: deal.id, wonActor: NO_ACTOR },
      data: { wonActor: actor },
    });
  }
}

console.log(`\n${APPLY ? 'Backfilled' : 'Dry-run'}: ${users} user-closed, ${systems} system-closed; ${unproven} remain unproven (render as "לא ידוע")`);
await prisma.$disconnect();
