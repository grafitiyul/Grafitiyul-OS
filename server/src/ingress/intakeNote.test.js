// Intake note — the acceptance contract for what an operator reads first.
//
// These lock the guarantees the note exists to provide: every submitted answer
// survives, order is the customer's, blank-but-asked is visibly different from
// never-asked, source context is present, and nothing sensitive leaks in.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFormAnswers, toCanonicalEvent } from './adapters/meta.js';
import { normalizeEvent } from './normalize.js';
import { buildIntakeNoteBody } from './records.js';

const FIELD_DATA = [
  { name: 'full_name', label: 'שם מלא', values: ['ישראל ישראלי'] },
  { name: 'phone_number', label: 'טלפון', values: ['050-123-4567'] },
  { name: 'email', label: 'אימייל', values: ['israel@example.co.il'] },
  { name: 'כמות משתתפים', label: 'כמה משתתפים?', values: ['25'] },
  // Asked, deliberately left blank by the customer.
  { name: 'הודעה', label: 'הערות', values: [''] },
  // Unmapped — no structured GOS field exists for these.
  { name: 'preferred_area', label: 'באיזה אזור?', values: ['תל אביב והמרכז'] },
  { name: 'budget_range', label: 'טווח תקציב', values: ['5,000-10,000 ₪'] },
];

const LEAD = {
  leadgenId: '1122334455',
  pageId: '557050430995914',
  formId: '3851739504971671',
  adId: '120200000000000001',
  adgroupId: '120200000000000002',
  campaignId: '120200000000000003',
  createdTime: new Date('2026-07-29T09:00:00Z'),
};

const DETAILS = {
  id: '1122334455',
  created_time: '2026-07-29T09:00:00+0000',
  field_data: FIELD_DATA,
  ad_id: LEAD.adId,
  adset_id: LEAD.adgroupId,
  campaign_id: LEAD.campaignId,
  form_id: LEAD.formId,
  platform: 'fb',
};

const build = () => normalizeEvent(toCanonicalEvent(DETAILS, LEAD));

test('form answers: every field survives, in the customer’s original order', () => {
  const a = buildFormAnswers(FIELD_DATA);
  assert.equal(a.length, FIELD_DATA.length);
  assert.deepEqual(
    a.map((x) => x.key),
    FIELD_DATA.map((f) => f.name),
  );
});

test('form answers: fields with no structured GOS equivalent are kept', () => {
  const keys = buildFormAnswers(FIELD_DATA).map((x) => x.key);
  assert.ok(keys.includes('preferred_area'));
  assert.ok(keys.includes('budget_range'));
});

test('form answers: asked-but-blank is distinct from never-asked', () => {
  const answers = buildFormAnswers(FIELD_DATA);
  const blank = answers.find((x) => x.key === 'הודעה');
  assert.equal(blank.answered, false);
  assert.equal(blank.value, null);
  assert.equal(answers.find((x) => x.key === 'never_asked'), undefined);
});

test('form answers: multi-value answers are joined, never truncated', () => {
  const a = buildFormAnswers([{ name: 'days', label: 'ימים', values: ['ראשון', 'שני'] }]);
  assert.equal(a[0].value, 'ראשון, שני');
});

test('structured mapping: Hebrew-aliased fields land on the contract', () => {
  const n = build();
  assert.equal(n.person.displayName, 'ישראל ישראלי');
  assert.equal(n.person.phoneIntl, '972501234567');
  assert.equal(n.person.email, 'israel@example.co.il');
  assert.equal(n.context.participants, 25);
});

test('note: every answer is rendered with its question label', () => {
  const b = buildIntakeNoteBody(build());
  assert.ok(b.includes('שם מלא: ישראל ישראלי'));
  assert.ok(b.includes('כמה משתתפים?: 25'));
  assert.ok(b.includes('באיזה אזור?: תל אביב והמרכז'));
  assert.ok(b.includes('טווח תקציב: 5,000-10,000 ₪'));
});

test('note: a blank answer is shown explicitly, not omitted', () => {
  assert.ok(buildIntakeNoteBody(build()).includes('הערות: — ללא מענה'));
});

test('note: Meta source context is present', () => {
  const b = buildIntakeNoteBody(build());
  assert.ok(b.includes('מזהה טופס: 3851739504971671'));
  assert.ok(b.includes('מזהה ליד: 1122334455'));
  assert.ok(b.includes(LEAD.campaignId));
  assert.ok(b.includes(LEAD.adId));
});

test('note: no secrets or transport metadata ever appear', () => {
  const b = buildIntakeNoteBody(build()).toLowerCase();
  for (const forbidden of ['access_token', 'bearer', 'x-hub-signature', 'sha256=', 'app_secret', 'verify_token']) {
    assert.ok(!b.includes(forbidden), `note leaked ${forbidden}`);
  }
});

test('note: customer-supplied HTML is escaped', () => {
  const evil = normalizeEvent(
    toCanonicalEvent(
      { ...DETAILS, field_data: [{ name: 'x', label: 'הערה', values: ['<script>alert(1)</script>'] }] },
      LEAD,
    ),
  );
  const b = buildIntakeNoteBody(evil);
  assert.ok(!b.includes('<script>'));
  assert.ok(b.includes('&lt;script&gt;'));
});

test('note: the ambiguous-phone warning surfaces when requested', () => {
  assert.ok(buildIntakeNoteBody(build(), { ambiguous: true }).includes('משויך ליותר מאיש קשר אחד'));
});

test('note: sources without per-question data keep the compact rendering', () => {
  const n = normalizeEvent({
    kind: 'lead',
    source: 'website_form',
    person: { fullName: 'דנה כהן', phone: '0521112222' },
    context: { message: 'מעוניינת בסדנה', formName: 'צור קשר', formAnswers: [] },
    attributionInput: {},
    extra: {},
  });
  const b = buildIntakeNoteBody(n);
  assert.ok(b.includes('מעוניינת בסדנה'));
  assert.ok(!b.includes('תוכן הטופס'));
});
