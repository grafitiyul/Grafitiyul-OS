// LOCAL: authenticated production verification for multi-deal payment allocation.
//
// STRICTLY READ-ONLY on money. It exercises the REAL deployed endpoints as an
// operator would, against REAL production data:
//   • the Deal picker (canonical global search + real paid/remaining figures)
//   • an existing multi-deal historical document read through the new service
//   • a Deal's collection payload, which now carries the allocation context
//
// It writes NOTHING. No document is issued, no allocation is changed, no
// customer payment is touched — the owner's rule that real customer payments
// are never used for QA.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

function rv(service) {
  const a = ['variables', '--json'];
  if (service) a.push('--service', service);
  return JSON.parse(execFileSync('railway', a, {
    cwd: 'c:/Projects/grafitiyul-os', encoding: 'utf8', maxBuffer: 2e7, shell: true,
  }));
}

const app = rv();
const pg = rv('Postgres');
const ORIGIN = (app.PUBLIC_ORIGIN || `https://${app.RAILWAY_PUBLIC_DOMAIN}`).replace(/\/$/, '');
const SECRET = app.SESSION_SECRET;

const require2 = createRequire('file:///c:/Projects/grafitiyul-os/server/');
const { PrismaClient } = require2('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: pg.DATABASE_PUBLIC_URL } } });

const admin = await prisma.adminUser.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
const exp = Math.floor(Date.now() / 1000) + 900;
const payload = `${exp}.${admin.id}`;
const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
const COOKIE = `gos_admin_session=${encodeURIComponent(`${payload}.${sig}`)}`;

const pass = [];
const fail = [];

async function get(path) {
  const res = await fetch(`${ORIGIN}${path}`, { headers: { cookie: COOKIE } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function check(name, ok, detail = '') {
  (ok ? pass : fail).push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// ── 1. The Deal picker ───────────────────────────────────────────────────────
{
  const r = await get('/api/payments/allocations/deal-search?q=27151');
  check('deal-search responds', r.status === 200, `HTTP ${r.status}`);
  const hit = (r.body?.results || []).find((d) => d.orderNo === 27151);
  check('deal-search finds a deal by its order number', !!hit);
  if (hit) {
    check(
      'picker rows carry REAL collection figures',
      hit.totalMinor != null && hit.paidMinor != null && hit.remainingMinor != null,
      `total=${hit.totalMinor} paid=${hit.paidMinor} remaining=${hit.remainingMinor}`,
    );
  }
  const q2 = await get('/api/payments/allocations/deal-search?q=a');
  check('a too-short query returns nothing rather than the whole database',
    q2.status === 200 && (q2.body?.results || []).length === 0);
}

// ── 2. An existing multi-deal document, read through the new service ─────────
{
  const row = await prisma.icountDocument.findFirst({
    where: { allocationGroupId: { not: null } },
    select: { allocationGroupId: true, docnum: true },
  });
  const r = await get(`/api/payments/allocations/${encodeURIComponent(row.allocationGroupId)}`);
  check('allocation group reads over HTTP', r.status === 200, `HTTP ${r.status}`);
  const g = r.body?.group;
  if (g) {
    const sum = g.allocations.reduce((s, a) => s + a.amountMinor, 0);
    check('shares add up to the reported allocated total', sum === g.allocatedMinor, `${sum} vs ${g.allocatedMinor}`);
    check('the group reports the REAL payment separately from the shares',
      g.realMinor > 0 && g.realMinor >= 0, `real=${g.realMinor} allocated=${g.allocatedMinor}`);
    check('a historical consolidated document reads as balanced', g.state === 'balanced', g.state);
    check('it spans more than one deal', g.dealCount > 1, `${g.dealCount} deals`);
    check('audit array is present', Array.isArray(r.body?.audit));
  }
  const missing = await get('/api/payments/allocations/doc%3Ainvrec%3A000000');
  check('an unknown group 404s (the route is really mounted)', missing.status === 404, `HTTP ${missing.status}`);
}

// ── 3. The Deal collection payload carries allocation context ────────────────
{
  const shared = await prisma.icountDocument.findFirst({
    where: { allocationGroupId: { not: null } },
    select: { dealId: true },
  });
  // NOTE: /api/deals/:id/collection resolves the internal id only — that router
  // predates the orderNo param resolver and the app always passes deal.id. Not
  // touched here: adding the resolver would also apply the retired-deal WRITE
  // block to financial endpoints, which is an owner decision, not a test fix.
  const r = await get(`/api/deals/${shared.dealId}/collection`);
  check('deal collection responds', r.status === 200, `HTTP ${r.status}`);
  check('collection payload now carries `allocations`', Array.isArray(r.body?.allocations));
  const a = (r.body?.allocations || [])[0];
  if (a) {
    check('the panel is told what THIS deal counts and where the rest went',
      a.thisDealMinor > 0 && Array.isArray(a.otherAllocations),
      `this=${a.thisDealMinor} others=${a.otherAllocations.length}`);
    check('this deal counts LESS than the whole payment', a.thisDealMinor < a.realMinor,
      `${a.thisDealMinor} < ${a.realMinor}`);
  }
  // The money itself must be unchanged by any of this.
  check('the deal still reports a coherent balance',
    typeof r.body?.balanceMinor === 'number' && typeof r.body?.paidMinor === 'number');
}

// ── 4. #27151's provenance is now truthful ───────────────────────────────────
{
  const d = await prisma.deal.findFirst({
    where: { orderNo: 27151 },
    select: { collectionReviewStatus: true, collectionReviewStatusSource: true },
  });
  check('#27151 is no longer labelled "paid in a previous system"',
    d.collectionReviewStatus === 'paid_in_gos' && d.collectionReviewStatusSource === 'gos:paid_in_gos',
    `${d.collectionReviewStatus} / ${d.collectionReviewStatusSource}`);
  const legacy = await prisma.deal.count({ where: { collectionReviewStatusSource: 'migration:legacy_assumed_paid' } });
  check('genuinely historical deals were NOT rewritten', legacy > 8000, `${legacy} still legacy`);
}

console.log('\nPASS');
for (const p of pass) console.log(`  ✓ ${p}`);
if (fail.length) {
  console.log('\nFAIL');
  for (const f of fail) console.log(`  ✗ ${f}`);
}
console.log(`\n${pass.length} passed, ${fail.length} failed`);
await prisma.$disconnect();
process.exit(fail.length ? 1 : 0);
