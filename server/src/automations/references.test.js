import test from 'node:test';
import assert from 'node:assert/strict';
import { keysUsedBy, referencesForTemplate, referencePayloadForTemplate } from './references.js';
import { registerAutomation, __resetRegistry } from './registry.js';
import { ALLOCATED } from './ledger.js';

// Which questionnaire keys an automation depends on. This is what the publish
// guard protects and what the builder panel displays, so missing a reference
// source here would let a "healthy" automation depend on an unprotected key.

const def = (over = {}) => ({
  id: 'AUT-001',
  slug: 'a',
  nameHe: 'אוטומציה א',
  descriptionHe: 'x',
  category: 'tours',
  defaultEnabled: true,
  trigger: { kind: 'questionnaire_submitted', templateKey: 'tour_coordination' },
  when: null,
  actions: [{ kind: 'communication' }],
  dependsOn: [],
  idempotency: (e) => e.id,
  ...over,
});

function withRegistry(defs, fn) {
  const borrowed = [];
  for (const d of defs) {
    if (!ALLOCATED.includes(d.id)) { ALLOCATED.push(d.id); borrowed.push(d.id); }
  }
  try {
    for (const d of defs) registerAutomation(d);
    return fn();
  } finally {
    __resetRegistry();
    for (const id of borrowed) ALLOCATED.splice(ALLOCATED.indexOf(id), 1);
  }
}

test('keys come from BOTH the conditions and the declared dependencies', () => {
  const used = keysUsedBy(def({
    when: { all: [{ q: 'q_aaaaaaaa', op: 'answered' }, { q: 'q_bbbbbbbb', op: 'eq', value: 'o_11111111' }] },
    dependsOn: [
      { kind: 'questionnaire_question', templateKey: 'tour_coordination', questionKey: 'q_cccccccc' },
      { kind: 'questionnaire_option', templateKey: 'tour_coordination', questionKey: 'q_dddddddd', optionValue: 'o_22222222' },
      { kind: 'communication_trigger', triggerType: 'deal_won' },
    ],
  }));

  assert.deepEqual(used.questionKeys.sort(), ['q_aaaaaaaa', 'q_bbbbbbbb', 'q_cccccccc', 'q_dddddddd']);
  assert.deepEqual(used.optionValues.sort(), ['q_bbbbbbbb:o_11111111', 'q_dddddddd:o_22222222']);
  assert.equal(used.templateKey, 'tour_coordination');
});

test('option keys inside in/nin arrays are collected', () => {
  const used = keysUsedBy(def({
    when: { q: 'q_aaaaaaaa', op: 'in', value: ['o_11111111', 'o_22222222'] },
  }));
  assert.deepEqual(used.optionValues.sort(), ['q_aaaaaaaa:o_11111111', 'q_aaaaaaaa:o_22222222']);
});

test('non-option condition values are not mistaken for option keys', () => {
  const used = keysUsedBy(def({ when: { q: 'q_aaaaaaaa', op: 'gt', value: 20 } }));
  assert.deepEqual(used.optionValues, []);
  assert.deepEqual(used.questionKeys, ['q_aaaaaaaa']);
});

test('references are scoped to the automation\'s own template', () => {
  // A key is only stable inside its template — a same-named key elsewhere is a
  // different question and must never be treated as a dependency.
  withRegistry(
    [
      def({ id: 'AUT-001', slug: 'a', when: { q: 'q_aaaaaaaa', op: 'answered' } }),
      def({
        id: 'AUT-002', slug: 'b', nameHe: 'אוטומציה ב',
        trigger: { kind: 'questionnaire_submitted', templateKey: 'other_form' },
        when: { q: 'q_aaaaaaaa', op: 'answered' },
      }),
    ],
    () => {
      const refs = referencesForTemplate('tour_coordination');
      assert.deepEqual(refs.questions.get('q_aaaaaaaa').map((a) => a.autId), ['AUT-001']);

      const other = referencesForTemplate('other_form');
      assert.deepEqual(other.questions.get('q_aaaaaaaa').map((a) => a.autId), ['AUT-002']);
    },
  );
});

test('several automations on one key are all reported', () => {
  withRegistry(
    [
      def({ id: 'AUT-001', slug: 'a', when: { q: 'q_aaaaaaaa', op: 'answered' } }),
      def({ id: 'AUT-002', slug: 'b', nameHe: 'אוטומציה ב', when: { q: 'q_aaaaaaaa', op: 'empty' } }),
    ],
    () => {
      const refs = referencesForTemplate('tour_coordination');
      assert.deepEqual(refs.questions.get('q_aaaaaaaa').map((a) => a.autId), ['AUT-001', 'AUT-002']);
    },
  );
});

test('the builder payload nests option references under their question', () => {
  withRegistry(
    [def({ when: { q: 'q_aaaaaaaa', op: 'eq', value: 'o_11111111' } })],
    () => {
      const payload = referencePayloadForTemplate('tour_coordination');
      assert.deepEqual(payload.q_aaaaaaaa.automations.map((a) => a.autId), ['AUT-001']);
      assert.deepEqual(payload.q_aaaaaaaa.options.o_11111111.map((a) => a.autId), ['AUT-001']);
    },
  );
});

test('an empty registry yields no references (Slice 0 ships alone)', () => {
  __resetRegistry();
  const refs = referencesForTemplate('tour_coordination');
  assert.equal(refs.questions.size, 0);
  assert.equal(refs.options.size, 0);
  assert.deepEqual(referencePayloadForTemplate('tour_coordination'), {});
});
