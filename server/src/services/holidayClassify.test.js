import test from 'node:test';
import assert from 'node:assert/strict';
import { markPatch, planImport, ruleFromRow, normalizeHolidayKey, EREV_START_MINUTE } from './holidayClassify.js';

const fetched = {
  externalId: '2026-09-11|Erev Rosh Hashana',
  nameHe: 'ערב ראש השנה', nameEn: 'Erev Rosh Hashana',
  date: '2026-09-11', type: 'erev_chag', allDay: false, startMinute: 1080, endMinute: null,
  sourceName: 'Erev Rosh Hashana',
};

test('mark as ערב חג defaults to 15:00 → end of day', () => {
  const p = markPatch('mark_erev');
  assert.equal(p.type, 'erev_chag');
  assert.equal(p.startMinute, EREV_START_MINUTE); // 900 = 15:00
  assert.equal(p.startMinute, 900);
  assert.equal(p.endMinute, null); // end of day
  assert.equal(p.allDay, false);
  assert.equal(p.status, 'approved');
});
test('mark as יום חג → all-day chag, approved', () => {
  const p = markPatch('mark_chag');
  assert.equal(p.type, 'chag');
  assert.equal(p.allDay, true);
  assert.equal(p.startMinute, null);
  assert.equal(p.status, 'approved');
});
test('markPatch ignores non-mark actions', () => {
  assert.equal(markPatch('ignore'), null);
});

test('future import gets the same classification (auto-approved erev 15:00)', () => {
  const rule = ruleFromRow({ type: 'erev_chag', startMinute: 900, endMinute: null });
  const plan = planImport({ existing: null, fetched, rule });
  assert.equal(plan.op, 'create');
  assert.equal(plan.data.type, 'erev_chag');
  assert.equal(plan.data.startMinute, 900);
  assert.equal(plan.data.endMinute, null);
  assert.equal(plan.data.status, 'approved');
  assert.equal(plan.data.reviewedBy, 'system');
});

test('manually-edited rows are NOT overwritten (mirror only)', () => {
  const existing = { id: 'x', status: 'pending', manuallyEdited: true, type: 'other' };
  const plan = planImport({ existing, fetched, rule: ruleFromRow({ type: 'erev_chag', startMinute: 900, endMinute: null }) });
  assert.equal(plan.op, 'mirror');
  assert.deepEqual(Object.keys(plan.data).sort(), ['sourceDate', 'sourceName']);
  assert.equal(plan.data.type, undefined); // type untouched
});

test('approved rows are NOT overwritten (mirror only)', () => {
  const existing = { id: 'x', status: 'approved', manuallyEdited: false };
  const plan = planImport({ existing, fetched, rule: ruleFromRow({ type: 'chag', startMinute: null, endMinute: null }) });
  assert.equal(plan.op, 'mirror');
});

test('pending + rule → refresh and auto-approve', () => {
  const existing = { id: 'x', status: 'pending', manuallyEdited: false };
  const plan = planImport({ existing, fetched, rule: ruleFromRow({ type: 'chag', startMinute: null, endMinute: null }) });
  assert.equal(plan.op, 'refresh');
  assert.equal(plan.data.type, 'chag');
  assert.equal(plan.data.status, 'approved');
});

test('new + no rule → pending', () => {
  const plan = planImport({ existing: null, fetched, rule: null });
  assert.equal(plan.op, 'create');
  assert.equal(plan.data.status, 'pending');
});

test('normalizeHolidayKey trims to the stable title', () => {
  assert.equal(normalizeHolidayKey('  Erev Rosh Hashana '), 'Erev Rosh Hashana');
});
