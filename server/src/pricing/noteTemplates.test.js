// Note-template selection + variable rendering (node:test, pure).

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNoteVars, renderNoteTemplate, selectNoteTemplate, NOTE_VARIABLES } from './noteTemplates.js';

const RULE = { firstLineNote: '<p>הערה לקבוצה אחת</p>', multiGroupNote: '<p>הערה לכמה קבוצות</p>' };

test('template selection: single for 1 group, multi for >1, fallback when multi empty', () => {
  assert.equal(selectNoteTemplate(RULE, 1), RULE.firstLineNote);
  assert.equal(selectNoteTemplate(RULE, 3), RULE.multiGroupNote);
  assert.equal(selectNoteTemplate({ ...RULE, multiGroupNote: null }, 3), RULE.firstLineNote);
  assert.equal(selectNoteTemplate({ ...RULE, multiGroupNote: '<p></p>' }, 2), RULE.firstLineNote);
  assert.equal(selectNoteTemplate({ firstLineNote: null, multiGroupNote: null }, 2), null);
});

// The spec's worked example: groups=3, included 10/group, ₪1,900 per group.
test('rendering: the spec example substitutes exactly, wording untouched', () => {
  const engineResult = {
    grossMinor: 570000,
    breakdown: { unitBaseMinor: 190000, unitQuantity: 3, extra: null },
    debug: { baseParticipants: 10, includedParticipants: 30, baseTotalMinor: 570000, extraParticipants: 0 },
  };
  const vars = buildNoteVars({ engineResult, groupCount: 3, participantCount: 30, variantName: 'סיור גרפיטי', cityName: 'תל אביב' });
  const rendered = renderNoteTemplate(
    '<p>Price is for {{groups}} groups, up to {{includedPerGroup}} participants per group, at ₪{{pricePerGroup}} per group.</p>',
    vars,
  );
  assert.equal(rendered, '<p>Price is for 3 groups, up to 10 participants per group, at ₪1,900 per group.</p>');
});

test('all documented variables substitute; unknown keys render empty', () => {
  const engineResult = {
    grossMinor: 480000,
    breakdown: { unitBaseMinor: 190000, unitQuantity: 2, extra: { quantity: 10, unitPriceMinor: 10000 } },
    debug: { baseParticipants: 10, includedParticipants: 20, baseTotalMinor: 380000, extraParticipants: 10 },
  };
  const vars = buildNoteVars({ engineResult, groupCount: 2, participantCount: 30, variantName: 'המוצר', cityName: 'חיפה' });
  for (const v of NOTE_VARIABLES) {
    assert.equal(typeof vars[v.key], 'string', `var ${v.key} exists`);
  }
  const all = renderNoteTemplate(
    '<p>{{groups}}|{{participants}}|{{includedPerGroup}}|{{includedTotal}}|{{pricePerGroup}}|{{baseTotal}}|{{extraParticipants}}|{{extraPrice}}|{{extraTotal}}|{{lineTotal}}|{{variant}}|{{city}}|{{unknownVar}}</p>',
    vars,
  );
  assert.equal(all, '<p>2|30|10|20|1,900|3,800|10|100|1,000|4,800|המוצר|חיפה|</p>');
});

test('whitespace-tolerant placeholders; missing engine values render empty', () => {
  const vars = buildNoteVars({ engineResult: null, groupCount: 2, participantCount: 12, variantName: '', cityName: '' });
  assert.equal(renderNoteTemplate('<p>{{ groups }} קבוצות, {{participants}} משתתפים, {{pricePerGroup}}</p>', vars),
    '<p>2 קבוצות, 12 משתתפים, </p>');
  assert.equal(renderNoteTemplate('<p></p>', vars), null);
  assert.equal(renderNoteTemplate(null, vars), null);
});
