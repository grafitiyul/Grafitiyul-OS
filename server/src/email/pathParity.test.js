import test from 'node:test';
import assert from 'node:assert/strict';
import { validateComposition } from './composedSend.js';
import { buildRawMessage } from './mime.js';

// ARCHITECTURAL INVARIANT: "send later" must produce byte-identical output to
// "send now" for the same composition. The only legitimate difference is WHEN
// it goes out.
//
// The two paths feed buildRawMessage differently by nature:
//   immediate — the composer's raw HTML, no bodyText (derived on the fly)
//   scheduled — HTML that was already validated+sanitized once at scheduling
//               time, plus the bodyText that was derived and stored then
// So the risk is real: a second sanitization pass, or a stored-vs-derived
// bodyText, could silently change the wire format. These tests pin that it
// does not.

// The MIME boundaries and the tracking-pixel id are random per send by design;
// normalize them so a byte-comparison tests the CONTENT, not the entropy.
function normalize(raw) {
  return Buffer.from(raw, 'base64url')
    .toString('utf8')
    .replace(/alt_[a-z0-9]+/g, 'ALT')
    .replace(/mixed_[a-z0-9]+/g, 'MIXED')
    .replace(/email-open\/[A-Za-z0-9_-]+\.gif/g, 'email-open/PIXEL.gif');
}

// Decode the text/html part out of an already-decoded MIME string. Base64
// bodies wrap at 76 chars, so the lines must be JOINED before decoding.
function htmlFromMimeText(mime) {
  const at = mime.search(/Content-Type:\s*text\/html/i);
  if (at < 0) return '';
  const afterHeaders = mime.slice(at).split(/\r\n\r\n/).slice(1).join('\r\n\r\n');
  const b64 = afterHeaders.split(/\r\n--/)[0].replace(/[\r\n]/g, '');
  return Buffer.from(b64, 'base64').toString('utf8');
}

// Mirrors sendComposedEmail: validate → assemble the tracked HTML → build MIME.
function buildLikeSendPath(input) {
  const clean = validateComposition(input);
  const htmlOut = `${clean.bodyHtml || `<p>${clean.bodyText.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`}<img src="https://app.example/api/track/email-open/ABC.gif" width="1" height="1" alt="" style="display:none">`;
  return buildRawMessage({
    from: { email: 'info@grafitiyul.co.il', name: 'גרפיטיול' },
    to: clean.to,
    cc: clean.cc,
    bcc: clean.bcc,
    subject: clean.subject,
    bodyHtml: htmlOut,
    bodyText: clean.bodyText,
    attachments: clean.attachments,
  });
}

// One composition, expressed the way each path sees it.
function bothPaths(composerHtml) {
  const composition = {
    to: [{ email: 'dor@example.com', name: null }],
    cc: [],
    bcc: [],
    subject: 'נושא',
    bodyHtml: composerHtml,
    attachments: [],
  };
  // IMMEDIATE: straight from the composer.
  const immediate = buildLikeSendPath(composition);
  // SCHEDULED: what create-time validation stored, replayed at send time.
  const stored = validateComposition(composition);
  const scheduled = buildLikeSendPath({
    ...composition,
    bodyHtml: stored.bodyHtml, // already sanitized once
    bodyText: stored.bodyText, // derived + stored at scheduling time
    attachments: stored.attachments,
  });
  return { immediate: normalize(immediate), scheduled: normalize(scheduled) };
}

test('plain Hebrew body — scheduled output is byte-identical to immediate', () => {
  const { immediate, scheduled } = bothPaths('<p>שלום שלום לך</p><p>דור יא מלך</p>');
  assert.equal(scheduled, immediate);
});

test('mixed direction + highlight + link — byte-identical', () => {
  const html =
    '<p>שלום <mark style="background-color: #fef08a">מודגש</mark></p>' +
    '<p>Hello there</p>' +
    '<p><a href="https://example.com">קישור</a></p>';
  const { immediate, scheduled } = bothPaths(html);
  assert.equal(scheduled, immediate);
});

test('explicit author colours + bold/underline/alignment — byte-identical', () => {
  const html =
    '<p style="text-align: center"><strong>כותרת</strong></p>' +
    '<p><span style="color: #ff0000">אדום</span> <u>קו תחתון</u></p>';
  const { immediate, scheduled } = bothPaths(html);
  assert.equal(scheduled, immediate);
});

test('quoted reply history with its own directions — byte-identical', () => {
  const html =
    '<p>תשובה</p><blockquote><p dir="ltr">Original English</p><p>שורה בעברית</p></blockquote>';
  const { immediate, scheduled } = bothPaths(html);
  assert.equal(scheduled, immediate);
});

test('NEITHER path injects a text colour when the author chose none', () => {
  const { immediate, scheduled } = bothPaths('<p>שלום שלום לך</p>');
  for (const [label, raw] of [['immediate', immediate], ['scheduled', scheduled]]) {
    const decoded = htmlFromMimeText(raw);
    assert.doesNotMatch(decoded, /(^|[^-])color\s*:/i, `${label} must not force a text colour`);
    assert.doesNotMatch(decoded, /#000|black|rgb\(0,\s*0,\s*0\)/i, `${label} must not emit black`);
  }
});

test('an explicit author colour SURVIVES in both paths (never stripped)', () => {
  const { immediate, scheduled } = bothPaths('<p><span style="color: #ff0000">אדום</span></p>');
  for (const raw of [immediate, scheduled]) {
    const decoded = htmlFromMimeText(raw);
    assert.match(decoded, /color:#ff0000/i);
  }
});

test('double sanitization is idempotent (the scheduled path sanitizes twice)', () => {
  const once = validateComposition({
    to: [{ email: 'a@b.com' }], subject: 's', bodyHtml: '<p>שלום <mark style="background-color: #fef08a">x</mark></p>',
  });
  const twice = validateComposition({
    to: [{ email: 'a@b.com' }], subject: 's', bodyHtml: once.bodyHtml,
  });
  assert.equal(twice.bodyHtml, once.bodyHtml, 'sanitizing an already-sanitized body must not change it');
  assert.equal(twice.bodyText, once.bodyText);
});
