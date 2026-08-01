import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncAutomationChanges } from './boot.js';
import { registerAutomation, __resetRegistry, definitionHash } from './registry.js';
import { ALLOCATED } from './ledger.js';
import { unregisterDerivedTrigger } from '../communication/triggerCatalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Boot wiring is easy to break silently: an import can land while its CALL is
// lost, and nothing fails — the registry just quietly stops recording history.
// That happened once during development, hence this guard.

test('index.js both imports AND calls syncAutomationChanges', () => {
  const src = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
  assert.match(src, /import \{ syncAutomationChanges \}/, 'the import must exist');
  assert.match(src, /^\s*syncAutomationChanges\(/m, 'it must actually be CALLED at boot');
});

test('index.js validates the registry at boot', () => {
  const src = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
  assert.match(src, /^\s*const registryProblems = validateRegistry\(\);/m);
});

const def = (over = {}) => ({
  id: 'AUT-001',
  slug: 'boot_test',
  nameHe: 'בדיקה',
  descriptionHe: 'x',
  category: 'tours',
  defaultEnabled: true,
  trigger: { kind: 'questionnaire_submitted', templateKey: 'tour_summary' },
  when: null,
  actions: [{ kind: 'communication' }],
  dependsOn: [],
  idempotency: (e) => e.id,
  ...over,
});

function stubDb(existing = []) {
  const rows = [...existing];
  return {
    rows,
    automationChange: {
      findFirst: async ({ where }) =>
        rows.filter((r) => r.autId === where.autId && where.kind.in.includes(r.kind)).at(-1) || null,
      create: async ({ data }) => { rows.push(data); return data; },
    },
  };
}

const silent = { log: () => {}, warn: () => {} };

function withDef(d, fn) {
  const borrowed = !ALLOCATED.includes(d.id);
  if (borrowed) ALLOCATED.push(d.id);
  try {
    registerAutomation(d);
    return fn();
  } finally {
    unregisterDerivedTrigger(`automation:${d.id}`);
    __resetRegistry();
    if (borrowed) ALLOCATED.splice(ALLOCATED.indexOf(d.id), 1);
  }
}

test('a newly registered automation records itself once', async () => {
  const db = stubDb();
  await withDef(def(), async () => {
    await syncAutomationChanges(silent, { db });
    await syncAutomationChanges(silent, { db }); // a restart must not re-record
  });
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].kind, 'registered');
});

test('a changed DEFINITION records a drift row; changed PROSE does not', async () => {
  // The whole value of the change log is that it means something. Rewording a
  // description must not fill it with noise.
  const db = stubDb();
  await withDef(def(), async () => { await syncAutomationChanges(silent, { db }); });
  assert.equal(db.rows.length, 1);

  await withDef(def({ nameHe: 'שם אחר', descriptionHe: 'תיאור אחר' }), async () => {
    await syncAutomationChanges(silent, { db });
  });
  assert.equal(db.rows.length, 1, 'prose changes are not behaviour changes');

  await withDef(def({ when: { q: 'q_aaaaaaaa', op: 'answered' } }), async () => {
    await syncAutomationChanges(silent, { db });
  });
  assert.equal(db.rows.length, 2);
  assert.equal(db.rows[1].kind, 'definition_changed');
  assert.equal(db.rows[1].fromHash, definitionHash(def()));
});

test('a failing change sync never throws — it must not take the server down', async () => {
  const exploding = { automationChange: { findFirst: async () => { throw new Error('db down'); } } };
  await withDef(def(), async () => {
    await syncAutomationChanges(silent, { db: exploding }); // must not reject
  });
});
