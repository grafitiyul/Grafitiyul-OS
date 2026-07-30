// Controlled backfill for Deal.lastMeaningfulActivityAt.
//
// DERIVATION PRECEDENCE (per deal):
//   1. GREATEST of, where present and NOT IN THE FUTURE (imported future
//      activities exist — "planned" is not "happened"):
//        a. latest TimelineEntry.createdAt (subjectType='deal') — the
//           persisted activity stream: notes, field/stage changes, task
//           lifecycle, files, payments, deliveries, questionnaires, and the
//           213k imported legacy entries carrying their REAL historical
//           Pipedrive timestamps (proven by dry run: monthly distribution
//           back through 2023, only 8 entries in the import window itself).
//        b. wonAt / lostAt — business milestones that may postdate (a).
//   2. Deal.createdAt as a COALESCE FALLBACK ONLY — never a GREATEST
//      participant: all 24,358 deals were IMPORTED at cutover, so their row
//      createdAt is the July-2026 import moment; letting it float would
//      drown every deal's real history in one import week (the first dry
//      run proved exactly that: 24,358/24,358 "active in the last 30 days").
// Deliberately NOT consulted: updatedAt (technical churn — the whole reason
// this field exists), mirror bookkeeping, WhatsApp/email mirrors (read-time
// merged, no persisted per-deal rows).
//
// IDEMPOTENT + NEVER REGRESSES: the UPDATE takes GREATEST(existing, derived),
// so re-running cannot lower a value and cannot overwrite a newer stamp
// written live between runs. One set-based statement — no per-row loop.
//
//   node scripts/deals/backfill-deal-activity.mjs           (dry run)
//   node scripts/deals/backfill-deal-activity.mjs --apply

import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

const before = await prisma.$queryRawUnsafe(`
  select count(*)::int total,
         count(*) filter (where "lastMeaningfulActivityAt" is null)::int nulls
  from "Deal"`);
console.log(`deals: ${before[0].total} (null activity: ${before[0].nulls}) — ${APPLY ? 'APPLY' : 'DRY RUN'}`);

// Preview the derivation distribution before touching anything.
const preview = await prisma.$queryRawUnsafe(`
  with derived as (
    select d.id,
           COALESCE(
             NULLIF(GREATEST(
               COALESCE((select max(t."createdAt") from "TimelineEntry" t
                          where t."subjectType" = 'deal' and t."subjectId" = d.id
                            and t."createdAt" <= now()), '-infinity'::timestamp),
               CASE WHEN d."wonAt"  IS NULL THEN '-infinity'::timestamp ELSE LEAST(d."wonAt",  now()) END,
               CASE WHEN d."lostAt" IS NULL THEN '-infinity'::timestamp ELSE LEAST(d."lostAt", now()) END
             ), '-infinity'::timestamp),
             d."createdAt"
           ) as best
    from "Deal" d
  )
  select
    count(*)::int total,
    count(*) filter (where best > now() - interval '30 days')::int last30d,
    count(*) filter (where best > now() - interval '365 days')::int last365d,
    min(best) as oldest, max(best) as newest
  from derived`);
console.log('derived distribution:', JSON.stringify(preview[0]));

if (!APPLY) {
  console.log('\nDRY RUN — re-run with --apply to write.');
  await prisma.$disconnect();
  process.exit(0);
}

const res = await prisma.$executeRawUnsafe(`
  update "Deal" d
     set "lastMeaningfulActivityAt" = GREATEST(
           COALESCE(d."lastMeaningfulActivityAt", '-infinity'::timestamp),
           COALESCE(
             NULLIF(GREATEST(
               COALESCE((select max(t."createdAt") from "TimelineEntry" t
                          where t."subjectType" = 'deal' and t."subjectId" = d.id
                            and t."createdAt" <= now()), '-infinity'::timestamp),
               CASE WHEN d."wonAt"  IS NULL THEN '-infinity'::timestamp ELSE LEAST(d."wonAt",  now()) END,
               CASE WHEN d."lostAt" IS NULL THEN '-infinity'::timestamp ELSE LEAST(d."lostAt", now()) END
             ), '-infinity'::timestamp),
             d."createdAt"
           )
         )`);
console.log(`updated rows: ${res}`);

const after = await prisma.$queryRawUnsafe(`
  select count(*) filter (where "lastMeaningfulActivityAt" is null)::int nulls,
         max("lastMeaningfulActivityAt") as newest
  from "Deal"`);
console.log('after:', JSON.stringify(after[0]));
console.log(after[0].nulls === 0 ? 'BACKFILL COMPLETE — no nulls remain.' : `WARNING: ${after[0].nulls} nulls remain`);
await prisma.$disconnect();
