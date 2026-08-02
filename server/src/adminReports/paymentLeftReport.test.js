// Report #19 — "a payment was left after the tour".
//
// The business rule lives in two places and both are guarded here:
//   * paymentWasLeft() decides WHETHER, bound to the canonical role;
//   * the report decides HOW it reads, in Hebrew and in English.
//
// The third guarantee — exactly one notification per submission — is structural
// (the idempotency key is the submission id) and is asserted on the source, so
// nobody can quietly key it off something re-creatable.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderReport, renderReportSample, reportByNumber } from './registry.js';
import { paymentWasLeft, PAYMENT_LEFT_ROLE } from '../reviewItems/kinds/tourSummary.js';

const q = (key, role) => ({ key, config: role ? { summaryRole: role } : {} });

// ── whether ──────────────────────────────────────────────────────────────────

test('the trigger is the ROLE, never the wording or the key', () => {
  // Same role, completely different key and wording → still fires.
  const a = paymentWasLeft({ questions: [q('q_1aa409f5', PAYMENT_LEFT_ROLE)], answers: { q_1aa409f5: true } });
  const b = paymentWasLeft({ questions: [q('q_totally_different', PAYMENT_LEFT_ROLE)], answers: { q_totally_different: true } });
  assert.equal(a.flagged, true);
  assert.equal(b.flagged, true);
});

test('only an affirmative answer fires; no, blank and unmapped stay silent', () => {
  const questions = [q('q_pay', PAYMENT_LEFT_ROLE)];
  assert.equal(paymentWasLeft({ questions, answers: { q_pay: false } }).flagged, false);
  assert.equal(paymentWasLeft({ questions, answers: {} }).flagged, false);
  assert.equal(paymentWasLeft({ questions, answers: { q_pay: '' } }).flagged, false);
  // No question carries the role at all → nothing to report, no crash.
  assert.equal(paymentWasLeft({ questions: [q('q_pay')], answers: { q_pay: true } }).flagged, false);
});

// ── how it reads ─────────────────────────────────────────────────────────────

test('#19 renders in Hebrew and in English from the same data', () => {
  const def = reportByNumber(19);
  const ctx = def.sample();
  const he = renderReport(19, ctx);
  const en = def.renderEn(ctx);

  for (const text of [he, en]) {
    assert.ok(text.includes('יואב כהן'), 'the guide who reported it');
    assert.ok(text.includes('דנה לוי'), 'the customer');
    assert.ok(text.includes('₪1,250.00'), 'the outstanding balance');
    assert.ok(text.includes('/admin/crm/deals/27184'), 'a link to the deal');
    assert.ok(text.includes('?item=ri_sample'), 'a link to the summary card');
  }
  assert.ok(he.includes('הושאר תשלום אחרי הסיור'));
  assert.ok(en.includes('Payment left after the tour'));
  // Same facts, different language — never a different set of facts.
  assert.notEqual(he, en);
});

test('#19 degrades honestly when the balance cannot be resolved', () => {
  const ctx = { links: { origin: 'https://x' }, paymentLeft: { guideName: 'א', balanceText: null } };
  const text = renderReport(19, ctx);
  assert.ok(text.includes('יתרה לתשלום: —'), 'an honest dash, never a fabricated 0');
  assert.ok(!/undefined|null/.test(text));
});

test('#19 previews cleanly (the settings screen path)', () => {
  const text = renderReportSample(19);
  assert.ok(text.length > 40);
  assert.ok(!/\{\{|undefined|null/.test(text));
});

// ── exactly once ─────────────────────────────────────────────────────────────

test('the notification is keyed to the immutable submission, and fires from the summary path', () => {
  const src = fs.readFileSync(new URL('../reviewItems/fromTourSummary.js', import.meta.url), 'utf8');
  assert.match(src, /number: 19/, '#19 is actually fired — a report nothing calls is dead code');
  assert.match(
    src,
    /idempotencyKey: `payment_left_after_tour:\$\{submission\.id\}`/,
    'keyed to the submission id: an edit, a re-read or a replay can never notify twice',
  );
  // The balance must come from the collection module, never from the deal total.
  assert.match(src, /dealCollection\(/);
  assert.ok(!/valueMinor.*balanceText/s.test(src.split('paymentWasLeft')[1] || ''),
    'the balance is never derived from the deal headline value');
});

test('#19 has no Communication Center or Automation Registry twin', () => {
  const root = new URL('../', import.meta.url);
  const auts = fs.existsSync(new URL('automations/definitions', root))
    ? fs.readdirSync(new URL('automations/definitions', root))
    : [];
  for (const f of auts) {
    const src = fs.readFileSync(new URL(`automations/definitions/${f}`, root), 'utf8');
    assert.ok(
      !/payment_left|הושאר תשלום/.test(src),
      `${f} duplicates report #19 — one business event must have exactly one sender`,
    );
  }
});
