import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecipients, guideLanguage, fillRemainingTokens } from './guideMessage.js';

const person = (over = {}) => ({
  id: 'p1', displayName: 'דנה כהן', phone: '0521234567', profile: null, ...over,
});

const assignment = (over = {}) => ({
  id: `a-${over.role || 'guide'}-${over.personRef?.id || 'x'}`,
  role: 'guide',
  displayName: over.personRef?.displayName || 'מדריך',
  externalPersonId: 'guide:x',
  personRef: person(),
  ...over,
});

test('only GUIDE roles are candidates — a workshop assistant is not', () => {
  const { recipients } = buildRecipients({
    assignments: [
      assignment({ role: 'guide', personRef: person({ id: 'g1', displayName: 'דנה' }) }),
      assignment({ role: 'workshop_assistant', personRef: person({ id: 'w1', displayName: 'עוזר' }) }),
    ],
  });
  assert.deepEqual(recipients.map((r) => r.personRefId), ['g1']);
});

test('the lead guide is the default when there is one', () => {
  const { defaultPersonRefId } = buildRecipients({
    assignments: [
      assignment({ role: 'guide', personRef: person({ id: 'g1' }) }),
      assignment({ role: 'lead_guide', personRef: person({ id: 'lead' }) }),
    ],
  });
  assert.equal(defaultPersonRefId, 'lead');
});

test('the guide who submitted the summary wins over the lead guide', () => {
  const submitter = person({ id: 'g1', displayName: 'דנה' });
  const { defaultPersonRefId, recipients } = buildRecipients({
    assignments: [
      assignment({ role: 'guide', personRef: submitter }),
      assignment({ role: 'lead_guide', personRef: person({ id: 'lead' }) }),
    ],
    submitter,
  });
  assert.equal(defaultPersonRefId, 'g1');
  assert.equal(recipients.find((r) => r.personRefId === 'g1').submittedSummary, true);
});

test('two guides and no lead ⇒ NO default: the operator must choose', () => {
  const { defaultPersonRefId, recipients } = buildRecipients({
    assignments: [
      assignment({ role: 'guide', personRef: person({ id: 'g1' }) }),
      assignment({ role: 'guide', personRef: person({ id: 'g2' }) }),
    ],
  });
  assert.equal(defaultPersonRefId, null);
  assert.equal(recipients.length, 2);
});

test('a summary author no longer on the roster is still offered', () => {
  const submitter = person({ id: 'gone', displayName: 'מדריך קודם' });
  const { recipients, defaultPersonRefId } = buildRecipients({
    assignments: [assignment({ role: 'lead_guide', personRef: person({ id: 'lead' }) })],
    submitter,
  });
  assert.deepEqual(recipients.map((r) => r.personRefId).sort(), ['gone', 'lead']);
  assert.equal(defaultPersonRefId, 'gone');
});

test('eligibility is stated, not hidden — and an unsendable guide never becomes the default', () => {
  const noPhone = person({ id: 'g1', phone: null });
  const { recipients, defaultPersonRefId } = buildRecipients({
    assignments: [assignment({ role: 'lead_guide', personRef: noPhone })],
    submitter: noPhone,
  });
  assert.equal(recipients[0].state, 'missing_phone');
  assert.equal(recipients[0].canSend, false);
  assert.equal(defaultPersonRefId, null);
});

test('a bad phone is invalid_phone, not a silent send', () => {
  const { recipients } = buildRecipients({
    assignments: [assignment({ role: 'guide', personRef: person({ id: 'g1', phone: '123' }) })],
  });
  assert.equal(recipients[0].state, 'invalid_phone');
  assert.equal(recipients[0].canSend, false);
});

test('an assignment never linked to a GOS person has nothing to write to', () => {
  const { recipients } = buildRecipients({
    assignments: [assignment({ role: 'guide', personRef: null, displayName: 'מדריך היסטורי' })],
  });
  assert.equal(recipients[0].state, 'no_person');
  assert.equal(recipients[0].canSend, false);
});

