import test from 'node:test';
import assert from 'node:assert/strict';
import { recordDealChanges, recordDealContactChange, DEAL_DIFF_SELECT } from './dealChangelog.js';

// recordDealChanges takes the prisma client as a parameter, so the diff logic
// tests run against a fake — no DB.
function fakeClient({ labels = {} } = {}) {
  const created = [];
  const modelStub = (model) => ({
    findMany: async ({ where }) =>
      (where.id.in || []).map((id) => ({ id, ...(labels[`${model}:${id}`] || {}) })),
  });
  return {
    created,
    timelineEntry: { create: async ({ data }) => { created.push(data); return data; } },
    dealStage: modelStub('dealStage'),
    product: modelStub('product'),
    location: modelStub('location'),
    organization: modelStub('organization'),
    organizationUnit: modelStub('organizationUnit'),
    organizationType: modelStub('organizationType'),
    organizationSubtype: modelStub('organizationSubtype'),
    dealSource: modelStub('dealSource'),
    paymentTerm: modelStub('paymentTerm'),
    paymentMethod: modelStub('paymentMethod'),
    lostReason: modelStub('lostReason'),
  };
}

const origin = { actorType: 'user', actorLabel: null, createdBy: 'u1', createdByName: 'dor' };

test('no tracked change → no timeline entry', async () => {
  const client = fakeClient();
  const snap = { id: 'd1', title: 'סיור', valueMinor: 120000n, currency: 'ILS', participants: 12 };
  const out = await recordDealChanges(client, { dealId: 'd1', before: snap, after: { ...snap }, origin });
  assert.equal(out, null);
  assert.equal(client.created.length, 0);
});

test('money + participants + tour date changes are grouped into one entry with displays', async () => {
  const client = fakeClient();
  const before = { valueMinor: 120000n, currency: 'ILS', participants: 12, tourDate: '2026-07-10' };
  const after = { valueMinor: 150000n, currency: 'ILS', participants: 15, tourDate: '2026-07-12' };
  await recordDealChanges(client, { dealId: 'd1', before, after, origin });

  assert.equal(client.created.length, 1);
  const entry = client.created[0];
  assert.equal(entry.kind, 'change');
  assert.equal(entry.subjectType, 'deal');
  assert.equal(entry.subjectId, 'd1');
  assert.equal(entry.isSystem, true);
  assert.equal(entry.createdByName, 'dor');

  const byKey = Object.fromEntries(entry.data.changes.map((c) => [c.fieldKey, c]));
  assert.equal(entry.data.changes.length, 3);
  // Money: raw minor units + ₪-formatted display.
  assert.equal(byKey.valueMinor.oldValue, 120000);
  assert.equal(byKey.valueMinor.newValue, 150000);
  assert.equal(byKey.valueMinor.oldDisplay, '₪1,200');
  assert.equal(byKey.valueMinor.newDisplay, '₪1,500');
  // Numbers stay raw.
  assert.equal(byKey.participants.oldValue, 12);
  assert.equal(byKey.participants.newValue, 15);
  // tourDate "YYYY-MM-DD" → "DD.MM.YYYY".
  assert.equal(byKey.tourDate.oldDisplay, '10.07.2026');
  assert.equal(byKey.tourDate.newDisplay, '12.07.2026');
});

test('fk change resolves labels via a batched lookup', async () => {
  const client = fakeClient({
    labels: {
      'dealStage:s1': { label: 'ליד' },
      'dealStage:s2': { label: 'הצעה' },
    },
  });
  await recordDealChanges(client, {
    dealId: 'd1',
    before: { dealStageId: 's1' },
    after: { dealStageId: 's2' },
    origin,
  });
  const [c] = client.created[0].data.changes;
  assert.equal(c.fieldKey, 'dealStageId');
  assert.equal(c.labelHe, 'שלב');
  assert.equal(c.oldDisplay, 'ליד');
  assert.equal(c.newDisplay, 'הצעה');
  assert.equal(c.oldValue, 's1');
  assert.equal(c.newValue, 's2');
});

test('status enum displays + null side renders as null display', async () => {
  const client = fakeClient();
  await recordDealChanges(client, {
    dealId: 'd1',
    before: { status: 'open', discountMinor: null, currency: 'ILS' },
    after: { status: 'won', discountMinor: 5000n, currency: 'ILS' },
    origin,
  });
  const byKey = Object.fromEntries(client.created[0].data.changes.map((c) => [c.fieldKey, c]));
  assert.equal(byKey.status.oldDisplay, 'פתוח');
  assert.equal(byKey.status.newDisplay, 'WON');
  assert.equal(byKey.discountMinor.oldDisplay, null);
  assert.equal(byKey.discountMinor.newDisplay, '₪50');
});

test('partial snapshot (price-builder) only diffs keys present on both sides', async () => {
  const client = fakeClient();
  // "before" carries the full tracked set implicitly, but here both sides are
  // the builder's narrow patch — title etc. must not produce phantom changes.
  await recordDealChanges(client, {
    dealId: 'd1',
    before: { valueMinor: 0n, currency: 'ILS', participants: null },
    after: { valueMinor: 80000n, currency: 'ILS', participants: 20, title: 'חדש' },
    origin,
  });
  const keys = client.created[0].data.changes.map((c) => c.fieldKey).sort();
  assert.deepEqual(keys, ['participants', 'valueMinor']);
});

test('changelog failure never throws into the save path', async () => {
  const client = {
    timelineEntry: { create: async () => { throw new Error('db down'); } },
  };
  const out = await recordDealChanges(client, {
    dealId: 'd1',
    before: { title: 'א' },
    after: { title: 'ב' },
    origin,
  });
  assert.equal(out, null);
});

test('contact link/unlink/primary events carry verbal change rows', async () => {
  const client = fakeClient();
  await recordDealContactChange(client, { dealId: 'd1', event: 'linked', contactName: 'דוד כהן', origin });
  await recordDealContactChange(client, { dealId: 'd1', event: 'primary', contactName: 'דנה לוי', oldName: 'דוד כהן', origin });
  assert.equal(client.created.length, 2);
  assert.equal(client.created[0].data.changes[0].fieldKey, 'contactLinked');
  assert.equal(client.created[0].data.changes[0].newDisplay, 'דוד כהן');
  const primary = client.created[1].data.changes[0];
  assert.equal(primary.fieldKey, 'primaryContact');
  assert.equal(primary.oldDisplay, 'דוד כהן');
  assert.equal(primary.newDisplay, 'דנה לוי');
});

test('DEAL_DIFF_SELECT covers id + every tracked field', () => {
  assert.equal(DEAL_DIFF_SELECT.id, true);
  for (const k of ['title', 'status', 'valueMinor', 'tourDate', 'participants', 'dealStageId', 'lostReasonId']) {
    assert.equal(DEAL_DIFF_SELECT[k], true, k);
  }
});
