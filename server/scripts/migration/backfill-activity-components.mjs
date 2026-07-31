// One-time completion pass: seed default Activity Components onto tours that
// have NONE — through the SAME canonical seeder used at every tour-creation
// point (seedTourComponents; defaults live on the ProductVariant).
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/backfill-activity-components.mjs [--execute] [--include-past]
//
// RULES (owner, 2026-07-31):
//   * only tours that currently have ZERO components — a manually customised
//     tour (which necessarily has rows) is untouchable;
//   * variant config is the single source of truth; a tour without a resolved
//     variant cannot be seeded and is reported, not guessed;
//   * idempotent: seeding writes with skipDuplicates and only ever fires on
//     zero-component tours, so a rerun is a no-op.
//
// Scope default: FUTURE scheduled tours (the operational set). Historical
// completed tours are records of what actually happened — inventing components
// on them would fabricate history — so they are excluded unless --include-past
// is explicitly passed.
import { PrismaClient } from '@prisma/client';
import { seedTourComponents } from '../../src/tours/tourComponents.js';

const EXECUTE = process.argv.includes('--execute');
const INCLUDE_PAST = process.argv.includes('--include-past');
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });

const today = new Date().toISOString().slice(0, 10);
const tours = await prisma.tourEvent.findMany({
  where: {
    status: { in: INCLUDE_PAST ? ['scheduled', 'completed'] : ['scheduled'] },
    ...(INCLUDE_PAST ? {} : {}),
  },
  select: {
    id: true, date: true, startTime: true, status: true, productVariantId: true,
    _count: { select: { activityComponents: true } },
  },
});
const scoped = tours.filter((t) => (INCLUDE_PAST ? true : String(t.date).slice(0, 10) >= today));

let seeded = 0; let skippedHasComponents = 0; let unresolvedVariant = 0; let variantNoDefaults = 0;
const unresolved = [];
for (const t of scoped) {
  if (t._count.activityComponents > 0) { skippedHasComponents += 1; continue; }
  if (!t.productVariantId) {
    unresolvedVariant += 1;
    unresolved.push({ id: t.id, date: t.date, startTime: t.startTime });
    continue;
  }
  if (!EXECUTE) { seeded += 1; continue; }
  const n = await seedTourComponents(prisma, t.id, t.productVariantId);
  if (n > 0) seeded += 1; else variantNoDefaults += 1;
}

console.log(`scope: ${scoped.length} tour(s) (${INCLUDE_PAST ? 'incl. past' : 'future scheduled only'})`);
console.log(`  seeded from variant defaults : ${seeded}${EXECUTE ? '' : '  [dry — count of zero-component tours with a variant]'}`);
console.log(`  skipped (already have rows)  : ${skippedHasComponents}`);
console.log(`  variant has no defaults      : ${variantNoDefaults}`);
console.log(`  unresolvable (no variant)    : ${unresolvedVariant}`);
for (const u of unresolved.slice(0, 12)) console.log(`    ? ${u.id.slice(0, 8)} ${String(u.date).slice(0, 10)} ${u.startTime ?? ''}`);
if (!EXECUTE) console.log('\n--dry: nothing written.');
await prisma.$disconnect();
