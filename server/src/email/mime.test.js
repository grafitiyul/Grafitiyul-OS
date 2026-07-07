import test from 'node:test';
import assert from 'node:assert/strict';
import {
  headerMap,
  decodeMimeWords,
  parseAddressList,
  normalizeSubject,
  parsePayload,
  buildRawMessage,
  htmlToText,
  encodeMimeWord,
} from './mime.js';

test('headerMap lowercases names and keeps the first value', () => {
  const h = headerMap([
    { name: 'Subject', value: 'שלום' },
    { name: 'SUBJECT', value: 'ignored duplicate' },
    { name: 'Message-ID', value: '<abc@mail.gmail.com>' },
  ]);
  assert.equal(h.subject, 'שלום');
  assert.equal(h['message-id'], '<abc@mail.gmail.com>');
});

test('decodeMimeWords handles B-encoded UTF-8 Hebrew', () => {
  const encoded = `=?UTF-8?B?${Buffer.from('סיור גרפיטי', 'utf8').toString('base64')}?=`;
  assert.equal(decodeMimeWords(encoded), 'סיור גרפיטי');
});

test('decodeMimeWords handles Q-encoding with underscores', () => {
  assert.equal(decodeMimeWords('=?utf-8?Q?Hello_World?='), 'Hello World');
});

test('parseAddressList: names, bare addresses, commas inside quotes', () => {
  const list = parseAddressList('"Levi, Dana" <dana@x.co.il>, info@y.org, Tour Desk <desk@z.com>');
  assert.deepEqual(list, [
    { email: 'dana@x.co.il', name: 'Levi, Dana' },
    { email: 'info@y.org', name: null },
    { email: 'desk@z.com', name: 'Tour Desk' },
  ]);
});

test('parseAddressList decodes encoded-word display names', () => {
  const name = `=?UTF-8?B?${Buffer.from('דנה לוי', 'utf8').toString('base64')}?=`;
  const list = parseAddressList(`${name} <dana@x.co.il>`);
  assert.equal(list[0].name, 'דנה לוי');
  assert.equal(list[0].email, 'dana@x.co.il');
});

test('normalizeSubject strips stacked Re:/Fwd:/Hebrew prefixes', () => {
  assert.equal(normalizeSubject('Re: RE: Fwd: הצעת מחיר'), 'הצעת מחיר');
  assert.equal(normalizeSubject('השב: סיור בתל אביב'), 'סיור בתל אביב');
  assert.equal(normalizeSubject('  plain  '), 'plain');
});

test('parsePayload walks multipart tree: bodies + attachments', () => {
  const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
  const payload = {
    mimeType: 'multipart/mixed',
    parts: [
      {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: b64u('hello plain') } },
          { mimeType: 'text/html', body: { data: b64u('<p>hello html</p>') } },
        ],
      },
      {
        mimeType: 'application/pdf',
        filename: 'quote.pdf',
        partId: '2',
        body: { attachmentId: 'ATT123', size: 1024 },
      },
    ],
  };
  const out = parsePayload(payload);
  assert.equal(out.bodyText, 'hello plain');
  assert.equal(out.bodyHtml, '<p>hello html</p>');
  assert.equal(out.attachments.length, 1);
  assert.deepEqual(out.attachments[0], {
    fileName: 'quote.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    gmailAttachmentId: 'ATT123',
    partId: '2',
    contentId: null,
  });
});

test('parsePayload captures Content-ID for inline (cid:) images, even without a filename', () => {
  const payload = {
    mimeType: 'multipart/related',
    parts: [
      { mimeType: 'text/html', body: { data: Buffer.from('<img src="cid:logo123">', 'utf8').toString('base64url') } },
      {
        mimeType: 'image/png',
        filename: '',
        partId: '2',
        headers: [{ name: 'Content-ID', value: '<logo123>' }],
        body: { attachmentId: 'ATT9', size: 512 },
      },
    ],
  };
  const out = parsePayload(payload);
  assert.equal(out.attachments.length, 1);
  assert.equal(out.attachments[0].contentId, 'logo123'); // angle brackets stripped
  assert.match(out.attachments[0].fileName, /^inline-/); // synthetic name for nameless inline parts
});

test('buildRawMessage produces base64url RFC 2822 with threading headers', () => {
  const raw = buildRawMessage({
    from: { email: 'info@grafitiyul.co.il', name: 'גרפיתי-יול' },
    to: [{ email: 'dana@x.co.il', name: 'דנה' }],
    subject: 'הצעת מחיר לסיור',
    bodyHtml: '<p>שלום</p>',
    bodyText: 'שלום',
    inReplyTo: '<orig@mail.gmail.com>',
    references: '<root@mail.gmail.com> <orig@mail.gmail.com>',
  });
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(decoded, /From: =\?UTF-8\?B\?/);
  assert.match(decoded, /To: .*<dana@x\.co\.il>/);
  assert.match(decoded, /In-Reply-To: <orig@mail\.gmail\.com>/);
  assert.match(decoded, /References: <root@mail\.gmail\.com> <orig@mail\.gmail\.com>/);
  assert.match(decoded, /multipart\/alternative/);
  // Hebrew subject must be RFC 2047 encoded, never raw.
  assert.match(decoded, /Subject: =\?UTF-8\?B\?/);
});

test('buildRawMessage with attachment wraps in multipart/mixed', () => {
  const raw = buildRawMessage({
    from: { email: 'a@b.c' },
    to: [{ email: 'x@y.z' }],
    subject: 'file',
    bodyText: 'see attached',
    attachments: [{ filename: 'a.txt', mimeType: 'text/plain', contentBase64: Buffer.from('hi').toString('base64') }],
  });
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(decoded, /multipart\/mixed/);
  assert.match(decoded, /Content-Disposition: attachment; filename="a\.txt"/);
});

test('encodeMimeWord leaves ASCII alone and encodes Hebrew', () => {
  assert.equal(encodeMimeWord('Plain Subject'), 'Plain Subject');
  assert.match(encodeMimeWord('נושא'), /^=\?UTF-8\?B\?.+\?=$/);
});

test('htmlToText strips tags and decodes basic entities', () => {
  assert.equal(htmlToText('<p>שלום <b>עולם</b></p><p>שורה&nbsp;שנייה &amp; עוד</p>'), 'שלום עולם\nשורה שנייה & עוד');
});
