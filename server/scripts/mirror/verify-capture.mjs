// Prove the mirror capture path works end-to-end, before trusting it with a snapshot.
//
//   railway run --service Grafitiyul-OS node server/scripts/mirror/verify-capture.mjs
//
// Sends ONE synthetic webhook, with the real secret, to the real public endpoint,
// and confirms a MirrorEvent was durably persisted. Then DELETES that synthetic
// event again, so the Phase C replay window contains only genuine changes.
//
// The synthetic payload references a deliberately impossible Pipedrive id, so even
// if it were processed it could resolve to no GOS record. Apply is off regardless.
//
// Also reports poller health, because a webhook working says nothing about whether
// the Airtable cursors are actually being polled.
import { PrismaClient } from '@prisma/client';
import { mirrorHealth } from '../../src/mirror/worker.js';
import { mirrorMode } from '../../src/mirror/config.js';

const secret = String(process.env.MIRROR_PIPEDRIVE_WEBHOOK_SECRET || '').trim();
if (!secret) { console.error('MIRROR_PIPEDRIVE_WEBHOOK_SECRET missing'); process.exit(1); }
const ENDPOINT = 'https://app.grafitiyul.co.il/api/mirror/pipedrive';
const SYNTHETIC_ID = '999999999';

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });

const mode = mirrorMode();
console.log(`mirror mode as the RUNNING SERVICE sees it: capture=${mode.capture} apply=${mode.apply}${mode.incoherent ? '  ⚠ INCOHERENT' : ''}`);
if (!mode.capture) console.log('  ⚠ capture is false in THIS process env — if the service was just redeployed, give it a moment');
if (mode.apply) console.log('  ⚠⚠ APPLY IS ON — it should not be at this stage');

// ── 1) POST a synthetic webhook with correct credentials ─────────────────────
const body = {
  meta: { object: 'deal', id: SYNTHETIC_ID, action: 'updated', timestamp: new Date().toISOString() },
  current: { id: SYNTHETIC_ID, title: 'GOS mirror capture test — synthetic, not a real deal' },
};
const auth = Buffer.from(`gos-mirror:${secret}`).toString('base64');
const before = await prisma.mirrorEvent.count();
const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
  body: JSON.stringify(body),
});
const text = await res.text();
const json = (() => { try { return JSON.parse(text); } catch { return null; } })();
console.log(`\nPOST ${ENDPOINT}`);
console.log(`  status ${res.status}`);
console.log(`  body   ${String(text).split(secret).join('***').slice(0, 200)}`);

if (res.status !== 200) {
  console.error('\n⛔ CAPTURE IS NOT WORKING — the endpoint did not accept an authenticated webhook.');
  console.error('   401 → the running service does not have the secret this script used (redeploy not finished?).');
  console.error('   503 → the service has no secret set at all.');
  await prisma.$disconnect();
  process.exit(2);
}

// ── 2) confirm it was PERSISTED, not just acknowledged ───────────────────────
const eventId = json?.eventId || null;
const row = eventId
  ? await prisma.mirrorEvent.findUnique({ where: { id: eventId } })
  : await prisma.mirrorEvent.findFirst({ where: { sourceSystem: 'pipedrive', externalId: SYNTHETIC_ID }, orderBy: { createdAt: 'desc' } });

const after = await prisma.mirrorEvent.count();
if (!row) {
  console.error('\n⛔ the endpoint answered 200 but no MirrorEvent was persisted — receipt is not durable.');
  await prisma.$disconnect();
  process.exit(2);
}
console.log(`\n✓ PERSISTED  event ${row.id}`);
console.log(`  system=${row.sourceSystem} entity=${row.entityType ?? row.entity ?? '—'} externalId=${row.externalId}`);
console.log(`  status=${row.status} transport=${row.transport ?? '—'} changeKind=${row.changeKind ?? '—'}`);
console.log(`  MirrorEvent count ${before} → ${after}`);
if (row.status !== 'pending') {
  console.log(`  ⚠ expected status 'pending' while apply is off, got '${row.status}'`);
}

// ── 3) remove the synthetic event ────────────────────────────────────────────
// The Phase C replay must contain only real business changes. This row is a test
// artifact created by this script, so it is removed by this script.
await prisma.mirrorEvent.delete({ where: { id: row.id } });
const cleaned = await prisma.mirrorEvent.count();
console.log(`\n✓ synthetic event deleted — MirrorEvent count back to ${cleaned}`);
const leftovers = await prisma.mirrorEvent.count({ where: { externalId: SYNTHETIC_ID } });
console.log(`  synthetic rows remaining: ${leftovers}`);

// ── 4) poller health ─────────────────────────────────────────────────────────
const health = await mirrorHealth(prisma);
console.log(`\npoller health: ${health.ok ? 'OK' : 'PROBLEMS'} · pending ${health.pending} · dead ${health.dead} · conflicts ${health.conflicts}`);
for (const c of health.cursors) {
  console.log(`  ${String(c.id).padEnd(34)} cursor=${c.cursor || '(none)'} lastRun=${c.lastRunAt ? new Date(c.lastRunAt).toISOString() : 'never'} lastOk=${c.lastSuccessAt ? new Date(c.lastSuccessAt).toISOString() : 'never'} fails=${c.failureStreak}`);
}
for (const p of health.problems) console.log(`  ⚠ ${p.cursor ?? '-'}: ${p.problem} — ${p.detail}`);

console.log('\nTRANSPORT VERIFIED: an authenticated Pipedrive webhook is received and durably stored.');
console.log('Still to prove with REAL edits: a genuine Pipedrive deal change, and an Airtable tour change via the poller.');
await prisma.$disconnect();
