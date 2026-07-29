import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  AmbiguousSenderError, SENDER_PREF_KEY, getSenderPreference, resolveForOperator,
  resolveSendAccount, setSenderPreference,
} from './senderAccount.js';
import { defaultSendAccount, sendWhatsAppText } from './send.js';

const withBridges = (map, fn) => {
  const prev = process.env.WHATSAPP_BRIDGE_URLS;
  process.env.WHATSAPP_BRIDGE_URLS = Object.entries(map).map(([k, v]) => `${k}=${v}`).join(',');
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.WHATSAPP_BRIDGE_URLS;
    else process.env.WHATSAPP_BRIDGE_URLS = prev;
  }
};
const TWO = { main: 'http://m:3000', office: 'http://o:3000' };
const ONE = { main: 'http://m:3000' };

// ── the guess is gone ────────────────────────────────────────────────────────

test('TWO accounts and no selection THROWS — it never picks "main"', () => {
  withBridges(TWO, () => {
    assert.throws(() => resolveSendAccount({ env: {} }), (e) => e instanceof AmbiguousSenderError);
    try { resolveSendAccount({ env: {} }); } catch (e) {
      assert.equal(e.code, 'whatsapp_sender_ambiguous');
      assert.equal(e.status, 409);
      assert.deepEqual(e.candidates.sort(), ['main', 'office']);
    }
  });
});

test('ONE account is unambiguous and resolves without a choice', () => {
  withBridges(ONE, () => {
    assert.deepEqual(resolveSendAccount({ env: {} }), { accountId: 'main', reason: 'only_configured_account' });
  });
});

test('precedence: explicit > user preference > system default', () => {
  withBridges(TWO, () => {
    assert.equal(resolveSendAccount({ explicit: 'office', preferred: 'main', env: { WHATSAPP_SYSTEM_ACCOUNT: 'main' } }).accountId, 'office');
    assert.equal(resolveSendAccount({ preferred: 'office', env: { WHATSAPP_SYSTEM_ACCOUNT: 'main' } }).accountId, 'office');
    assert.equal(resolveSendAccount({ env: { WHATSAPP_SYSTEM_ACCOUNT: 'office' } }).accountId, 'office');
  });
});

test('a preference pointing at a RETIRED account is ignored, not honoured', () => {
  withBridges(TWO, () => {
    // 'personal_test' no longer exists — it must not keep receiving sends.
    assert.throws(() => resolveSendAccount({ preferred: 'personal_test', env: {} }), (e) => e.code === 'whatsapp_sender_ambiguous');
    assert.equal(resolveSendAccount({ preferred: 'personal_test', env: { WHATSAPP_SYSTEM_ACCOUNT: 'office' } }).accountId, 'office');
  });
});

test('an unknown explicit account does not override a valid preference', () => {
  withBridges(TWO, () => {
    assert.equal(resolveSendAccount({ explicit: 'ghost', preferred: 'office', env: {} }).accountId, 'office');
  });
});

test('the old defaultSendAccount() now fails loudly instead of guessing', () => {
  assert.throws(() => defaultSendAccount(), /defaultSendAccount_removed/);
});

test('sendWhatsAppText REFUSES a send with no account', async () => {
  await assert.rejects(
    () => sendWhatsAppText('0501234567', 'hi', { bridge: async () => ({}) }),
    (e) => e.code === 'whatsapp_account_required',
  );
});

test('sendWhatsAppText passes the named account through to the bridge', async () => {
  const calls = [];
  const out = await sendWhatsAppText('0501234567', 'hi', {
    accountId: 'office',
    bridge: async (accountId, path, opts) => { calls.push({ accountId, path, opts }); return { externalMessageId: 'x' }; },
  });
  assert.equal(calls[0].accountId, 'office');
  assert.equal(out.accountId, 'office');
});

// ── the per-operator preference ──────────────────────────────────────────────

