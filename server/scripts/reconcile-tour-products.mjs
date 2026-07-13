// Safe one-time reconciliation of stale operational products on already-
// materialized open-tour slots. Recomputes each scheduled group_slot from
// CURRENT canonical registrations (full recomputation — stale workshop state is
// cleared). Idempotent; only tours whose derived product differs are written.
//
//   railway run node server/scripts/reconcile-tour-products.mjs [--force]
//
// --force also recomputes manually-pinned tours (clearing the pin). Without it,
// a VALID pin (pinned variant still offered) is preserved and reported.

import { PrismaClient } from '@prisma/client';
import { reconcileAllOpenTourProducts } from '../src/tours/operationalProduct.js';

const prisma = new PrismaClient();
const force = process.argv.includes('--force');

const summary = await reconcileAllOpenTourProducts(prisma, { force });
console.log('Reconciliation complete:');
console.log(`  scanned:       ${summary.scanned}`);
console.log(`  changed:       ${summary.changed}`);
console.log(`  pins cleared:  ${summary.pinsCleared}`);
console.log(`  pinned kept:   ${summary.pinnedSkipped}${force ? '' : ' (run with --force to recompute these too)'}`);
if (summary.changedIds.length) console.log(`  changed ids:   ${summary.changedIds.join(', ')}`);
await prisma.$disconnect();
