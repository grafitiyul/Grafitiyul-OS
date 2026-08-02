// The coordination roles decide whether real messages go to real customers, so
// the bar for "yes" is deliberately high and every other answer means silence.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  participantVerdict, roleAnswered, isAffirmative,
  MIN_PARTICIPANTS, MAX_PARTICIPANTS,
} from './coordinationRoles.js';

const q = (key, role) => ({ key, config: { coordinationRole: role } });

const STRUCTURE = [
  q('q_match', 'participant_count_matches'),
  q('q_count', 'corrected_participant_count'),
  q('q_note', 'participant_count_change_note'),
  q('q_mp', 'send_meeting_point_followup'),
  q('q_rest', 'send_restaurant_recommendations'),
];

// ── affirmation ──────────────────────────────────────────────────────────────

test('only a real yes is a yes', () => {
  for (const v of [true, 1, 'true', 'yes', 'כן', ' כן ', 'YES']) {
    assert.equal(isAffirmative(v), true, `${JSON.stringify(v)} is affirmative`);
  }
  for (const v of [false, 0, '', null, undefined, 'no', 'לא', 'maybe', {}, []]) {
    assert.equal(isAffirmative(v), false, `${JSON.stringify(v)} is NOT affirmative`);
  }
});

test('an unmapped role never fires, however the question is worded', () => {
  // A question that asks exactly the right thing but carries no role.
  const questions = [{ key: 'q_x', config: {}, label: { he: 'צריך שנשלח להם את נקודת המפגש שוב?' } }];
  const r = roleAnswered(questions, { q_x: true }, 'send_meeting_point_followup');
  assert.equal(r.mapped, false);
  assert.equal(r.yes, false);
});

test('the role travels with the question, not with the key or the wording', () => {
  const renamed = [{ key: 'q_completely_different', config: { coordinationRole: 'send_restaurant_recommendations' } }];
  const r = roleAnswered(renamed, { q_completely_different: 'כן' }, 'send_restaurant_recommendations');
  assert.equal(r.yes, true);
});

// ── participant verdict ──────────────────────────────────────────────────────

test('matching count reports nothing', () => {
  const v = participantVerdict({ questions: STRUCTURE, answers: { q_match: true }, registered: 13 });
  assert.equal(v.changed, false);
  assert.equal(v.reason, 'matches');
});

test('an unanswered confirmation reports nothing', () => {
  for (const answers of [{}, { q_match: '' }, { q_match: null }]) {
    const v = participantVerdict({ questions: STRUCTURE, answers, registered: 13 });
    assert.equal(v.changed, false, JSON.stringify(answers));
    assert.equal(v.reason, 'unanswered');
  }
});

test('"no" WITHOUT a usable number reports nothing — a shrug is not a correction', () => {
  for (const count of [undefined, '', null, 'הרבה', 0, -3, 1.5, 1000, NaN]) {
    const v = participantVerdict({
      questions: STRUCTURE, answers: { q_match: false, q_count: count }, registered: 13,
    });
    assert.equal(v.changed, false, `count=${JSON.stringify(count)} must not fire`);
    assert.equal(v.reason, 'no_valid_count');
  }
});

test('"no" with the SAME number reports nothing', () => {
  const v = participantVerdict({
    questions: STRUCTURE, answers: { q_match: false, q_count: 13 }, registered: 13,
  });
  assert.equal(v.changed, false);
  assert.equal(v.reason, 'same_number');
});

test('a real change carries the numbers, the signed difference and the note', () => {
  const v = participantVerdict({
    questions: STRUCTURE,
    answers: { q_match: false, q_count: 18, q_note: '  הצטרפו שתי משפחות  ' },
    registered: 13,
  });
  assert.equal(v.changed, true);
  assert.equal(v.registered, 13);
  assert.equal(v.corrected, 18);
  assert.equal(v.delta, 5);
  assert.equal(v.note, 'הצטרפו שתי משפחות', 'the note is trimmed');
});

test('a DROP in participants is reported just as loudly as a rise', () => {
  const v = participantVerdict({
    questions: STRUCTURE, answers: { q_match: false, q_count: 4 }, registered: 13,
  });
  assert.equal(v.changed, true);
  assert.equal(v.delta, -9);
});

test('the numeric bounds are the stated ones', () => {
  const at = (n) => participantVerdict({
    questions: STRUCTURE, answers: { q_match: false, q_count: n }, registered: 999999,
  }).changed;
  assert.equal(at(MIN_PARTICIPANTS), true);
  assert.equal(at(MAX_PARTICIPANTS), true);
  assert.equal(at(MIN_PARTICIPANTS - 1), false, 'zero is a cancellation, not a correction');
  assert.equal(at(MAX_PARTICIPANTS + 1), false, 'four digits is a typo');
});

test('a string number from a form field is accepted', () => {
  const v = participantVerdict({
    questions: STRUCTURE, answers: { q_match: false, q_count: '18' }, registered: 13,
  });
  assert.equal(v.changed, true);
  assert.equal(v.corrected, 18);
});

test('with no confirmation question mapped at all, nothing ever fires', () => {
  const v = participantVerdict({ questions: [], answers: { anything: false }, registered: 13 });
  assert.equal(v.changed, false);
  assert.equal(v.reason, 'unmapped');
});
