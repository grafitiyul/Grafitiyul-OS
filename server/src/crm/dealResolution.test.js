import test from 'node:test';
import assert from 'node:assert/strict';
import { dealsForContact, contactDealsPanel, CONTACT_DEALS_SELECT } from './dealResolution.js';

// dealsForContact — the ONE "deals of a contact" query (WhatsApp/Email
// resolution + the Contact page "דילים קודמים" panel) — and the panel DTO.

function stubDb(rows, catalogs = {}) {
  const calls = { findMany: [] };
  return {
    calls,
    deal: {
      findMany: async (args) => {
        calls.findMany.push(args);
        return rows;
      },
    },
    dealStage: { findMany: async () => catalogs.stages || [] },
    organization: { findMany: async () => catalogs.orgs || [] },
    product: { findMany: async () => catalogs.products || [] },
  };
}

test('dealsForContact filters ONLY by the canonical DealContact relation', async () => {
  const db = stubDb([]);
  await dealsForContact('c1', db);
  assert.equal(db.calls.findMany.length, 1);
  const args = db.calls.findMany[0];
  // Exactly the relation filter — no name/phone/email/organization matching —
  // plus the retired-by-merge exclusion, which every "which deal is this
  // conversation about" surface carries (deals/mergeLineage.js).
  assert.deepEqual(args.where, {
    contacts: { some: { contactId: 'c1' } },
    mergedIntoDealId: null,
  });
  assert.equal(args.select, CONTACT_DEALS_SELECT);
});

test('dealsForContact selects the panel fields (orderNo, currency, activity timestamps)', () => {
  for (const f of ['orderNo', 'title', 'status', 'tourDate', 'valueMinor', 'currency', 'createdAt', 'lastMeaningfulActivityAt', 'productId']) {
    assert.equal(CONTACT_DEALS_SELECT[f], true, `select includes ${f}`);
  }
});

test('dealsForContact attaches stage/org/product display names via id-lookups', async () => {
  const rows = [
    { id: 'd1', dealStageId: 's1', organizationId: 'o1', productId: 'p1' },
    { id: 'd2', dealStageId: null, organizationId: null, productId: null },
  ];
  const db = stubDb(rows, {
    stages: [{ id: 's1', label: 'ליד חדש' }],
    orgs: [{ id: 'o1', name: 'אורט' }],
    products: [{ id: 'p1', nameHe: 'סיור גרפיטי' }],
  });
  const out = await dealsForContact('c1', db);
  assert.equal(out[0].stageName, 'ליד חדש');
  assert.equal(out[0].organizationName, 'אורט');
  assert.equal(out[0].productName, 'סיור גרפיטי');
  assert.equal(out[1].stageName, null);
  assert.equal(out[1].organizationName, null);
  assert.equal(out[1].productName, null);
});

test('contactDealsPanel orders by last meaningful activity, createdAt fallback', () => {
  const deals = [
    { id: 'old', createdAt: '2026-01-01T00:00:00Z', lastMeaningfulActivityAt: null },
    { id: 'recentActivity', createdAt: '2026-02-01T00:00:00Z', lastMeaningfulActivityAt: '2026-08-01T00:00:00Z' },
    { id: 'newButQuiet', createdAt: '2026-07-01T00:00:00Z', lastMeaningfulActivityAt: null },
  ];
  const out = contactDealsPanel(deals);
  assert.deepEqual(
    out.map((d) => d.id),
    ['recentActivity', 'newButQuiet', 'old'],
  );
  // Pure — the input order is untouched.
  assert.deepEqual(deals.map((d) => d.id), ['old', 'recentActivity', 'newButQuiet']);
});

test('contactDealsPanel exposes exactly the whitelisted fields', () => {
  const out = contactDealsPanel([
    {
      id: 'd1', orderNo: 27001, title: 'ישראל ישראלי', status: 'won',
      activityType: 'business', tourDate: '2026-05-01', valueMinor: 120000n,
      currency: 'ILS', stageName: 'WON', organizationName: 'אורט',
      productName: 'סיור', createdAt: '2026-01-01T00:00:00Z',
      lastMeaningfulActivityAt: '2026-06-01T00:00:00Z',
      // internal fields that must NOT leak to the panel payload:
      dealStageId: 's1', organizationId: 'o1', productId: 'p1',
    },
  ]);
  assert.deepEqual(
    Object.keys(out[0]).sort(),
    [
      'activityType', 'createdAt', 'currency', 'id', 'lastMeaningfulActivityAt',
      'orderNo', 'organizationName', 'productName', 'stageName', 'status',
      'title', 'tourDate', 'valueMinor',
    ],
  );
  assert.equal(out[0].valueMinor, 120000n);
});
