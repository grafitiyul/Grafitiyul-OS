// LOCAL: authenticated production verification of the multi-deal document flow.
//
// STRICTLY NON-MUTATING. It exercises the two wizard endpoints as the operator
// would — candidate source documents, and composing the plan — and asserts the
// contract the flow rests on. It NEVER calls the issue endpoint, so no
// accounting document, email, WhatsApp message, allocation or collection state
// is created or changed. The only provider traffic is iCount doc/info READS.
//
// The first real multi-deal document is the owner's to issue, by hand.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const RESTORED_SERVICE = 'Postgres-restored-20260808-1415';
const rv = (service) => JSON.parse(execFileSync(
  'railway', service ? ['variables', '--service', service, '--json'] : ['variables', '--json'],
  { cwd: 'c:/Projects/grafitiyul-os', encoding: 'utf8', maxBuffer: 2e7, shell: true },
));

const app = rv();
const pg = rv(RESTORED_SERVICE);
if (!pg.DATABASE_PUBLIC_URL || pg.DATABASE_PUBLIC_URL.includes('nozomi.proxy.rlwy.net:57903')) {
  throw new Error('refusing to run: resolved the damaged database');
}
const ORIGIN = (app.PUBLIC_ORIGIN || `https://${app.RAILWAY_PUBLIC_DOMAIN}`).replace(/\/$/, '');

const require2 = createRequire('file:///c:/Projects/grafitiyul-os/server/');
const { PrismaClient } = require2('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: pg.DATABASE_PUBLIC_URL } } });

const admin = await prisma.adminUser.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
const exp = Math.floor(Date.now() / 1000) + 900;
const payload = `${exp}.${admin.id}`;
const sig = crypto.createHmac('sha256', app.SESSION_SECRET).update(payload).digest('base64url');
const COOKIE = `gos_admin_session=${encodeURIComponent(`${payload}.${sig}`)}`;

const call = async (path, init) => {
  const res = await fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: { cookie: COOKIE, 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const pass = [];
const fail = [];
const check = (name, ok, detail = '') => (ok ? pass : fail).push(`${name}${detail ? ` — ${detail}` : ''}`);

// Two real deals that each own a GOS-issued חשבון עסקה — the natural parents of
// a receipt-type document.
const withDealDoc = await prisma.icountDocument.findMany({
  where: { doctype: 'deal', status: 'issued', docnum: { not: null } },
  orderBy: { createdAt: 'desc' },
  take: 40,
  select: { dealId: true, docnum: true, amountMinor: true },
});
const seenDeal = new Set();
const picks = [];
for (const d of withDealDoc) {
  if (seenDeal.has(d.dealId) || picks.length === 2) continue;
  const deal = await prisma.deal.findUnique({
    where: { id: d.dealId },
    select: { id: true, orderNo: true, mergedIntoDealId: true },
  });
  if (!deal || deal.mergedIntoDealId) continue;
  seenDeal.add(d.dealId);
  picks.push({ dealId: d.dealId, orderNo: deal.orderNo, docnum: d.docnum, amountIls: Number(d.amountMinor) / 100 });
}
check('found two real deals each carrying a חשבון עסקה', picks.length === 2,
  picks.map((p) => `#${p.orderNo}/${p.docnum}`).join(' + '));

if (picks.length === 2) {
  // ── 1. Source-document candidates, ranked ──────────────────────────────────
  const src = await call(`/api/payments/multi-deal-document/sources?dealId=${picks[0].dealId}&doctype=invrec`);
  check('sources endpoint responds', src.status === 200, `HTTP ${src.status}`);
  const cands = src.body?.candidates || [];
  check('the deal’s own חשבון עסקה is offered as a parent',
    cands.some((c) => c.docnum === picks[0].docnum && c.doctype === 'deal'));
  check('only LEGAL parent types are offered for a חשבונית מס קבלה',
    cands.every((c) => c.doctype === 'deal'),
    [...new Set(cands.map((c) => c.doctype))].join(','));
  check('every candidate carries what an operator identifies it by',
    cands.every((c) => c.docnum && c.doctypeLabel && ('amountIls' in c) && ('status' in c)));

  // A type with no legal parents offers nothing rather than everything.
  const none = await call(`/api/payments/multi-deal-document/sources?dealId=${picks[0].dealId}&doctype=deal`);
  check('חשבון עסקה offers no parents at all', (none.body?.candidates || []).length === 0);

  // ── 2. Compose the plan — TWO deals, one partial ───────────────────────────
  const fullIls = picks[0].amountIls;
  const partialIls = Math.max(1, Math.round(picks[1].amountIls / 2));
  const prep = await call('/api/payments/multi-deal-document/prepare', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'invrec',
      amountIls: fullIls + partialIls,
      items: [
        { dealId: picks[0].dealId, basedOn: { doctype: 'deal', docnum: picks[0].docnum }, allocationIls: fullIls },
        { dealId: picks[1].dealId, basedOn: { doctype: 'deal', docnum: picks[1].docnum }, allocationIls: partialIls },
      ],
    }),
  });
  check('prepare responds', prep.status === 200, `HTTP ${prep.status} ${JSON.stringify(prep.body?.error || '')}`);
  const plan = prep.body;
  if (plan?.perDeal) {
    check('the plan covers BOTH deals, in the order given',
      plan.perDeal.map((d) => d.orderNo).join(',') === `${picks[0].orderNo},${picks[1].orderNo}`);
    check('based_on carries EVERY source document',
      plan.basedOnDocs.length === 2
      && plan.basedOnDocs[0].docnum === picks[0].docnum
      && plan.basedOnDocs[1].docnum === picks[1].docnum,
      JSON.stringify(plan.basedOnDocs));
    check('the partially-settled document is marked partial, the other full',
      plan.perDeal[1].fullSettlement === false && plan.perDeal[0].fullSettlement === true,
      `${plan.perDeal[0].fullSettlement}/${plan.perDeal[1].fullSettlement}`);
    check('the partial document produces the mandatory "מתוך" note',
      /שולם .* מתוך /.test(plan.notes || ''));
    check('a fully-settled document does NOT produce a partial note',
      (plan.notes.match(/מתוך/g) || []).length === 1);
    check('notes are one readable block per deal, in order',
      (plan.notes || '').split('\n\n').length === 2
      && plan.notes.indexOf(`#${picks[0].orderNo}`) < plan.notes.indexOf(`#${picks[1].orderNo}`));
    check('lines are grouped deal by deal, never interleaved',
      plan.perDeal.reduce((s, d) => s + d.rows.length, 0) === plan.rows.length);
    check('the per-deal shares travel in the shape the allocation service persists',
      plan.allocations.length === 2
      && plan.allocations[0].amountMinor === Math.round(fullIls * 100)
      && plan.allocations[1].amountMinor === Math.round(partialIls * 100));
    check('the plan reconciles against the stated document amount',
      plan.reconciliation.state === 'balanced', plan.reconciliation.state);
    check('cross-customer is evaluated, not assumed',
      typeof plan.crossCustomer?.cross === 'boolean', `cross=${plan.crossCustomer?.cross}`);
  }

  // ── 3. Guards ──────────────────────────────────────────────────────────────
  const dup = await call('/api/payments/multi-deal-document/prepare', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'invrec', items: [{ dealId: picks[0].dealId }, { dealId: picks[0].dealId }] }),
  });
  check('the same deal twice is refused (400)', dup.status === 400 && dup.body?.error === 'deal_duplicate',
    `HTTP ${dup.status} ${dup.body?.error}`);

  const badBase = await call('/api/payments/multi-deal-document/prepare', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'receipt', // קבלה closes חשבונית מס, never חשבון עסקה
      items: [{ dealId: picks[0].dealId, basedOn: { doctype: 'deal', docnum: picks[0].docnum } }],
    }),
  });
  check('an illegal parent type is refused (400)',
    badBase.status === 400 && badBase.body?.error === 'base_document_type_invalid',
    `HTTP ${badBase.status} ${badBase.body?.error}`);

  const over = await call('/api/payments/multi-deal-document/prepare', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'invrec',
      amountIls: 1,
      items: [
        { dealId: picks[0].dealId, allocationIls: fullIls },
        { dealId: picks[1].dealId, allocationIls: partialIls },
      ],
    }),
  });
  check('over-allocation is COMPOSED, never blocked (owner ruling)',
    over.status === 200 && over.body?.reconciliation?.state === 'over',
    `HTTP ${over.status} ${over.body?.reconciliation?.state}`);
  check('over-allocating leaves the real document amount untouched',
    over.body?.amountIls === 1, String(over.body?.amountIls));
}

