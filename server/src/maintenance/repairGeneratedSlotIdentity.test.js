import test from 'node:test';
import assert from 'node:assert/strict';
import { repairGeneratedSlotIdentity } from './repairGeneratedSlotIdentity.js';
import { israelToday, addDays, weekdayOf } from '../tours/slotGeneration.js';

// The generated-slot identity repair over an in-memory store. Covers the three
// live cases: re-attribute a dead-rule slot, reopen a date whose cancel was
// deleted (16/07), and LEAVE a date already served by a manual replacement (17/07).

const OCC = addDays(israelToday(), 2);
const OCC_WD = weekdayOf(OCC);
const OTHER = addDays(israelToday(), 3); // a different date, same horizon (may or may not match)

function fakeClient({ template, rows }) {
  const store = rows.map((r, i) => ({ id: r.id || `r${i}`, kind: 'group_slot', ...r }));
  let seq = 0;
  const active = (x) => x.status === 'scheduled' || x.status === 'completed';
  const match = (x, w) => {
    for (const [k, v] of Object.entries(w)) {
      if (k === 'status' && v?.in) { if (!v.in.includes(x.status)) return false; continue; }
      if (k === 'date' && v?.gte) { if (!(x.date >= v.gte)) return false; continue; }
      if (x[k] !== v) return false;
    }
    return true;
  };
  return {
    _rows: store,
    openTourTemplate: { findMany: async () => [template] },
    tourSettings: { upsert: async () => ({ defaultCapacity: 30, generateDaysAhead: 6 }) },
    tourEvent: {
      findMany: async ({ where }) => store.filter((x) => match(x, where)).map((x) => ({ ...x, _count: { wooVariationLinks: x.links || 0 } })),
      findFirst: async ({ where, orderBy }) => { let h = store.filter((x) => match(x, where)); if (orderBy?.createdAt === 'desc') h = h.reverse(); return h[0] ? { ...h[0] } : null; },
      count: async ({ where }) => store.filter((x) => match(x, where)).length,
      update: async ({ where, data }) => { const r = store.find((x) => x.id === where.id); if (r) Object.assign(r, data); return r; },
      createMany: async ({ data, skipDuplicates }) => {
        let count = 0;
        for (const r of data) {
          if (skipDuplicates && r.status === 'scheduled' && store.some((x) => active(x) && x.kind === 'group_slot' && x.openTourTemplateId === r.openTourTemplateId && x.date === r.date && x.startTime === r.startTime)) continue;
          store.push({ id: `n${seq++}`, ...r }); count += 1;
        }
        return { count };
      },
    },
    tourEventActivityComponent: { createMany: async () => ({ count: 0 }) },
    productVariantActivityComponent: { findMany: async () => [] },
  };
}

const template = {
  id: 'tpl1', active: true, tourLanguage: 'he', capacity: null, locationId: null, products: [],
  scheduleRules: [{ id: 'current', weekday: OCC_WD, startTime: '18:00' }],
  exceptions: [],
};

test('re-attributes a live scheduled slot owned by a DEAD rule to the current rule', async () => {
  const client = fakeClient({
    template,
    rows: [{ id: 'live', openTourTemplateId: 'tpl1', date: OCC, startTime: '18:00', status: 'scheduled', generatedByRuleId: 'dead' }],
  });
  const r = await repairGeneratedSlotIdentity(client, { log() {}, warn() {} });
  assert.equal(r.reattributed.length, 1);
  assert.equal(client._rows.find((x) => x.id === 'live').generatedByRuleId, 'current');
});

test('reopens a required date with no active occurrence (16/07)', async () => {
  const client = fakeClient({
    template,
    rows: [
      { id: 'deadTwin', openTourTemplateId: 'tpl1', date: OCC, startTime: '18:00', status: 'cancelled', generatedByRuleId: 'dead', links: 4, createdAt: '2026-07-13T08:15Z' },
      { id: 'ownTwin', openTourTemplateId: 'tpl1', date: OCC, startTime: '18:00', status: 'cancelled', generatedByRuleId: 'current', links: 4, createdAt: '2026-07-13T08:16Z' },
    ],
  });
  const r = await repairGeneratedSlotIdentity(client, { log() {}, warn() {} });
  assert.equal(r.reopened.length, 1);
  const active = client._rows.filter((x) => x.date === OCC && x.status === 'scheduled');
  assert.equal(active.length, 1, 'exactly one reopened');
  assert.equal(active[0].id, 'ownTwin', 'the current-rule twin is revived; the dead-rule twin stays cancelled');
  assert.equal(client._rows.find((x) => x.id === 'deadTwin').status, 'cancelled');
});

test('does NOT reopen a date already served by a manual replacement (17/07)', async () => {
  const client = fakeClient({
    template,
    rows: [
      { id: 'manual', openTourTemplateId: 'tpl1', date: OCC, startTime: '13:00', status: 'scheduled', generatedByRuleId: null },
      { id: 'cancelledOld', openTourTemplateId: 'tpl1', date: OCC, startTime: '18:00', status: 'cancelled', generatedByRuleId: 'current', links: 4 },
    ],
  });
  const r = await repairGeneratedSlotIdentity(client, { log() {}, warn() {} });
  const active = client._rows.filter((x) => x.date === OCC && x.status === 'scheduled');
  assert.equal(active.length, 1, 'still only the manual replacement');
  assert.equal(active[0].id, 'manual');
  assert.equal(client._rows.find((x) => x.id === 'cancelledOld').status, 'cancelled', 'old 18:00 stays cancelled');
  assert.equal(r.reopened.length, 0);
});

test('idempotent: a fully-canonical template needs no changes', async () => {
  const client = fakeClient({
    template,
    rows: [{ id: 'good', openTourTemplateId: 'tpl1', date: OCC, startTime: '18:00', status: 'scheduled', generatedByRuleId: 'current' }],
  });
  const r = await repairGeneratedSlotIdentity(client, { log() {}, warn() {} });
  assert.equal(r.reattributed.length, 0);
  assert.equal(r.reopened.length, 0);
  assert.equal(r.created.length, 0);
});
