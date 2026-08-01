#!/usr/bin/env node
// Historical collection reconstruction — the CLI.
//
//   node scripts/collection-backfill.mjs --census           # refresh the iCount ledger mirror
//   node scripts/collection-backfill.mjs --plan             # decide, report, write NOTHING
//   node scripts/collection-backfill.mjs --apply            # decide and persist
//   node scripts/collection-backfill.mjs --census --apply   # both, in order
//
//   --priority-first    decide future/recent-tour deals before the rest
//   --resolve-missing   look up references the census never saw, one by one
//   --limit N           cap the number of deals decided (planning aid)
//   --delay-ms N        pacing between iCount requests (default 400)
//   --out FILE          write the full machine-readable report here
//
// All logic lives in src/collectionBackfillRunner.js; this file only parses
// flags, constructs the client and prints. Provider access is READ-ONLY: the
// only iCount endpoints reachable are doc/search and doc/info — no document can
// be created, emailed or modified by this tool.

import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import { census, plan, apply, report, bigintSafe } from '../src/collectionBackfillRunner.js';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const opts = {
  doCensus: has('--census'),
  doApply: has('--apply'),
  limit: Number(val('--limit', 0)) || 0,
  delayMs: Number(val('--delay-ms', 400)),
  out: val('--out', null),
  priorityFirst: has('--priority-first'),
  resolveMissing: has('--resolve-missing'),
};

const prisma = new PrismaClient();

(async () => {
  const started = Date.now();
  const censusResult = opts.doCensus ? await census(prisma, { delayMs: opts.delayMs }) : null;

  const { decisions, individualRequests, individuallyResolved } = await plan(prisma, opts);
  const summary = report(decisions);

  console.log(`\n──────── COLLECTION RECONSTRUCTION ${opts.doApply ? '(APPLY)' : '(PLAN — nothing written)'} ────────`);
  console.log(JSON.stringify({ census: censusResult, individualRequests, individuallyResolved, ...summary }, bigintSafe, 2));

  const applied = opts.doApply ? await apply(prisma, decisions) : null;
  if (!opts.doApply) console.log('\n(plan only — re-run with --apply to persist)');

  if (opts.out) {
    fs.writeFileSync(opts.out, JSON.stringify({ census: censusResult, summary, applied, decisions }, bigintSafe, 2));
    console.log(`report → ${opts.out}`);
  }
  console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
