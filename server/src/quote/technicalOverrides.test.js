import test from 'node:test';
import assert from 'node:assert/strict';
import { techFieldOverrides, assembleComposition } from './composer.js';

// Technical Details is structured FACTS, so its per-quote override is per field
// and per language — a duration reads "3 שעות" or "3 hours", and one stored
// string would be wrong in one of them.

test('only the requested language is read', () => {
  const ov = { fields: { he: { duration: '4 שעות' }, en: { duration: '4 hours' } } };
  assert.deepEqual(techFieldOverrides(ov, 'he'), { duration: '4 שעות' });
  assert.deepEqual(techFieldOverrides(ov, 'en'), { duration: '4 hours' });
});

test('a language with no overrides of its own reads as none — never the other language', () => {
  assert.equal(techFieldOverrides({ fields: { he: { duration: '4 שעות' } } }, 'en'), null);
});

test('blank and non-string values are not overrides', () => {
  const ov = { fields: { he: { duration: '   ', city: '', participants: 12, time: null, date: '01.01.2027' } } };
  assert.deepEqual(techFieldOverrides(ov, 'he'), { date: '01.01.2027' });
});

test('values are trimmed, and unknown keys can never be injected', () => {
  const ov = { fields: { he: { city: '  חיפה  ', __proto__: 'x', notAField: 'y' } } };
  assert.deepEqual(techFieldOverrides(ov, 'he'), { city: 'חיפה' });
});

test('no override state at all reads as none', () => {
  assert.equal(techFieldOverrides(null, 'he'), null);
  assert.equal(techFieldOverrides({}, 'he'), null);
  assert.equal(techFieldOverrides({ fields: {} }, 'he'), null);
  assert.equal(techFieldOverrides({ fields: { he: {} } }, 'he'), null);
});

// ── through the real composer ───────────────────────────────────────────────

const deal = {
  id: 'd1', currency: 'ILS', valueMinor: 100000,
  tourDate: '2026-09-01', tourTime: '17:00', participants: 12, durationHours: 3, tourLanguage: 'he',
  location: { nameHe: 'תל אביב', nameEn: 'Tel Aviv' },
};

function compose(overrideState, lang = 'he') {
  const model = assembleComposition({
    document: { id: 'qd1', overrideState },
    deal, version: { id: 'qv1' }, lines: [], quoteSections: [], lang,
  });
  return model.blocks.find((b) => b.type === 'tour_details');
}

test('the block carries the override to the renderer, and is marked as edited', () => {
  const b = compose({ blocks: { tour_details: { fields: { he: { duration: '~4 שעות' } } } } });
  assert.deepEqual(b.data.fieldOverrides, { duration: '~4 שעות' });
  assert.equal(b.overridden, true);
});

test('the CANONICAL values are left completely untouched underneath', () => {
  // The override is presentation. Everything downstream of this block — the
  // Deal, the tour, the operational plan, the confirmation email — still reads
  // the real numbers, and so does the model itself.
  const b = compose({ blocks: { tour_details: { fields: { he: { duration: '~4 שעות', participants: '20' } } } } });
  assert.equal(b.data.durationHours, 3, 'the real duration is still 3');
  assert.equal(b.data.participants, 12, 'the real headcount is still 12');
  assert.equal(b.data.tourDate, '2026-09-01');
});

test('no override → the block is byte-identical to before and not marked edited', () => {
  const b = compose(null);
  assert.equal(b.data.fieldOverrides, undefined);
  assert.equal(b.overridden, false);
});

test('an override written for Hebrew does not leak into an English quote', () => {
  const state = { blocks: { tour_details: { fields: { he: { city: 'חיפה' } } } } };
  assert.equal(compose(state, 'en').data.fieldOverrides, undefined);
  assert.deepEqual(compose(state, 'he').data.fieldOverrides, { city: 'חיפה' });
});

test('clearing every field of a language removes the override entirely', () => {
  const b = compose({ blocks: { tour_details: { fields: { he: {} } } } });
  assert.equal(b.data.fieldOverrides, undefined);
  assert.equal(b.overridden, false);
});

test('a prose override on another section is unaffected by any of this', () => {
  const model = assembleComposition({
    document: { id: 'qd1', overrideState: { blocks: { program: { html: '<p>מותאם</p>' } } } },
    deal, version: { id: 'qv1' }, lines: [], quoteSections: [], lang: 'he',
  });
  const program = model.blocks.find((b) => b.key === 'program');
  assert.equal(program.data.html, '<p>מותאם</p>');
  assert.equal(program.overridden, true);
});
