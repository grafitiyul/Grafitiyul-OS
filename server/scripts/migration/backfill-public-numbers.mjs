// Backfill Organization.orgNo / Contact.contactNo from the legacy Pipedrive
// ids in the crosswalk (owner decision D6: imported records keep their source
// numbers as the public identifier). Fill-null-only; sequences for NEW rows
// start at 10000/50000, far above the legacy ranges (3,053 / 37,636).
//   railway run --service Grafitiyul-OS node server/scripts/migration/backfill-public-numbers.mjs [--execute]
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const EXECUTE = process.argv.includes('--execute');

const xwalk = await prisma.legacyRecord.findMany({
  where: { sourceSystem: 'pipedrive', sourceType: { in: ['person', 'organization'] }, entityId: { not: null } },
  select: { sourceType: true, sourceId: true, entityType: true, entityId: true },
});
// Merged contacts: several source ids → one entity. The SMALLEST legacy id
// wins deterministically; losers stay reachable via search (legacy card).
const orgNoByEntity = new Map();
const contactNoByEntity = new Map();
for (const r of xwalk) {
  const n = Number(r.sourceId);
  if (!Number.isFinite(n)) continue;
  if (r.sourceType === 'organization' && r.entityType === 'Organization') {
    if (!orgNoByEntity.has(r.entityId) || n < orgNoByEntity.get(r.entityId)) orgNoByEntity.set(r.entityId, n);
  } else if (r.sourceType === 'person' && r.entityType === 'Contact') {
    if (!contactNoByEntity.has(r.entityId) || n < contactNoByEntity.get(r.entityId)) contactNoByEntity.set(r.entityId, n);
  }
}
const [orgs, contacts] = await Promise.all([
  prisma.organization.findMany({ where: { orgNo: null }, select: { id: true } }),
  prisma.contact.findMany({ where: { contactNo: null }, select: { id: true } }),
]);
const orgOps = orgs.filter((o) => orgNoByEntity.has(o.id)).map((o) => ({ id: o.id, n: orgNoByEntity.get(o.id) }));
const contactOps = contacts.filter((c) => contactNoByEntity.has(c.id)).map((c) => ({ id: c.id, n: contactNoByEntity.get(c.id) }));
const bad = [...orgOps.filter((x) => x.n >= 10000), ...contactOps.filter((x) => x.n >= 50000)];
console.log(`plan: orgs ${orgOps.length} (of ${orgs.length} null) · contacts ${contactOps.length} (of ${contacts.length} null) · sequence collisions ${bad.length} (must be 0)`);
if (bad.length) { console.error('REFUSED: legacy ids reach the new-row sequence range'); process.exit(2); }
if (!EXECUTE) { console.log('--dry: nothing written.'); await prisma.$disconnect(); process.exit(0); }

const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
for (const slice of chunk(orgOps, 200)) await prisma.$transaction(slice.map((x) => prisma.organization.update({ where: { id: x.id }, data: { orgNo: x.n } })));
for (const slice of chunk(contactOps, 200)) await prisma.$transaction(slice.map((x) => prisma.contact.update({ where: { id: x.id }, data: { contactNo: x.n } })));
console.log(`✔ backfilled orgNo ${orgOps.length} · contactNo ${contactOps.length}`);
console.log(`verify: orgs numbered ${await prisma.organization.count({ where: { orgNo: { not: null } } })} · contacts numbered ${await prisma.contact.count({ where: { contactNo: { not: null } } })}`);
const dupO = await prisma.$queryRaw`SELECT COUNT(*)::int n FROM (SELECT "orgNo" FROM "Organization" WHERE "orgNo" IS NOT NULL GROUP BY "orgNo" HAVING COUNT(*)>1) d`;
const dupC = await prisma.$queryRaw`SELECT COUNT(*)::int n FROM (SELECT "contactNo" FROM "Contact" WHERE "contactNo" IS NOT NULL GROUP BY "contactNo" HAVING COUNT(*)>1) d`;
console.log(`duplicates: org ${dupO[0].n} · contact ${dupC[0].n} (expected 0/0)`);
await prisma.$disconnect();
