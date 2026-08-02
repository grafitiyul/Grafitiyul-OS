import test from 'node:test';
import assert from 'node:assert/strict';
import { emailRecipientConfirmed } from './icount.js';

// Pure response-verification logic only — the HTTP client itself is out of
// scope (same convention as icountDocs.test.js). The fixtures below are REAL
// doc/email responses captured live on 2026-07-08.

// Explicit email_to honored — recipient echoed back with email_sent:true.
const LIVE_EXPLICIT = {
  status: true,
  reason: 'OK',
  doctype: 'invrec',
  docnum: '38390',
  email_to: ['dorkoren020+icounttest@gmail.com'],
  email_total_count: 1,
  email_success_count: 1,
  email_status: {
    'dorkoren020+icounttest@gmail.com': {
      email: 'dorkoren020+icounttest@gmail.com',
      name: null,
      addr: 'dorkoren020+icounttest@gmail.com',
      email_sent: true,
    },
  },
};

// The HAZARD case: no usable recipient param → iCount silently falls back to
// the customer email on the iCount client card (status is still true!).
const LIVE_FALLBACK_TO_CLIENT = {
  status: true,
  reason: 'OK',
  doctype: 'invrec',
  docnum: '38390',
  email_to: ['"אקשן — מחלקת שיווק" <someone-else@example.com>'],
  email_total_count: 1,
  email_success_count: 1,
  email_status: {
    'someone-else@example.com': {
      email: 'someone-else@example.com',
      name: 'אקשן — מחלקת שיווק',
      email_sent: true,
    },
  },
};

test('doc/email: explicit recipient echoed back with email_sent → confirmed', () => {
  assert.equal(emailRecipientConfirmed(LIVE_EXPLICIT, 'dorkoren020+icounttest@gmail.com'), true);
  // Case/whitespace-insensitive match.
  assert.equal(emailRecipientConfirmed(LIVE_EXPLICIT, ' DorKoren020+icounttest@GMAIL.com '), true);
});

test('doc/email: silent fallback to the client-card email is NOT success for OUR recipient', () => {
  assert.equal(emailRecipientConfirmed(LIVE_FALLBACK_TO_CLIENT, 'chosen-recipient@example.com'), false);
});

test('doc/email: missing/odd response shapes never count as confirmed', () => {
  assert.equal(emailRecipientConfirmed({ status: true }, 'a@b.co'), false);
  assert.equal(emailRecipientConfirmed({ email_status: null }, 'a@b.co'), false);
  assert.equal(emailRecipientConfirmed(null, 'a@b.co'), false);
  assert.equal(
    emailRecipientConfirmed(
      { email_status: { 'a@b.co': { email: 'a@b.co', email_sent: false } } },
      'a@b.co',
    ),
    false,
  );
  assert.equal(emailRecipientConfirmed(LIVE_EXPLICIT, ''), false);
});

test('getDocUrl reads doc_url — the field iCount actually returns', async () => {
  // Verified live 2026-08-02: doc/get_doc_url answers { status, doctype, docnum,
  // doc_lang, doc_url }. Reading `url` returned null for EVERY document, so
  // "פתח מסמך" could not work and the Gmail send fallback lost its link.
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ status: true, reason: 'OK', doctype: 'invrec', docnum: '38494', doc_url: 'https://app.icount.co.il/hash/p_print.php?code=ABC' }),
  });
  process.env.ICOUNT_CID = 'x'; process.env.ICOUNT_USER = 'y'; process.env.ICOUNT_PASS = 'z';
  try {
    const { getDocUrl } = await import('./icount.js');
    assert.equal(await getDocUrl('invrec', '38494'), 'https://app.icount.co.il/hash/p_print.php?code=ABC');
  } finally {
    globalThis.fetch = original;
  }
});
