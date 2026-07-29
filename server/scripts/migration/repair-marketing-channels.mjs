// Recompute DealMarketing.channel through the shared resolver.
//
// The legacy free-text source field carries values like "וואטספ - 113" — the
// label with its closed-list option id appended. Before the resolver learned to
// strip that suffix, those reached `channel` verbatim, fragmenting analytics
// and showing an operator an internal id.
//
// Read-only by default. Recomputes ONLY `channel`; no other field is touched.
//   railway run --service Grafitiyul-OS node server/scripts/migration/repair-marketing-channels.mjs [--execute]
import { PrismaClient } from '@prisma/client';
import { resolveChannel } from '../../src/deals/marketing.js';

const EXECUTE = process.argv.includes('--execute');
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const fmt = (n) => n.toLocaleString('en-US');

const rows = await prisma.dealMarketing.findMany({
  select: { dealId: true, channel: true, leadSource: true, leadSourceText: true, utmSource: true, utmMedium: true, originalIngressSource: true },
});

const changes = [];
for (const r of rows) {
  const next = resolveChannel({
    leadSource: r.leadSource, leadSourceText: r.leadSourceText,
    utmSource: r.utmSource, utmMedium: r.utmMedium,
    ingressSource: String(r.originalIngressSource || '').startsWith('pipedrive') ? null : r.originalIngressSource,
  });
  if (next !== r.channel) changes.push({ dealId: r.dealId, from: r.channel, to: next });
}

const byPair = new Map();
for (const c of changes) {
  const k = `${c.from} → ${c.to}`;
  byPair.set(k, (byPair.get(k) || 0) + 1);
}
console.log(`examined: ${fmt(rows.length)}   would change: ${fmt(changes.length)}\n`);
for (const [k, n] of [...byPair.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`  ${String(n).padStart(6)}  ${k}`);
}

if (!EXECUTE) { console.log('\nDRY RUN — nothing written.'); await prisma.$disconnect(); process.exit(0); }

let done = 0;
for (const c of changes) {
  await prisma.dealMarketing.update({ where: { dealId: c.dealId }, data: { channel: c.to } });
  if (++done % 500 === 0) console.log(`  … ${fmt(done)} / ${fmt(changes.length)}`);
}
console.log(`\nupdated: ${fmt(done)}`);
await prisma.$disconnect();