function prefDb(initial = null) {
  let row = initial;
  return {
    get row() { return row; },
    userUiState: {
      findUnique: async ({ where }) => (row && where.userId_key.key === SENDER_PREF_KEY ? { value: row } : null),
      upsert: async ({ create, update }) => { row = update.value ?? create.value; return { value: row }; },
    },
  };
}

test('the preference round-trips and is GLOBAL per user, not per deal', async () => {
  await withBridges(TWO, async () => {
    const db = prefDb();
    assert.equal(await getSenderPreference(db, 'u1'), null);
    await setSenderPreference(db, 'u1', 'office');
    assert.equal(await getSenderPreference(db, 'u1'), 'office');
    // Nothing in the stored shape is scoped to a deal or a chat.
    assert.deepEqual(Object.keys(db.row).sort(), ['accountId', 'setAt']);
  });
});

test('setting an unknown account is refused', async () => {
  await withBridges(TWO, async () => {
    await assert.rejects(() => setSenderPreference(prefDb(), 'u1', 'ghost'), (e) => e.code === 'unknown_account');
  });
});

test('switching sender on one deal carries to the NEXT deal', async () => {
  await withBridges(TWO, async () => {
    const db = prefDb();
    // Deal A: operator explicitly picks office; remember it.
    const a = await resolveForOperator(db, { userId: 'u1', explicit: 'office', remember: true });
    assert.equal(a.accountId, 'office');
    // Deal B: nothing explicit — the remembered choice is the default.
    const b = await resolveForOperator(db, { userId: 'u1' });
    assert.equal(b.accountId, 'office');
    assert.equal(b.reason, 'user_preference');
  });
});

test('a read-only resolve does not overwrite the stored preference', async () => {
  await withBridges(TWO, async () => {
    const db = prefDb({ accountId: 'office', setAt: 'x' });
    await resolveForOperator(db, { userId: 'u1', explicit: 'main', remember: false });
    assert.equal(await getSenderPreference(db, 'u1'), 'office');
  });
});

test('preference lookup never throws, even when the store is broken', async () => {
  const broken = { userUiState: { findUnique: async () => { throw new Error('db down'); } } };
  assert.equal(await getSenderPreference(broken, 'u1'), null);
});

// ── the audit: prove no implicit selection remains ───────────────────────────

test('AUDIT: no server source resolves a WhatsApp account implicitly', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.js') || e.name.endsWith('.test.js')) continue;
      // Strip comments first: this audit is about CODE, and prose that merely
      // names the removed function (like the explanation in senderAccount.js)
      // is not a call site.
      const src = fs.readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      const rel = path.relative(root, full);

      // Any call to the removed guesser outside its own definition.
      if (/defaultSendAccount\s*\(/.test(src) && !rel.endsWith(path.join('whatsapp', 'send.js'))) {
        offenders.push(`${rel}: calls defaultSendAccount()`);
      }
      // A bridge send whose account argument is a bare literal.
      for (const m of src.matchAll(/callBridge\(\s*'([^']+)'\s*,\s*'\/send/g)) {
        offenders.push(`${rel}: callBridge with a hardcoded account '${m[1]}'`);
      }
      // sendWhatsAppText without an accountId in the options object.
      for (const m of src.matchAll(/sendWhatsAppText\(([^;]*?)\)\s*;/gs)) {
        if (!/accountId/.test(m[1])) offenders.push(`${rel}: sendWhatsAppText without accountId`);
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], `implicit account selection found:\n  ${offenders.join('\n  ')}`);
});

test('AUDIT: scheduled sends use the STORED account, never re-derive it from the chat', () => {
  const root = path.resolve(import.meta.dirname, '..');
  for (const rel of [path.join('whatsapp', 'scheduledWorker.js'), path.join('routes', 'dealTasks.js')]) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.ok(!/callBridge\(\s*\w+\.chat\.accountId/.test(src),
      `${rel} re-derives the account from the chat instead of using the one chosen at scheduling time`);
  }
});
