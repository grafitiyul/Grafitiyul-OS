import test from 'node:test';
import assert from 'node:assert/strict';
import { collectAgentOrder } from './agentOrderEvent.js';

const client = (session) => ({
  reservationSession: { findUnique: async () => session },
});

const group = (over = {}) => ({
  groupName: 'כיתה ז1', productLabel: 'סיור גרפיטי', locationLabel: 'תל אביב',
  createdDeal: {
    orderNo: 27242, participants: 24, valueMinor: 372000n,
    tourDate: '2026-10-04', tourTime: '10:00',
    product: { nameHe: 'סיור וסדנת גרפיטי' }, location: { nameHe: 'תל אביב' },
  },
  ...over,
});

test('figures come from the created DEAL, not the submitted form', async () => {
  const o = await collectAgentOrder('s1', client({ sessionNo: 1042, groups: [group()] }));
  assert.equal(o.orderNo, 1042);
  assert.deepEqual(o.groups[0], {
    groupName: 'כיתה ז1', tourDate: '2026-10-04', tourTime: '10:00',
    productName: 'סיור וסדנת גרפיטי - תל אביב', participants: 24,
    totalMinor: 372000, dealOrderNo: 27242,
  });
  assert.equal(o.totalMinor, 372000);
});

test('a group whose deal was never created is not reported as booked', async () => {
  const o = await collectAgentOrder('s1', client({
    sessionNo: 7, groups: [group(), group({ createdDeal: null })],
  }));
  assert.equal(o.groups.length, 1);
});

test('the order total is the sum of the created deals', async () => {
  const o = await collectAgentOrder('s1', client({
    sessionNo: 7,
    groups: [group(), group({ createdDeal: { ...group().createdDeal, orderNo: 27243, valueMinor: 341000n } })],
  }));
  assert.equal(o.totalMinor, 713000);
});

test('an unpriced order reports no total rather than a false zero', async () => {
  const o = await collectAgentOrder('s1', client({
    sessionNo: 7, groups: [group({ createdDeal: { ...group().createdDeal, valueMinor: null } })],
  }));
  assert.equal(o.totalMinor, null);
  assert.equal(o.groups[0].totalMinor, null);
});

test('a renamed/unlinked catalog row falls back to the frozen form labels', async () => {
  const o = await collectAgentOrder('s1', client({
    sessionNo: 7,
    groups: [group({ createdDeal: { ...group().createdDeal, product: null, location: null } })],
  }));
  assert.equal(o.groups[0].productName, 'סיור גרפיטי - תל אביב');
});

test('a missing session reports nothing at all', async () => {
  assert.equal(await collectAgentOrder('nope', client(null)), null);
});
