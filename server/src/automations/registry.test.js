import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerAutomation, validateDefinition,
  TRIGGER_KINDS, validateRegistry, definitionHash,
  automationById, listAutomations, automationsForTrigger, listRegistryEntries,
  __resetRegistry,
} from './registry.js';
import { ALLOCATED, RETIRED, nextAvailableId } from './ledger.js';
import './definitions/index.js';

// Guard tests for the Automation Registry. These enforce the promises the whole
// module rests on — an AUT id means one thing forever, and the registry can
// never quietly lose an automation.

const baseDef = (over = {}) => ({
  id: 'AUT-900',
  slug: 'test_automation',
  nameHe: 'אוטומציית בדיקה',
  descriptionHe: 'תיאור',
  category: 'tours',
  defaultEnabled: true,
  trigger: { kind: 'external_lead_created' },
  when: null,
  actions: [{ kind: 'communication' }],
  dependsOn: [],
  idempotency: (ev) => `AUT-900:${ev.id}`,
  ...over,
});

// A definition can only be REGISTERED if its id is in the ledger, so tests
// lend themselves a SYNTHETIC slot (AUT-900) and take it back afterwards.
// Never a real id: a real id can be retired, and these tests mutate RETIRED.
function withAllocatedId(id, fn) {
  const had = ALLOCATED.includes(id);
  if (!had) ALLOCATED.push(id);
  try {
    return fn();
  } finally {
    if (!had) ALLOCATED.splice(ALLOCATED.indexOf(id), 1);
    __resetRegistry();
  }
}

// ── the live registry ────────────────────────────────────────────────────────

test('the real registry is internally consistent', () => {
  assert.deepEqual(validateRegistry(), []);
});

test('every allocated id resolves to a definition or a retirement', () => {
  // This is the promise "if an automation exists in production it appears in
  // the registry" as an assertion rather than a hope.
  for (const entry of listRegistryEntries()) {
    assert.ok(entry.def || entry.retired, `${entry.id} has neither a definition nor a retirement record`);
  }
});

test('nextAvailableId follows the highest allocation', () => {
  assert.equal(nextAvailableId(), `AUT-${String(ALLOCATED.length + 1).padStart(3, '0')}`);
});

// ── definition validation ────────────────────────────────────────────────────

test('a well-formed definition validates', () => {
  withAllocatedId('AUT-900', () => {
    assert.deepEqual(validateDefinition(baseDef()), []);
  });
});

test('an id outside the ledger is rejected', () => {
  const problems = validateDefinition(baseDef({ id: 'AUT-999' }));
  assert.ok(problems.some((p) => p.startsWith('id_not_in_ledger')));
});

test('a malformed id is rejected', () => {
  assert.ok(validateDefinition(baseDef({ id: 'AUT-1' })).includes('id_must_match_AUT-NNN'));
  assert.ok(validateDefinition(baseDef({ id: 'coordination' })).includes('id_must_match_AUT-NNN'));
});

test('a retired id can never be revived', () => {
  // Reviving a tombstone would make "AUT-014" mean two different things across
  // time — the single thing an AUT id must never do.
  withAllocatedId('AUT-900', () => {
    RETIRED['AUT-900'] = { retiredOn: '2026-09-01', reasonHe: 'הוחלפה' };
    try {
      assert.ok(validateDefinition(baseDef()).some((p) => p.startsWith('id_is_retired')));
    } finally {
      delete RETIRED['AUT-900'];
    }
  });
});

test('answer conditions must reference stable question keys, never labels', () => {
  // The rule that keeps content editable: a condition bound to wording would
  // break the moment someone rephrased the question.
  const byLabel = validateDefinition(baseDef({
    when: { q: 'האם בוצעה שיחה?', op: 'eq', value: 'כן' },
  }));
  assert.ok(byLabel.some((p) => p.startsWith('condition_must_reference_question_key')));

  withAllocatedId('AUT-900', () => {
    assert.deepEqual(
      validateDefinition(baseDef({ when: { q: 'q_9f3a12bd', op: 'eq', value: 'o_7c21ab90' } })),
      [],
    );
  });
});

test('answer conditions must reference option keys, never answer text', () => {
  const problems = validateDefinition(baseDef({
    when: { q: 'q_9f3a12bd', op: 'eq', value: 'o_NOTAKEY' },
  }));
  assert.ok(problems.some((p) => p.startsWith('condition_value_must_be_option_key')));
});

