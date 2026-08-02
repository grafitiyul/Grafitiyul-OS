import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAutomation, automationTriggerType, autIdFromTriggerType, __resetRegistry, TRIGGER_KINDS,
} from './registry.js';
import { ALLOCATED } from './ledger.js';
import {
  allTriggers, allTriggerTypes, triggerByType, isDerivedTrigger,
  CATEGORY_LABELS, unregisterDerivedTrigger,
} from '../communication/triggerCatalog.js';
import { TRIGGERS as BUILT_IN } from '../communication/triggers.js';

// The registry declares NO trigger kinds: every one was removed with the
// automation it served. These tests exercise the generic engine, so they lend
// it a synthetic kind — the same trick withAllocatedId plays with ids.
const TEST_TRIGGER_KIND = 'test_event';
if (!TRIGGER_KINDS.includes(TEST_TRIGGER_KIND)) TRIGGER_KINDS.push(TEST_TRIGGER_KIND);

// The bridge that keeps automations from becoming a second messaging system:
// a registered automation appears in the Communication Center's trigger picker,
// and everything downstream (validation, variables, recipients, delivery,
// retries) treats it exactly like a built-in trigger.

const def = (over = {}) => ({
  id: 'AUT-900',
  slug: 'a',
  nameHe: 'התקבל תשלום',
  descriptionHe: 'נורה כשסיכום סיור מדווח על תשלום שהתקבל.',
  category: 'tours',
  defaultEnabled: true,
  trigger: { kind: TEST_TRIGGER_KIND },
  when: null,
  actions: [{ kind: 'communication' }],
  dependsOn: [],
  idempotency: (e) => e.id,
  ...over,
});

function withDef(d, fn) {
  const borrowed = !ALLOCATED.includes(d.id);
  if (borrowed) ALLOCATED.push(d.id);
  try {
    registerAutomation(d);
    return fn();
  } finally {
    unregisterDerivedTrigger(automationTriggerType(d.id));
    __resetRegistry();
    if (borrowed) ALLOCATED.splice(ALLOCATED.indexOf(d.id), 1);
  }
}

test('the trigger type derivation round-trips', () => {
  assert.equal(automationTriggerType('AUT-014'), 'automation:AUT-014');
  assert.equal(autIdFromTriggerType('automation:AUT-014'), 'AUT-014');
  assert.equal(autIdFromTriggerType('deal_won'), null);
  assert.equal(autIdFromTriggerType('automation:nonsense'), null);
});

test('registering an automation puts it in the Communication Center picker', () => {
  withDef(def(), () => {
    const t = triggerByType('automation:AUT-900');
    assert.ok(t, 'the automation trigger must resolve');
    assert.equal(t.labelHe, 'AUT-900 · התקבל תשלום');
    assert.equal(t.category, 'automations');
    assert.ok(allTriggerTypes().includes('automation:AUT-900'));
    assert.ok(CATEGORY_LABELS.automations, 'the picker needs a Hebrew category label');
  });
});

test('an automation trigger carries real business contexts, so variables work unchanged', () => {
  withDef(def(), () => {
    const t = triggerByType('automation:AUT-900');
    // These must be EXISTING context branches — inventing a new one would mean
    // the variable/document resolvers know nothing about it.
    const known = new Set(BUILT_IN.flatMap((b) => b.contexts));
    for (const c of t.contexts) {
      assert.ok(known.has(c), `context "${c}" is not a known Communication Center context`);
    }
  });
});

test('an automation trigger anchors on trigger_time only', () => {
  // A questionnaire submission is a past-tense fact; "3 days before the tour"
  // is meaningless for it, and the activation validator enforces anchors.
  withDef(def(), () => {
    assert.deepEqual(triggerByType('automation:AUT-900').anchors, ['trigger_time']);
  });
});

test('built-in triggers are untouched by the bridge', () => {
  const before = BUILT_IN.length;
  withDef(def(), () => {
    assert.equal(BUILT_IN.length, before, 'the static catalog must never be mutated');
    assert.ok(triggerByType('deal_won'), 'built-in triggers still resolve');
    assert.equal(isDerivedTrigger('deal_won'), false);
    assert.equal(isDerivedTrigger('automation:AUT-900'), true);
    // Built-ins come first in the picker.
    assert.equal(allTriggers()[0].type, BUILT_IN[0].type);
  });
});

test('unregistering removes the trigger — a retired automation leaves no picker entry', () => {
  withDef(def(), () => {
    assert.ok(triggerByType('automation:AUT-900'));
  });
  assert.equal(triggerByType('automation:AUT-900'), null);
  assert.equal(allTriggerTypes().includes('automation:AUT-900'), false);
});

test('the composed catalog is what publish/activation validation sees', async () => {
  // Regression guard for the subtle failure this bridge could produce: if
  // validation imported the STATIC list, every automation-backed message would
  // be rejected as "טריגר לא תקין" at activation.
  const { validateEventForActivation } = await import('../communication/validation.js');
  withDef(def(), () => {
    const errors = validateEventForActivation({
      internalName: 'הודעת מנהלים',
      triggerType: 'automation:AUT-900',
      anchorType: 'trigger_time',
      timingMode: 'immediate',
    });
    assert.equal(errors.includes('טריגר לא תקין'), false, `unexpected: ${errors.join(', ')}`);
    assert.equal(errors.includes('עוגן הזמן שנבחר אינו נתמך עבור הטריגר'), false);
  });
});

test('a dependency on an automation trigger resolves through the composed catalog', async () => {
  const { resolveDependency } = await import('./dependencies.js');
  const db = { communicationEvent: { findMany: async () => [] } };
  withDef(def(), async () => {
    const r = await resolveDependency(
      { kind: 'communication_trigger', triggerType: 'automation:AUT-900' },
      { db },
    );
    // No rule configured yet ⇒ soft (waiting), NOT hard (unknown trigger).
    assert.equal(r.severity, 'soft');
    assert.match(r.detailHe, /לא הוגדר אירוע תקשורת פעיל/);
  });
});
