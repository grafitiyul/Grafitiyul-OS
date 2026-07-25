import test from 'node:test';
import assert from 'node:assert/strict';
import { toEventForm, isEventFormDirty, reconcileEventForm } from './eventFormState.js';

const server = (over = {}) => ({
  id: 'ev1', internalName: 'אירוע', description: null, status: 'draft',
  triggerType: 'deal_won', anchorType: 'trigger_time', timingMode: 'immediate',
  timingAmount: null, timingUnit: null, activityMode: 'all', activityTypes: [],
  orgTypeIds: [], orgSubtypeIds: [], conditions: null, messages: [],
  ...over,
});

test('REGRESSION: delayed refresh must not wipe a typed short description', () => {
  // 1. Editor hydrates from the first server snapshot.
  const s1 = server();
  let form = toEventForm(s1);
  // 2. The user types into "תיאור קצר" (form is now dirty).
  form = { ...form, description: 'תיאור חשוב שנכתב עכשיו' };
  assert.equal(isEventFormDirty(form, s1), true);
  // 3. A delayed fetch / child-triggered reload arrives with stale server data.
  const s2 = server({ messages: [{ id: 'm1' }] });
  const next = reconcileEventForm(form, s1, s2);
  // The typed content SURVIVES — this exact scenario previously lost it.
  assert.equal(next.description, 'תיאור חשוב שנכתב עכשיו');
});

test('clean form rehydrates from fresh server data', () => {
  const s1 = server();
  const form = toEventForm(s1);
  const s2 = server({ description: 'עודכן ממכשיר אחר' });
  const next = reconcileEventForm(form, s1, s2);
  assert.equal(next.description, 'עודכן ממכשיר אחר');
});

test('force rehydrates even a dirty form (explicit save path)', () => {
  const s1 = server();
  const dirty = { ...toEventForm(s1), description: 'טיוטה' };
  const s2 = server({ description: 'טיוטה' }); // the save landed
  const next = reconcileEventForm(dirty, s1, s2, { force: true });
  assert.equal(next.description, 'טיוטה');
  assert.equal(isEventFormDirty(next, s2), false);
});

test('null description hydrates as empty string (controlled input safe)', () => {
  assert.equal(toEventForm(server()).description, '');
});

test('dirty check covers nested applicability fields', () => {
  const s1 = server();
  const form = { ...toEventForm(s1), activityTypes: ['business'] };
  assert.equal(isEventFormDirty(form, s1), true);
  const kept = reconcileEventForm(form, s1, server({ status: 'active' }));
  assert.deepEqual(kept.activityTypes, ['business']);
});
