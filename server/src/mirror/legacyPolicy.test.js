// The cutover contract, pinned.
//
// These tests are not about code paths — they are about the business decision of
// 2026-07-31 being enforceable and un-drift-able. If one of them fails, either
// the architecture changed on purpose (and the test should change with it) or a
// retired integration has quietly come back to life.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_MODE,
  isRetired,
  isSystemRetired,
  legacyCapabilities,
  legacyMode,
  policyStatus,
  refusalReason,
} from './legacyPolicy.js';

const CUTOVER = {};                                  // no env var set = the target architecture
const BREAK_GLASS = { LEGACY_MIRROR_MODE: 'full_mirror' };

// ── the default is the target architecture ───────────────────────────────────

test('cutover is the DEFAULT — the full mirror must be asked for explicitly', () => {
  assert.equal(legacyMode(CUTOVER), LEGACY_MODE.CUTOVER);
  assert.equal(legacyMode({ LEGACY_MIRROR_MODE: '' }), LEGACY_MODE.CUTOVER);
  assert.equal(legacyMode({ LEGACY_MIRROR_MODE: 'nonsense' }), LEGACY_MODE.CUTOVER);
  assert.equal(legacyMode(BREAK_GLASS), LEGACY_MODE.FULL_MIRROR);
});

// ── Airtable is gone ─────────────────────────────────────────────────────────

test('Airtable holds NO authority of any kind', () => {
  const caps = legacyCapabilities('airtable', 'tourEvent', CUTOVER);
  assert.deepEqual(caps, { create: false, update: false, dispose: false });
  assert.equal(isSystemRetired('airtable', CUTOVER), true);
});

test('no scheduling, no guides, no participants — the four things Airtable used to own', () => {
  // All four Airtable poll targets declare entity 'tourEvent': the master tours
  // table plus the coordination (participants + guides) and payroll children.
  // One retired entity therefore retires all of them, which is why this reads
  // like a single assertion for four capabilities.
  assert.equal(isRetired('airtable', 'tourEvent', CUTOVER), true);
});

// ── Pipedrive is a lead ingress and nothing else ─────────────────────────────

test('Pipedrive may propose a NEW lead', () => {
  assert.equal(legacyCapabilities('pipedrive', 'deal', CUTOVER).create, true);
});

test('a lead arrives whole — its person and company may be created with it', () => {
  assert.equal(legacyCapabilities('pipedrive', 'contact', CUTOVER).create, true);
  assert.equal(legacyCapabilities('pipedrive', 'organization', CUTOVER).create, true);
});

test('NOTHING else synchronizes: no updates, no status sync, no contacts sync, no orgs sync', () => {
  for (const entity of ['deal', 'contact', 'organization']) {
    assert.equal(legacyCapabilities('pipedrive', entity, CUTOVER).update, false, `${entity} still updates`);
  }
});

test('activities, notes and files are retired outright', () => {
  for (const entity of ['task', 'note', 'file']) {
    assert.equal(isRetired('pipedrive', entity, CUTOVER), true, `pipedrive:${entity} is still live`);
  }
});

// ── propose, never dispose ───────────────────────────────────────────────────

test('NO system, in ANY mode, may dispose of GOS state through the policy', () => {
  for (const entity of ['deal', 'contact', 'organization', 'task', 'note', 'file']) {
    assert.equal(legacyCapabilities('pipedrive', entity, CUTOVER).dispose, false);
  }
  assert.equal(legacyCapabilities('airtable', 'tourEvent', CUTOVER).dispose, false);
});

// ── failing closed ───────────────────────────────────────────────────────────

test('an UNDECLARED source has no permissions — omission never grants authority', () => {
  assert.deepEqual(legacyCapabilities('pipedrive', 'invoice', CUTOVER), { create: false, update: false, dispose: false });
  assert.deepEqual(legacyCapabilities('salesforce', 'deal', CUTOVER), { create: false, update: false, dispose: false });
  // A typo in an entity name must fail closed, not silently reopen a path.
  assert.equal(isRetired('pipedrive', 'contacts', CUTOVER), true);
});

// ── the break-glass is real, and narrow ──────────────────────────────────────

test('break-glass restores synchronization', () => {
  assert.equal(legacyCapabilities('airtable', 'tourEvent', BREAK_GLASS).update, true);
  assert.equal(legacyCapabilities('pipedrive', 'deal', BREAK_GLASS).update, true);
  assert.equal(isSystemRetired('airtable', BREAK_GLASS), false);
});

// ── refusals explain themselves ──────────────────────────────────────────────

test('every refusal names the decision that made it, not a missing config', () => {
  assert.equal(refusalReason('airtable', 'tourEvent', 'any', CUTOVER).code, 'airtable_retired');
  assert.equal(refusalReason('pipedrive', 'note', 'any', CUTOVER).code, 'pipedrive_note_sync_retired');
  assert.equal(refusalReason('pipedrive', 'deal', 'update', CUTOVER).code, 'pipedrive_update_retired');
  assert.equal(refusalReason('pipedrive', 'deal', 'dispose', CUTOVER).code, 'legacy_may_not_dispose');
  for (const r of [
    refusalReason('airtable', 'tourEvent', 'any', CUTOVER),
    refusalReason('pipedrive', 'deal', 'update', CUTOVER),
  ]) {
    assert.ok(r.message.length > 40, 'a refusal must be readable a year from now');
  }
});

// ── the operator surface cannot lie ──────────────────────────────────────────

test('policyStatus reports exactly what the engine enforces', () => {
  const s = policyStatus(CUTOVER);
  assert.equal(s.mode, LEGACY_MODE.CUTOVER);
  assert.equal(s.cutoverComplete, true);
  const airtable = s.systems.find((x) => x.system === 'airtable');
  assert.equal(airtable.retired, true);
  const pipedrive = s.systems.find((x) => x.system === 'pipedrive');
  assert.equal(pipedrive.retired, false, 'the lead ingress is deliberately still live');
  for (const e of pipedrive.entities) {
    assert.equal(e.create, legacyCapabilities('pipedrive', e.entity, CUTOVER).create);
    assert.equal(e.update, legacyCapabilities('pipedrive', e.entity, CUTOVER).update);
  }
});
