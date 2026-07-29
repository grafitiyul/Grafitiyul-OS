// MARKETING BACKFILL runner — populates the canonical DealMarketing record for
// every already-imported Pipedrive deal.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/run-marketing-import.mjs --snapshot <id> [--execute]
//
// SAFETY:
//   * Default is DRY-RUN: full plan + statistics, zero writes.
//   * Additive and idempotent — writes go through the ONE canonical write path
//     (src/deals/marketing.js), so re-running plans no changes and first-touch
//     immutability is enforced by the same code the ingress platform uses.
//   * Reads R2 + Postgres only. No Pipedrive or Airtable calls.
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';
import { requireEntities } from '../../src/migration/snapshotContract.js';
import { writeDealMarketing } from '../../src/deals/marketing.js';
import { buildLeadSourceOptions, planMarketingImport } from '../../src/migration/import/marketingImport.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const snapshotId = arg('--snapshot');
const EXECUTE = process.argv.includes('--execute');
if (!snapshotId) { console.error('usage: --snapshot <id> [--execute]'); process.exit(1); }

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId });
const fmt = (n) => n.toLocaleString('en-US');

async function main() {
  // Declare the snapshot input up front, like every other importer: a scoped
  // snapshot missing a required entity fails here with a remedy, never later as
  // a raw NoSuchKey and never as a silent zero.
  const present = await requireEntities({ getText: r2.getObjectText }, snapshotId, [
    'pipedrive/reference',
    'pipedrive/deals',
  ]);
  console.log(`snapshot contract satisfied (${present.length} entities present)`);

  // Option labels come from the snapshot's own field definitions, never hardcoded.
  const refMan = await reader.entityManifest('pipedrive/reference');
  const reference = JSON.parse(await r2.getObjectText(refMan.shards[0].key));
  const optionLabels = buildLeadSourceOptions(reference.dealFields || []);
  console.log(`lead-source options resolved: ${optionLabels.size}`);

  // The deal crosswalk: Pipedrive id → GOS deal id.
  const xwalkRows = await prisma.legacyRecord.findMany({
    where: { sourceSystem: 'pipedrive', sourceType: 'deal', entityType: 'Deal', entityId: { not: null } },
    select: { sourceId: true, entityId: true },
  });
  const dealIdByPipedriveId = new Map(xwalkRows.map((r) => [String(r.sourceId), r.entityId]));
  console.log(`deal crosswalk: ${fmt(dealIdByPipedriveId.size)}`);

  // Stream the deals shards and plan shard by shard (never the whole entity in memory).
  const dealsMan = await reader.entityManifest('pipedrive/deals');
  const allRows = [];
  const total = { dealsSeen: 0, mapped: 0, skippedNoCrosswalk: 0, skippedNothingToWrite: 0, withLeadSource: 0, withCampaign: 0, unresolvedOptions: 0 };
  for (const s of dealsMan.shards || []) {
    const deals = await reader.readShard(s.key);
    const { rows, stats } = planMarketingImport({ deals, dealIdByPipedriveId, optionLabels });
    allRows.push(...rows);
    for (const k of Object.keys(total)) total[k] += stats[k];
    reader._shardCache.clear();
  }

  console.log('\nPLAN');
  console.log(`  deals seen            : ${fmt(total.dealsSeen)}`);
  console.log(`  → marketing rows      : ${fmt(total.mapped)}`);
  console.log(`  with lead source      : ${fmt(total.withLeadSource)}`);
  console.log(`  with campaign         : ${fmt(total.withCampaign)}`);
  console.log(`  skipped (no crosswalk): ${fmt(total.skippedNoCrosswalk)}`);
  console.log(`  skipped (nothing)     : ${fmt(total.skippedNothingToWrite)}`);
  console.log(`  unresolved options    : ${fmt(total.unresolvedOptions)}`);

  if (!EXECUTE) {
    console.log('\nDRY RUN — nothing written. add --execute to write.');
    return;
  }

  console.log('\nEXECUTE …');
  let created = 0, updated = 0, unchanged = 0, conflicts = 0, done = 0;
  for (const row of allRows) {
    const res = await writeDealMarketing(prisma, row.dealId, row.marketing);
    if (res.created) created++;
    else if (res.changed) updated++;
    else unchanged++;
    if (res.firstTouchConflict) conflicts++;
    if (++done % 2000 === 0) console.log(`  … ${fmt(done)} / ${fmt(allRows.length)}`);
  }

  console.log(`\ncreated  : ${fmt(created)}`);
  console.log(`updated  : ${fmt(updated)}`);
  console.log(`unchanged: ${fmt(unchanged)}`);
  console.log(`first-touch conflicts: ${fmt(conflicts)}`);

  const live = await prisma.dealMarketing.count();
  console.log(`\nDealMarketing rows now: ${fmt(live)}`);
}

main()
  .catch((e) => { console.error('marketing import fatal:', e?.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
