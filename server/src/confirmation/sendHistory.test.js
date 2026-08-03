// First-send vs repeat-send semantics. Pure subject logic + a fake-db count.
// Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSendSubject,
  applyRepeatSuffix,
  stripRepeatSuffix,
  applyTestMarker,
  countRealSends,
  REPEAT_SUFFIX,
} from './sendHistory.js';

const SUBJ = 'אישור פעילות — גרפיטיול';

// ── subject composition ──────────────────────────────────────────────────────

test('first real send uses the template subject exactly', () => {
  assert.equal(buildSendSubject({ subject: SUBJ, lang: 'he', isTest: false, priorRealSends: 0 }), SUBJ);
});

test('repeat real send appends the language-correct marker', () => {
  assert.equal(
    buildSendSubject({ subject: SUBJ, lang: 'he', isTest: false, priorRealSends: 1 }),
    'אישור פעילות — גרפיטיול - הכי עדכני',
  );
  assert.equal(
    buildSendSubject({ subject: 'Activity confirmation — Grafitiyul', lang: 'en', isTest: false, priorRealSends: 3 }),
    'Activity confirmation — Grafitiyul - most updated',
  );
});

test('the marker NEVER doubles (retries, double-clicks, stored subjects)', () => {
  const once = applyRepeatSuffix(SUBJ, 'he');
  assert.equal(applyRepeatSuffix(once, 'he'), once);
  // even if a stored template subject wrongly carried it, one marker survives
  assert.equal(
    buildSendSubject({ subject: once, lang: 'he', isTest: false, priorRealSends: 2 }),
    once,
  );
  // and a cross-language leftover is normalized, not stacked
  assert.equal(stripRepeatSuffix(`${SUBJ}${REPEAT_SUFFIX.en}${REPEAT_SUFFIX.he}`), SUBJ);
});

test('test send: marker at the END, and never "most updated"', () => {
  assert.equal(
    buildSendSubject({ subject: SUBJ, lang: 'he', isTest: true, priorRealSends: 0 }),
    'אישור פעילות — גרפיטיול [בדיקה]',
  );
  // prior real sends must NOT turn a test into an "updated" subject
  assert.equal(
    buildSendSubject({ subject: SUBJ, lang: 'he', isTest: true, priorRealSends: 5 }),
    'אישור פעילות — גרפיטיול [בדיקה]',
  );
  assert.equal(applyTestMarker(applyTestMarker(SUBJ)), applyTestMarker(SUBJ)); // no doubling
});

// ── history counting ─────────────────────────────────────────────────────────

const fakeDb = (sends, queue = []) => ({
  confirmationEmailSend: { findMany: async () => sends },
  scheduledEmail: { findMany: async ({ where }) => queue.filter((q) => where.id.in.includes(q.id)) },
});

test('no history → 0 (the next send is the first)', async () => {
  assert.equal(await countRealSends(fakeDb([]), 'd1'), 0);
});

test('test sends never count', async () => {
  const db = fakeDb([
    { id: 's1', scheduledEmailId: 'q1', generationMeta: { test: true } },
    { id: 's2', scheduledEmailId: 'q2', generationMeta: { test: true } },
  ], [{ id: 'q1', status: 'sent' }, { id: 'q2', status: 'sent' }]);
  assert.equal(await countRealSends(db, 'd1'), 0);
});

test('queued and sent both count — the customer is getting them', async () => {
  const db = fakeDb([
    { id: 's1', scheduledEmailId: 'q1', generationMeta: {} },
    { id: 's2', scheduledEmailId: 'q2', generationMeta: {} },
  ], [{ id: 'q1', status: 'sent' }, { id: 'q2', status: 'pending' }]);
  assert.equal(await countRealSends(db, 'd1'), 2);
});

test('a permanently failed or cancelled attempt does NOT count', async () => {
  const db = fakeDb([
    { id: 's1', scheduledEmailId: 'q1', generationMeta: {} },
    { id: 's2', scheduledEmailId: 'q2', generationMeta: {} },
  ], [{ id: 'q1', status: 'failed' }, { id: 'q2', status: 'cancelled' }]);
  assert.equal(await countRealSends(db, 'd1'), 0, 'the customer never received either');
});

test('mixed history counts only the live real ones', async () => {
  const db = fakeDb([
    { id: 's1', scheduledEmailId: 'q1', generationMeta: { test: true } }, // test
    { id: 's2', scheduledEmailId: 'q2', generationMeta: {} }, // failed
    { id: 's3', scheduledEmailId: 'q3', generationMeta: {} }, // sent ✓
  ], [{ id: 'q1', status: 'sent' }, { id: 'q2', status: 'failed' }, { id: 'q3', status: 'sent' }]);
  assert.equal(await countRealSends(db, 'd1'), 1);
});
