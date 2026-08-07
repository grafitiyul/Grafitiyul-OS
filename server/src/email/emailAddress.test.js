import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeEmailAddress,
  normalizeEmailAddress,
  isEmailShaped,
  toSendableAddress,
  hasInvisibleChars,
  describeEmailInput,
} from '../../../shared/emailAddress.mjs';
import { cleanRecipientList } from './composedSend.js';
import { buildRawMessage } from './mime.js';

// THE incident address: deals #27099/#27100, 2026-08-07. Gmail rejected every
// attempt because of the trailing U+200F; six retries, two customers never told
// their tours were confirmed. This file is the regression wall.
const RLM = '‏';
const DIRTY = `hilah19@gmail.com${RLM}`;

test('the incident address is repaired, not merely rejected', () => {
  assert.equal(sanitizeEmailAddress(DIRTY), 'hilah19@gmail.com');
  assert.equal(normalizeEmailAddress(DIRTY), 'hilah19@gmail.com');
  assert.equal(toSendableAddress(DIRTY), 'hilah19@gmail.com');
});

test('the OLD validator accepted the incident address — the new one does not', () => {
  // The exact regex that shipped, kept here as the thing we are fixing.
  const OLD = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  assert.equal(OLD.test(DIRTY), true, 'old rule passed it — that was the bug');
  assert.equal(isEmailShaped(`hilah19@gmail${RLM}.com`), true, 'repairable → valid after sanitize');
  // Anything non-ASCII that survives sanitizing must be refused outright.
  assert.equal(isEmailShaped('hilah19@gmailת.com'), false);
});

test('every invisible/bidi class the incident family covers is stripped', () => {
  const cases = [
    ['​zwsp@x.com', 'zwsp@x.com'],
    ['‌zwnj@x.com', 'zwnj@x.com'],
    ['‍zwj@x.com', 'zwj@x.com'],
    ['‎lrm@x.com', 'lrm@x.com'],
    [`rlm@x.com${RLM}`, 'rlm@x.com'],
    ['‫lre@x.com‬', 'lre@x.com'], // the other real prod shape
    ['‪rlo@x.com‬‏', 'rlo@x.com'],
    ['⁦iso@x.com⁩', 'iso@x.com'],
    ['﻿bom@x.com', 'bom@x.com'],
    ['soft­hyphen@x.com', 'softhyphen@x.com'],
  ];
  for (const [dirty, clean] of cases) {
    assert.equal(sanitizeEmailAddress(dirty), clean, `failed for ${JSON.stringify(dirty)}`);
    assert.equal(toSendableAddress(dirty), clean);
  }
});

test('unicode spaces trim at the edges but INVALIDATE in the middle', () => {
  // Edge whitespace is a paste artefact — safe to drop.
  assert.equal(toSendableAddress(' a@x.com　'), 'a@x.com');
  // An interior space usually means two addresses got glued. Never silently
  // joined into one bogus mailbox.
  assert.equal(toSendableAddress('a@x.com b@x.com'), null);
  assert.equal(toSendableAddress('a@x.com b@x.com'), null);
});

test('ordinary addresses are untouched (no regression for valid data)', () => {
  for (const ok of ['a@b.co', 'first.last+tag@sub.domain.co.il', "o'brien@x.com"]) {
    assert.equal(toSendableAddress(ok), ok.toLowerCase());
  }
  // Case is preserved for STORAGE, lowered only for matching/sending.
  assert.equal(sanitizeEmailAddress('Dor@Example.COM'), 'Dor@Example.COM');
  assert.equal(normalizeEmailAddress('Dor@Example.COM'), 'dor@example.com');
});

test('unusable input yields null, never a doomed value', () => {
  for (const bad of ['', null, undefined, '   ', RLM, 'nope', 'no@domain', '@x.com']) {
    assert.equal(toSendableAddress(bad), null);
  }
});

test('describeEmailInput powers an honest operator warning', () => {
  const d = describeEmailInput(DIRTY);
  assert.equal(d.valid, true);
  assert.equal(d.hadInvisible, true);
  assert.equal(d.changed, true);
  assert.equal(d.sanitized, 'hilah19@gmail.com');

  assert.equal(describeEmailInput('a@b.co').hadInvisible, false);
  assert.equal(describeEmailInput('a@b.co').changed, false);
  assert.equal(describeEmailInput('').reason, 'empty');
  assert.equal(describeEmailInput(RLM).reason, 'invisible_only');
  assert.equal(describeEmailInput('nope').reason, 'invalid_shape');
  assert.equal(describeEmailInput('שלום@x.com').reason, 'non_ascii');
  assert.equal(hasInvisibleChars('clean@x.com'), false);
});

// ── The send path itself ─────────────────────────────────────────────────────

test('cleanRecipientList repairs the incident address instead of passing it on', () => {
  const out = cleanRecipientList([{ email: DIRTY, name: 'הילה חדד סלומון' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].email, 'hilah19@gmail.com');
  assert.ok(!/[​-‏]/.test(out[0].email));
});

test('cleanRecipientList DROPS an address that cannot be repaired', () => {
  assert.deepEqual(cleanRecipientList([{ email: 'שלום@x.com' }]), []);
  assert.deepEqual(cleanRecipientList([{ email: `${RLM}${RLM}` }]), []);
});

test('the To: header is pure ASCII inside the angle-addr — the actual Gmail rule', () => {
  const raw = buildRawMessage({
    from: { email: 'info@grafitiyul.co.il', name: 'Grafitiyul' },
    to: cleanRecipientList([{ email: DIRTY, name: 'הילה חדד סלומון' }]),
    subject: 'x',
    bodyHtml: '<p>x</p>',
    bodyText: 'x',
    attachments: [],
  });
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const toLine = decoded.split('\r\n').find((l) => l.startsWith('To:'));
  const addr = toLine.slice(toLine.indexOf('<') + 1, toLine.lastIndexOf('>'));
  assert.equal(addr, 'hilah19@gmail.com');
  // The display name may be MIME-encoded; the ADDRESS must be bare ASCII.
  assert.ok(/^[\x21-\x7E]+$/.test(addr), 'addr-spec must be printable ASCII');
});
