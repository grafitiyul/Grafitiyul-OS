// THE invariant that makes multi-deal allocation safe for the books:
//
//   however a payment is carved up between deals, the company received the
//   payment ONCE.
//
// Splitting, over-splitting and re-splitting are all internal decisions. None
// of them may move the company's income by one agora.

import test from 'node:test';
import assert from 'node:assert/strict';
import { companyCollectionTotals } from './collection.js';

const ILS = (n) => n * 100;

function fakePrisma({ documents = [], evidence = [], wonDeals = [] }) {
  return {
    icountDocument: { findMany: async () => documents },
    dealCollectionEvidence: { findMany: async () => evidence },
    deal: { findMany: async () => wonDeals },
  };
}

test('one document linked to three deals is counted ONCE', async () => {
  const shared = (dealId, allocationMinor) => ({
    dealId, doctype: 'invrec', docnum: '38534', amountMinor: BigInt(ILS(3000)),
    paidMinor: null, sharedHistorical: true, allocationMinor: BigInt(allocationMinor),
  });
  const totals = await companyCollectionTotals(fakePrisma({
    documents: [shared('a', ILS(1000)), shared('b', ILS(1200)), shared('c', ILS(800))],
    wonDeals: [{ valueMinor: BigInt(ILS(3000)) }],
  }));
  assert.equal(totals.documentsReceivedMinor, ILS(3000));
  assert.equal(totals.uniqueDocuments, 1);
  assert.equal(totals.sharedDocuments.documents, 1);
  assert.equal(totals.sharedDocuments.dealLinks, 3);
});

test('one SPLIT bank transfer is counted once, not once per deal', async () => {
  const share = (id, dealId, allocationMinor) => ({
    id, dealId, direction: 'in', amountMinor: BigInt(ILS(3000)),
    allocationGroupId: 'pay:transfer1', allocationMinor: BigInt(allocationMinor),
  });
  const totals = await companyCollectionTotals(fakePrisma({
    evidence: [share('e1', 'a', ILS(1000)), share('e2', 'b', ILS(1200)), share('e3', 'c', ILS(800))],
  }));
  // Before allocation existed this would have read ₪9,000.
  assert.equal(totals.manualReceivedMinor, ILS(3000));
});

test('OVER-allocating cannot invent revenue', async () => {
  // The owner's worked example: ₪1,500 real, ₪1,700 allocated across two deals.
  const share = (id, dealId, allocationMinor) => ({
    id, dealId, direction: 'in', amountMinor: BigInt(ILS(1500)),
    allocationGroupId: 'pay:over', allocationMinor: BigInt(allocationMinor),
  });
  const totals = await companyCollectionTotals(fakePrisma({
    evidence: [share('e1', 'a', ILS(1000)), share('e2', 'b', ILS(700))],
  }));
  assert.equal(totals.manualReceivedMinor, ILS(1500), 'the company received ₪1,500 — never ₪1,700');
  assert.equal(totals.collectedMinor, ILS(1500));
});

test('independent single-deal evidence rows are still counted separately', async () => {
  // The regression guard for the dedupe: two UNRELATED payments must not
  // collapse into one just because neither carries a group.
  const totals = await companyCollectionTotals(fakePrisma({
    evidence: [
      { id: 'e1', dealId: 'a', direction: 'in', amountMinor: BigInt(ILS(500)), allocationGroupId: null, allocationMinor: null },
      { id: 'e2', dealId: 'b', direction: 'in', amountMinor: BigInt(ILS(700)), allocationGroupId: null, allocationMinor: null },
    ],
  }));
  assert.equal(totals.manualReceivedMinor, ILS(1200));
});

test('a split refund is also counted once', async () => {
  const totals = await companyCollectionTotals(fakePrisma({
    evidence: [
      { id: 'e1', dealId: 'a', direction: 'out', amountMinor: BigInt(ILS(400)), allocationGroupId: 'pay:refund', allocationMinor: BigInt(ILS(200)) },
      { id: 'e2', dealId: 'b', direction: 'out', amountMinor: BigInt(ILS(400)), allocationGroupId: 'pay:refund', allocationMinor: BigInt(ILS(200)) },
    ],
  }));
  assert.equal(totals.manualRefundedMinor, ILS(400));
  assert.equal(totals.collectedMinor, -ILS(400));
});
