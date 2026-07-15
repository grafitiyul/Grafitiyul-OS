// TEMP, READ-ONLY: Slice 0 pre-flight gate for the CRM Tasks workspace.
// Proves every Task.ownerUserId resolves to a real AdminUser BEFORE the FK lands.
// A non-resolving value would make ADD CONSTRAINT fail at `prisma migrate deploy`,
// which on Railway runs during startup — i.e. it would take the service down.
// Performs NO writes. Follows the `_`-prefixed temp-script convention.
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const ok = (b) => (b ? '✓' : '✗ FAIL');

const admins = await p.adminUser.findMany({
  select: { id: true, username: true, isActive: true },
});
const adminIds = new Set(admins.map((a) => a.id));

console.log('=== AdminUser population ===');
console.log(`total: ${admins.length}  active: ${admins.filter((a) => a.isActive).length}  inactive: ${admins.filter((a) => !a.isActive).length}`);
for (const a of admins) console.log(`  ${a.id}  ${a.username.padEnd(20)} ${a.isActive ? 'active' : 'INACTIVE'}`);

const tasks = await p.task.findMany({
  select: { id: true, ownerUserId: true, createdByUserId: true, status: true, channel: true, createdAt: true },
});

console.log('\n=== Task population ===');
console.log(`total tasks: ${tasks.length}`);

// 1. ownerUserId — the column the FK will constrain.
const owners = new Map();
for (const t of tasks) {
  const k = t.ownerUserId;
  if (!owners.has(k)) owners.set(k, []);
  owners.get(k).push(t);
}
console.log(`distinct ownerUserId values: ${owners.size}`);

const emptyOwner = tasks.filter((t) => t.ownerUserId == null || t.ownerUserId === '');
const orphanOwner = [...owners.entries()].filter(([k]) => k != null && k !== '' && !adminIds.has(k));

console.log('\n=== GATE: Task.ownerUserId → AdminUser.id ===');
console.log(`null/empty ownerUserId : ${emptyOwner.length} ${ok(emptyOwner.length === 0)}`);
console.log(`orphaned ownerUserId   : ${orphanOwner.length} distinct ${ok(orphanOwner.length === 0)}`);

for (const [k, rows] of orphanOwner) {
  console.log(`\n  ORPHAN "${k}" — ${rows.length} task(s)`);
  for (const r of rows.slice(0, 10)) {
    console.log(`    ${r.id}  status=${r.status.padEnd(9)} channel=${r.channel.padEnd(8)} created=${r.createdAt.toISOString().slice(0, 10)}`);
  }
  if (rows.length > 10) console.log(`    … and ${rows.length - 10} more`);
}

// Resolving owners, with task counts — this is what Restrict will protect.
console.log('\n=== Owner distribution (what onDelete: Restrict will protect) ===');
for (const [k, rows] of [...owners.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const a = admins.find((x) => x.id === k);
  const who = a ? `${a.username}${a.isActive ? '' : ' (INACTIVE)'}` : '*** ORPHAN ***';
  const open = rows.filter((r) => r.status === 'open').length;
  console.log(`  ${String(rows.length).padStart(5)} tasks (${String(open).padStart(4)} open)  ${who}`);
}

// 2. createdByUserId — NOT part of the Slice 0 FK, reported for completeness only.
const creators = new Set(tasks.map((t) => t.createdByUserId).filter((x) => x != null && x !== ''));
const orphanCreators = [...creators].filter((k) => !adminIds.has(k));
console.log('\n=== createdByUserId (informational — no FK in Slice 0) ===');
console.log(`distinct non-null: ${creators.size}  non-resolving: ${orphanCreators.length}`);
for (const k of orphanCreators) {
  console.log(`  non-resolving "${k}" — ${tasks.filter((t) => t.createdByUserId === k).length} task(s)`);
}

// 3. Priority population — informs the semantic-sort test (no priorityRank).
const byPriority = tasks.reduce((m, t) => m, new Map());
const prios = await p.task.groupBy({ by: ['priority'], _count: { _all: true } });
console.log('\n=== Priority population (semantic sort: high > medium > low > null) ===');
for (const r of prios) console.log(`  ${String(r.priority ?? 'null').padEnd(8)} ${r._count._all}`);

const verdict = emptyOwner.length === 0 && orphanOwner.length === 0;
console.log(`\n=== GATE VERDICT: ${verdict ? 'PASS — safe to add the FK' : 'FAIL — STOP, do not force the FK'} ===`);

await p.$disconnect();
process.exit(verdict ? 0 : 1);