test('non-option condition values are left alone', () => {
  // Numeric and free-text comparisons are legitimately not option keys.
  withAllocatedId('AUT-900', () => {
    assert.deepEqual(validateDefinition(baseDef({ when: { q: 'q_9f3a12bd', op: 'gt', value: 20 } })), []);
    assert.deepEqual(validateDefinition(baseDef({ when: { q: 'q_9f3a12bd', op: 'answered' } })), []);
  });
});

test('unknown action kinds and dependency kinds are rejected', () => {
  assert.ok(validateDefinition(baseDef({ actions: [{ kind: 'send_sms' }] }))
    .some((p) => p.startsWith('unknown_action_kind')));
  assert.ok(validateDefinition(baseDef({ dependsOn: [{ kind: 'admin_report', number: 4 }] }))
    .some((p) => p.startsWith('unknown_dependency_kind')));
});

test('an automation without an idempotency rule is rejected', () => {
  // Without it a replayed trigger acts twice.
  assert.ok(validateDefinition(baseDef({ idempotency: undefined }))
    .includes('idempotency_function_required'));
});

test('a trigger kind with no source is rejected — an orphan trigger never fires', () => {
  // questionnaire_submitted was removed with the last questionnaire automation.
  // A definition using it must fail at BOOT, not sit in the registry silently
  // waiting for an event nothing emits.
  assert.ok(validateDefinition(baseDef({ trigger: { kind: 'questionnaire_submitted', templateKey: 'x' } }))
    .some((x) => x.startsWith('unknown_trigger_kind')));
});

// ── registration ─────────────────────────────────────────────────────────────

test('registering an invalid definition throws at boot, not at trigger time', () => {
  assert.throws(() => registerAutomation(baseDef({ id: 'AUT-999' })), /invalid automation definition/);
});

test('a definition cannot be registered twice', () => {
  withAllocatedId('AUT-900', () => {
    registerAutomation(baseDef());
    assert.throws(() => registerAutomation(baseDef()), /already registered/);
  });
});

test('registered definitions are readable and trigger-matchable', () => {
  withAllocatedId('AUT-900', () => {
    registerAutomation(baseDef());
    assert.equal(automationById('AUT-900').nameHe, 'אוטומציית בדיקה');
    assert.equal(listAutomations().length, 1);

    assert.equal(automationsForTrigger({ kind: 'external_lead_created' }).length, 1);
    // A different kind matches nothing — the kind IS the identity.
    assert.equal(automationsForTrigger({ kind: 'something_else' }).length, 0);
  });
});

test('the live registry declares only trigger kinds a source actually emits', () => {
  // Every declared kind must have a fire site, or a definition can be added,
  // pass validation, appear in the UI and never run.
  assert.deepEqual(TRIGGER_KINDS, ['external_lead_created']);
});

// ── definition drift ─────────────────────────────────────────────────────────

test('the definition hash ignores prose but catches behaviour', () => {
  const a = baseDef();
  // Rewording documentation must not read as a behaviour change, or the change
  // log fills with noise and stops meaning anything.
  assert.equal(definitionHash(a), definitionHash(baseDef({
    nameHe: 'שם אחר', descriptionHe: 'תיאור אחר', notesHe: 'הערה',
  })));

  assert.notEqual(definitionHash(a), definitionHash(baseDef({ when: { q: 'q_9f3a12bd', op: 'answered' } })));
  assert.notEqual(definitionHash(a), definitionHash(baseDef({ actions: [{ kind: 'review_item', reviewKind: 'x' }] })));
  assert.notEqual(definitionHash(a), definitionHash(baseDef({ defaultEnabled: false })));
  assert.notEqual(definitionHash(a), definitionHash(baseDef({ idempotency: (ev) => `AUT-900:${ev.other}` })));
});

test('the definition hash is stable across key order and reformatting', () => {
  const a = baseDef({ dependsOn: [{ kind: 'communication_trigger', triggerType: 'deal_won', severity: 'soft' }] });
  const b = baseDef({ dependsOn: [{ severity: 'soft', triggerType: 'deal_won', kind: 'communication_trigger' }] });
  assert.equal(definitionHash(a), definitionHash(b));

  const spaced = baseDef({ idempotency: (ev) => `AUT-900:${ev.id}` });
  assert.equal(definitionHash(baseDef()), definitionHash(spaced));
});
