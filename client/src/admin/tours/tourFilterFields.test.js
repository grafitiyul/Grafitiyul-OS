import test from 'node:test';
import assert from 'node:assert/strict';
import { TOUR_FILTER_FIELDS, TOUR_FILTER_FIELDS_BY_KEY } from './tourFilterFields.js';
import { evaluateTree } from '../common/filters/advancedFilterCore.js';

// Field registry over the tours LIST DTO shape (compact staff summaries).

const F = TOUR_FILTER_FIELDS_BY_KEY;
const cond = (field, operator, value) => ({ kind: 'condition', field, operator, value });
const group = (op, ...children) => ({ kind: 'group', op, children });

const TOUR = {
  date: '2026-08-10',
  startTime: '10:00',
  kind: 'business',
  status: 'scheduled',
  tourLanguage: 'en',
  notes: 'להביא רמקול',
  product: { nameHe: 'סיור גרפיטי' },
  location: { nameHe: 'תל אביב' },
  leadGuide: { name: 'שיר זמיר', role: 'lead_guide' },
  guides: [{ name: 'דנה לוי', role: 'guide' }],
  workshopAssistants: [],
  team: [
    { name: 'שיר זמיר', role: 'lead_guide' },
    { name: 'דנה לוי', role: 'guide' },
  ],
};

test('role-scoped staff fields match only their role', () => {
  // שיר is the LEAD — the plain guide field must not match her.
  assert.equal(F.guide.match(TOUR, 'is', 'שיר זמיר'), false);
  assert.equal(F.guide.match(TOUR, 'is', 'דנה לוי'), true);
  assert.equal(F.leadGuide.match(TOUR, 'is', 'שיר זמיר'), true);
  assert.equal(F.leadGuide.match(TOUR, 'is', 'דנה לוי'), false);
  assert.equal(F.workshopAssistant.match(TOUR, 'is', 'שיר זמיר'), false);
  // Any role matches both.
  assert.equal(F.anyStaff.match(TOUR, 'is', 'שיר זמיר'), true);
  assert.equal(F.anyStaff.match(TOUR, 'is', 'דנה לוי'), true);
  assert.equal(F.anyStaff.match(TOUR, 'isNot', 'מישהו אחר'), true);
});

test('the owner example: guide OR lead-guide = שיר, via one OR group', () => {
  const tree = group('or', cond('guide', 'is', 'שיר זמיר'), cond('leadGuide', 'is', 'שיר זמיר'));
  assert.equal(evaluateTree(tree, TOUR, F), true);
  const asGuideOnly = { ...TOUR, leadGuide: null, guides: [{ name: 'שיר זמיר' }] };
  assert.equal(evaluateTree(tree, asGuideOnly, F), true);
  const neither = { ...TOUR, leadGuide: { name: 'אחר' }, guides: [] };
  assert.equal(evaluateTree(tree, neither, F), false);
});

test('the owner example: guide = דנה AND activity type = business', () => {
  const tree = group('and', cond('guide', 'is', 'דנה לוי'), cond('kind', 'is', 'business'));
  assert.equal(evaluateTree(tree, TOUR, F), true);
  assert.equal(evaluateTree(tree, { ...TOUR, kind: 'private' }, F), false);
});

test('staffRole presence field', () => {
  assert.equal(F.staffRole.match(TOUR, 'is', 'lead_guide'), true);
  assert.equal(F.staffRole.match(TOUR, 'is', 'workshop_assistant'), false);
  assert.equal(F.staffRole.match(TOUR, 'isNot', 'workshop_assistant'), true);
});

test('date and time ranges', () => {
  assert.equal(F.date.match(TOUR, 'between', { from: '2026-08-01', to: '2026-08-31' }), true);
  assert.equal(F.date.match(TOUR, 'before', '2026-08-01'), false);
  assert.equal(F.startTime.match(TOUR, 'after', '09:00'), true);
  assert.equal(F.startTime.match(TOUR, 'between', { from: '11:00', to: '12:00' }), false);
});

test('select fields: product / city / language / status; text: notes', () => {
  assert.equal(F.product.match(TOUR, 'is', 'סיור גרפיטי'), true);
  assert.equal(F.city.match(TOUR, 'is', 'תל אביב'), true);
  assert.equal(F.city.match(TOUR, 'isNot', 'ירושלים'), true);
  assert.equal(F.language.match(TOUR, 'is', 'en'), true);
  assert.equal(F.status.match(TOUR, 'is', 'scheduled'), true);
  assert.equal(F.notes.match(TOUR, 'contains', 'רמקול'), true);
  assert.equal(F.notes.match(TOUR, 'contains', 'אין'), false);
});

test('staff options derive from the loaded rows (sorted, distinct)', () => {
  const rows = [TOUR, { ...TOUR, team: [{ name: 'אבי כהן', role: 'guide' }] }];
  const opts = F.anyStaff.options(rows).map((o) => o.value);
  assert.deepEqual(opts, ['אבי כהן', 'דנה לוי', 'שיר זמיר']);
});

test('city falls back to the variant location', () => {
  const t = { ...TOUR, location: null, productVariant: { location: { nameHe: 'חיפה' } } };
  assert.equal(F.city.match(t, 'is', 'חיפה'), true);
});

test('every field has a label and a matcher (registry sanity)', () => {
  for (const f of TOUR_FILTER_FIELDS) {
    assert.ok(f.key && f.label && typeof f.match === 'function', f.key);
  }
});
