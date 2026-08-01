#!/usr/bin/env node
// Second-stage collection matching — CLI.
//
//   node scripts/collection-stage2.mjs --plan            # decide + report, write NOTHING
//   node scripts/collection-stage2.mjs --apply           # decide and persist
//   node scripts/collection-stage2.mjs --plan --out F    # full machine-readable plan
//
// Makes ZERO iCount API calls: everything comes from the local ledger mirror the
// census already built. Idempotent and resumable — every link is keyed by
// dealDocumentKey(), and a review item a human already answered is never
// reopened.

import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import { planStage2, applyStage2 } from '../src/collectionMatcherRunner.js';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const prisma = new PrismaClient();
const bigintSafe = (_k, v) => (typeof v === 'bigint' ? Number(v) : v);

(async () => {
  const started = Date.now();
  const plan = await planStage2(prisma);

  const summary = {
    documentsConsidered: plan.documents.length,
    dealsEligible: plan.eligible,
    tierA: plan.tierA.length,
    sharedDocuments: plan.shared.length,
    sharedDealLinks: plan.shared.reduce((s, x) => s + x.deals.length, 0),
    tierBItems: plan.tierB.length,
    tierBDeals: new Set(plan.tierB.map((b) => b.dealId)).size,
    tierCDocuments: plan.noIdentity,
    tierAByBasis: plan.tierA.reduce((m, c) => ({ ...m, [c.basis]: (m[c.basis] || 0) + 1 }), {}),
  };
  console.log(`\n──────── STAGE-2 MATCHING ${has('--apply') ? '(APPLY)' : '(PLAN — nothing written)'} ────────`);
  console.log(JSON.stringify(summary, bigintSafe, 2));

  const applied = has('--apply') ? await applyStage2(prisma, plan) : null;
  if (!has('--apply')) console.log('\n(plan only — re-run with --apply to persist)');

  const out = val('--out', null);
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ summary, applied, tierA: plan.tierA, shared: plan.shared, tierB: plan.tierB }, bigintSafe, 2));
    console.log(`report → ${out}`);
  }
  console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
