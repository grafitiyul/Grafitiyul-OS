import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guideSendAccountId,
  setGuideSendAccount,
  resolveGuideComposerAccount,
  getGuideMessageSettings,
  DEFAULT_GUIDE_SEND_ACCOUNT_ID,
  SETTINGS_ID,
  GuideSettingsError,
} from './guideMessageSettings.js';

// A tiny in-memory singleton table. It enforces nothing, so every guarantee
// asserted here is the module's own.
function fakeDb(row = null) {
  const state = { row };
  return {
    state,
    guideMessageSettings: {
      findUnique: async ({ where }) => (where.id === SETTINGS_ID ? state.row : null),
      upsert: async ({ create, update }) => {
        state.row = state.row ? { ...state.row, ...update } : { ...create, updatedAt: new Date() };
        return state.row;
      },
    },
  };
}

const ACCOUNTS = [
  { id: 'main', label: 'מכירות', connected: true },
  { id: 'office', label: 'שירות לקוחות', connected: true },
];

test('the flow default is שירות לקוחות — held as an ID, never a label', () => {
  assert.equal(DEFAULT_GUIDE_SEND_ACCOUNT_ID, 'office');
});

test('nothing configured resolves to the documented flow default', async () => {
  const db = fakeDb(null);
  assert.equal(await guideSendAccountId({ db }), 'office');
  const r = await resolveGuideComposerAccount(ACCOUNTS, { db });
  assert.deepEqual(r, { accountId: 'office', source: 'flow_default', available: true, connected: true });
});

test('a configured account wins over the default', async () => {
  const db = fakeDb({ id: SETTINGS_ID, sendAccountId: 'main' });
  assert.equal(await guideSendAccountId({ db }), 'main');
  const r = await resolveGuideComposerAccount(ACCOUNTS, { db });
  assert.equal(r.accountId, 'main');
  assert.equal(r.source, 'configured');
});

test('setting it stores the id and survives a read-back', async () => {
  const db = fakeDb(null);
  await setGuideSendAccount('main', ['main', 'office'], { db, updatedById: 'u1' });
  assert.equal((await getGuideMessageSettings({ db })).sendAccountId, 'main');
  await setGuideSendAccount('office', ['main', 'office'], { db });
  assert.equal(await guideSendAccountId({ db }), 'office', 'and can be changed back');
});

test('an unknown account is refused rather than stored', async () => {
  const db = fakeDb(null);
  await assert.rejects(
    () => setGuideSendAccount('ghost', ['main', 'office'], { db }),
    (e) => e instanceof GuideSettingsError && e.code === 'unknown_account',
  );
  assert.equal(db.state.row, null, 'nothing was written');
});

test('an empty account is refused — this setting always names a number', async () => {
  const db = fakeDb(null);
  await assert.rejects(() => setGuideSendAccount('', ['main'], { db }), (e) => e.code === 'account_required');
  await assert.rejects(() => setGuideSendAccount(null, ['main'], { db }), (e) => e.code === 'account_required');
});

test('a DISCONNECTED account is reported, never swapped for the other number', async () => {
  const down = [{ id: 'main', label: 'מכירות', connected: true }, { id: 'office', label: 'שירות לקוחות', connected: false }];
  const r = await resolveGuideComposerAccount(down, { db: fakeDb({ id: SETTINGS_ID, sendAccountId: 'office' }) });
  assert.equal(r.accountId, 'office', 'still the configured number');
  assert.equal(r.available, true);
  assert.equal(r.connected, false, 'and the caller is told it cannot send right now');
});

test('a RETIRED account is reported unavailable — no silent fallback', async () => {
  const r = await resolveGuideComposerAccount(ACCOUNTS, { db: fakeDb({ id: SETTINGS_ID, sendAccountId: 'gone' }) });
  assert.equal(r.accountId, 'gone');
  assert.equal(r.available, false);
  assert.notEqual(r.accountId, 'office', 'the flow default did NOT quietly take over');
});

test('a broken settings read degrades to the default instead of throwing', async () => {
  const broken = { guideMessageSettings: { findUnique: async () => { throw new Error('db down'); } } };
  assert.equal(await guideSendAccountId({ db: broken }), 'office');
});

test('this flow does not read, and cannot change, the new-lead account', async () => {
  // Structural: the module touches exactly one table. A guide-flow change that
  // reached WhatsAppTemplate would be a cross-flow bug.
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('./guideMessageSettings.js', import.meta.url), 'utf8'));
  assert.ok(!/whatsAppTemplate/i.test(src), 'never touches the template table');
  assert.ok(!/newLead/i.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')), 'never reads the new-lead setting');
});