test('language comes from the recorded profile, Hebrew when nothing was recorded', () => {
  assert.equal(guideLanguage(person({ profile: { preferredLanguage: 'en' } })), 'en');
  assert.equal(guideLanguage(person({ profile: { preferredLanguage: 'he' } })), 'he');
  assert.equal(guideLanguage(person({ profile: null })), 'he');
  assert.equal(guideLanguage(null), 'he');
});

// ── fillRemainingTokens — the "no raw moustache reaches a guide" guarantee ────

const ctx = {
  nowMs: Date.parse('2026-08-07T12:00:00Z'),
  staff: { person: person({ displayName: 'דנה כהן' }), portalUrl: null },
  tour: { date: '2026-08-06', startTime: '10:00' },
  deal: null,
  contact: null,
  org: null,
};

test('already-resolved text passes through untouched', () => {
  const out = fillRemainingTokens('היי דנה, תודה על הסיכום מאתמול!', ctx, 'he');
  assert.equal(out.text, 'היי דנה, תודה על הסיכום מאתמול!');
  assert.deepEqual(out.unknown, []);
});

test('a hand-typed token resolves like a chip — including the natural date', () => {
  const out = fillRemainingTokens('היי {{staff_first_name}}, הסיור של {{tour_date_natural}}', ctx, 'he');
  assert.equal(out.text, 'היי דנה, הסיור של אתמול');
  assert.deepEqual(out.unknown, []);
});

test('a guide-flavoured alias resolves to the canonical value', () => {
  const out = fillRemainingTokens('היי {{guide_first_name}}', ctx, 'he');
  assert.equal(out.text, 'היי דנה');
});

test('a token this audience cannot resolve is REPORTED, never blanked', () => {
  const out = fillRemainingTokens('שלום {{payment_link}}', ctx, 'he');
  assert.deepEqual(out.unknown, ['payment_link']);
  // Left visible so the caller can refuse the send outright.
  assert.match(out.text, /\{\{payment_link\}\}/);
});

test('a supported variable with no value empties cleanly instead of shipping moustache', () => {
  const bare = { ...ctx, tour: { date: null, startTime: null }, deal: null };
  const out = fillRemainingTokens('הסיור בשעה {{tour_time}} .', bare, 'he');
  assert.ok(!out.text.includes('{{'), 'no raw token survives');
  assert.ok(out.missing.includes('tour_time'));
});

// ── Staff names are LANGUAGE-AWARE (canonical shared/staffName.mjs) ──────────
//
// The registry used to split PersonRef.displayName, which cannot answer an
// English message at all: a guide with an English name on file still got
// greeted in Hebrew. These pin the canonical rule — each language uses its own
// name, the other language beats nothing, displayName is the legacy fallback.

const withProfile = (profile) => ({
  ...ctx,
  staff: { person: { displayName: 'רפאל ויללה', profile }, portalUrl: null },
});

test('an English message uses the English name when one is recorded', () => {
  const c = withProfile({ firstNameHe: 'רפאל', lastNameHe: 'ויללה', firstNameEn: 'Rafael', lastNameEn: 'Villela' });
  assert.equal(fillRemainingTokens('Hi {{staff_first_name}}', c, 'en').text, 'Hi Rafael');
  assert.equal(fillRemainingTokens('היי {{staff_first_name}}', c, 'he').text, 'היי רפאל');
  assert.equal(fillRemainingTokens('{{staff_full_name}}', c, 'en').text, 'Rafael Villela');
  assert.equal(fillRemainingTokens('{{staff_full_name}}', c, 'he').text, 'רפאל ויללה');
});

test('a colleague with only a Hebrew name keeps it in English — a name beats a blank', () => {
  const c = withProfile({ firstNameHe: 'דנה', lastNameHe: 'כהן' });
  assert.equal(fillRemainingTokens('Hi {{staff_first_name}}', c, 'en').text, 'Hi דנה');
});

test('no profile at all falls back to the legacy display name, never to empty', () => {
  const c = withProfile(null);
  assert.equal(fillRemainingTokens('היי {{staff_first_name}}', c, 'he').text, 'היי רפאל');
  assert.equal(fillRemainingTokens('{{staff_full_name}}', c, 'he').text, 'רפאל ויללה');
});
