import test from 'node:test';
import assert from 'node:assert/strict';

process.env.EMAIL_TOKEN_KEY = 'test-key-for-unit-tests-only-0123456789';
const { encryptToken, decryptToken, cryptoConfigured } = await import('./tokenCrypto.js');

test('round-trips a token', () => {
  const secret = '1//0abcDEF-refresh-token_with.symbols';
  const enc = encryptToken(secret);
  assert.notEqual(enc, secret);
  assert.match(enc, /^v1:/);
  assert.equal(decryptToken(enc), secret);
});

test('unique IVs — same plaintext encrypts differently every time', () => {
  assert.notEqual(encryptToken('same'), encryptToken('same'));
});

test('null/empty handling', () => {
  assert.equal(encryptToken(null), null);
  assert.equal(encryptToken(''), null);
  assert.equal(decryptToken(null), null);
});

test('tampered ciphertext fails authentication', () => {
  const enc = encryptToken('secret');
  const parts = enc.split(':');
  const ct = Buffer.from(parts[3], 'base64url');
  ct[0] ^= 0xff;
  parts[3] = ct.toString('base64url');
  assert.throws(() => decryptToken(parts.join(':')));
});

test('cryptoConfigured true with the test key', () => {
  assert.equal(cryptoConfigured(), true);
});
