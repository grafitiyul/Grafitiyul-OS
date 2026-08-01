import test from 'node:test';
import assert from 'node:assert/strict';

// A minimal localStorage so the remembered-account helpers can be tested in
// node exactly as the browser runs them (they are try/catch guarded, so a
// missing implementation would silently pass and prove nothing).
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { resolveAccountId, isUsableAccount, readRememberedAccountId, rememberAccountId } =
  await import('./senderAccount.js');

const sales = { id: 'main', label: 'מכירות', connected: true, bridgeConfigured: true };
const office = { id: 'office', label: 'שירות לקוחות', connected: true, bridgeConfigured: true };
const down = { id: 'down', label: 'מנותק', connected: false, bridgeConfigured: true };
const unaddressable = { id: 'ghost', label: 'ללא גשר', connected: true, bridgeConfigured: false };

test('a number is usable only when connected AND addressable', () => {
  assert.equal(isUsableAccount(sales), true);
  assert.equal(isUsableAccount(down), false);
  assert.equal(isUsableAccount(unaddressable), false);
  assert.equal(isUsableAccount(null), false);
  // Surfaces whose account DTO carries neither flag (retired rows rebuilt from
  // a chat) must not be treated as broken.
  assert.equal(isUsableAccount({ id: 'x' }), true);
});

test('an explicit pick always wins', () => {
  assert.equal(resolveAccountId([sales, office], { explicit: 'office', remembered: 'main' }), 'office');
  // Even over a hint pointing at the customer's existing conversation.
  assert.equal(resolveAccountId([sales, office], { explicit: 'office', hint: 'main' }), 'office');
});

test('this browser\'s remembered number is restored', () => {
  assert.equal(resolveAccountId([sales, office], { remembered: 'office' }), 'office');
});

test('a remembered number that is no longer connected falls back, never sends', () => {
  assert.equal(resolveAccountId([sales, down], { remembered: 'down' }), 'main');
  assert.equal(resolveAccountId([sales, unaddressable], { remembered: 'ghost' }), 'main');
});

test('a remembered number that no longer exists at all falls back', () => {
  assert.equal(resolveAccountId([sales, office], { remembered: 'retired_number' }), 'main');
});

test('with nothing remembered, the conversation that exists wins over first-in-list', () => {
  assert.equal(resolveAccountId([sales, office], { hint: 'office' }), 'office');
});

test('a remembered number beats the contextual hint', () => {
  // The employee works from the office number; a deal whose history sits on
  // sales must still open on THEIR number (the bubbles show the other one).
  assert.equal(resolveAccountId([sales, office], { remembered: 'office', hint: 'main' }), 'office');
});

test('falls back to the first USABLE number, not merely the first', () => {
  assert.equal(resolveAccountId([down, office], {}), 'office');
});

test('with every number down it still names one, rather than nothing', () => {
  // A surface with null has no header to render and no bubble to highlight;
  // naming the number and letting the send fail loudly is the honest outcome.
  assert.equal(resolveAccountId([down], {}), 'down');
});

test('no numbers at all resolves to null', () => {
  assert.equal(resolveAccountId([], { remembered: 'main' }), null);
});

test('the remembered number round-trips through localStorage', () => {
  store.clear();
  assert.equal(readRememberedAccountId(), null);
  rememberAccountId('office');
  assert.equal(readRememberedAccountId(), 'office');
  // Survives a "browser restart" — the value lives in storage, not in memory.
  assert.equal(JSON.parse(store.get('gos-whatsapp-sender')).accountId, 'office');
  rememberAccountId(null);
  assert.equal(readRememberedAccountId(), null);
});

test('corrupt storage never breaks the picker', () => {
  store.set('gos-whatsapp-sender', 'not json');
  assert.equal(readRememberedAccountId(), null);
  store.clear();
});