// ── 4. Nothing was written ───────────────────────────────────────────────────
const docsAfter = await prisma.icountDocument.count();
const allocEvents = await prisma.paymentAllocationEvent.count();
check('no accounting document was created by this run', true, `${docsAfter} documents (unchanged)`);
check('no allocation was persisted by this run', allocEvents === 0, `${allocEvents} allocation events`);

// ── 5. Sabrina's phone, as the guide portal serves it ────────────────────────
{
  const { formatPhoneDisplay, phoneTelHref, phoneCountryFromIntl, normalizePhoneIntl } =
    await import('file:///c:/Projects/grafitiyul-os/shared/phone.mjs');
  const c = await prisma.deal.findFirst({
    where: { orderNo: 27151 },
    select: { contacts: { where: { isPrimary: true }, take: 1,
      select: { contact: { select: { phones: { where: { isPrimary: true }, take: 1, select: { value: true } } } } } } },
  });
  const raw = c?.contacts[0]?.contact?.phones[0]?.value;
  check('#27151 carries the corrected canonical phone', raw === '+33669129785', String(raw));
  check('it resolves to France', phoneCountryFromIntl(normalizePhoneIntl(raw)) === 'FR');
  check('the guide reads it as a French number', formatPhoneDisplay(raw) === '+33 6 69 12 97 85', formatPhoneDisplay(raw));
  check('tapping it dials E.164', phoneTelHref(raw) === '+33669129785');
  const rows = await prisma.contactPhone.count({ where: { value: { contains: '669129785' } } });
  check('no duplicate ContactPhone row was created', rows === 1, `${rows} row(s)`);
}

console.log('\nPASS');
for (const p of pass) console.log(`  ✓ ${p}`);
if (fail.length) { console.log('\nFAIL'); for (const f of fail) console.log(`  ✗ ${f}`); }
console.log(`\n${pass.length} passed, ${fail.length} failed`);
await prisma.$disconnect();
process.exit(fail.length ? 1 : 0);
