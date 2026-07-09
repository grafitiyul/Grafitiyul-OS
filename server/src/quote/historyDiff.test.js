import test from 'node:test';
import assert from 'node:assert/strict';
import { diffQuoteSnapshots } from './historyDiff.js';

// Pin the history-diff contract: block-level comparison of two frozen public
// models, Hebrew labels, participants split out of the technical details.

const block = (key, type, data, hidden = false) => ({ key, type, hidden, data });
const model = (blocks, language = 'he') => ({ language, blocks });

test('diff: null baseline (first version / legacy) → null', () => {
  assert.equal(diffQuoteSnapshots(null, model([])), null);
  assert.equal(diffQuoteSnapshots(model([]), null), null);
});

test('diff: identical snapshots → no changes', () => {
  const m = model([block('pricing', 'pricing', { totals: { grossMinor: 100000 } })]);
  assert.deepEqual(diffQuoteSnapshots(m, m), []);
});

test('diff: price + FAQ + product description changes are labeled', () => {
  const prev = model([
    block('pricing', 'pricing', { totals: { grossMinor: 100000 } }),
    block('faq', 'faq', { items: [{ id: 1, html: '<p>א</p>' }] }),
    block('product_marketing', 'product_marketing', { html: '<p>ישן</p>' }),
    block('program', 'program', { html: '<p>זהה</p>' }),
  ]);
  const next = model([
    block('pricing', 'pricing', { totals: { grossMinor: 120000 } }),
    block('faq', 'faq', { items: [{ id: 1, html: '<p>ב</p>' }] }),
    block('product_marketing', 'product_marketing', { html: '<p>חדש</p>' }),
    block('program', 'program', { html: '<p>זהה</p>' }),
  ]);
  assert.deepEqual(diffQuoteSnapshots(prev, next).sort(), ['מחיר', 'שאלות נפוצות', 'תיאור המוצר'].sort());
});

test('diff: participants split out of technical details', () => {
  const prev = model([block('tour_details', 'tour_details', { participants: 30, city: 'ת"א' })]);
  const nextOnlyParticipants = model([block('tour_details', 'tour_details', { participants: 45, city: 'ת"א' })]);
  const nextBoth = model([block('tour_details', 'tour_details', { participants: 45, city: 'חיפה' })]);
  assert.deepEqual(diffQuoteSnapshots(prev, nextOnlyParticipants), ['משתתפים']);
  assert.deepEqual(diffQuoteSnapshots(prev, nextBoth).sort(), ['משתתפים', 'פרטים טכניים'].sort());
});

test('diff: both image slots dedupe to one "תמונות"; video + language labeled', () => {
  const prev = model([
    block('image_slot_1', 'image_slot_1', { imageUrl: 'a.jpg' }),
    block('image_slot_2', 'image_slot_2', { imageUrl: 'b.jpg' }),
    block('video', 'video', { url: 'https://youtu.be/x' }),
  ], 'he');
  const next = model([
    block('image_slot_1', 'image_slot_1', { imageUrl: 'c.jpg' }),
    block('image_slot_2', 'image_slot_2', { imageUrl: 'd.jpg' }),
    block('video', 'video', { url: 'https://youtu.be/y' }),
  ], 'en');
  assert.deepEqual(diffQuoteSnapshots(prev, next).sort(), ['וידאו', 'שפה', 'תמונות'].sort());
});

test('diff: hiding a section counts as a change to it; signature ignored', () => {
  const prev = model([
    block('cancellation', 'cancellation', { items: [{ id: 1, html: '<p>x</p>' }] }),
    block('signature', 'signature', { a: 1 }),
  ]);
  const next = model([
    block('cancellation', 'cancellation', { items: [{ id: 1, html: '<p>x</p>' }] }, true),
    block('signature', 'signature', { a: 2 }),
  ]);
  assert.deepEqual(diffQuoteSnapshots(prev, next), ['מדיניות ביטול']);
});
