import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFieldScript,
  planNameSlot,
  planContactNames,
  verifyContactNames,
} from './contactNameScript.js';

test('classifyFieldScript refines the canonical he/en/mixed verdicts', () => {
  assert.equal(classifyFieldScript('דור'), 'hebrew');
  assert.equal(classifyFieldScript('Dor'), 'latin');
  assert.equal(classifyFieldScript('José'), 'latin');
  assert.equal(classifyFieldScript('Dor דור'), 'mixed');
  assert.equal(classifyFieldScript(''), 'empty');
  assert.equal(classifyFieldScript('   '), 'empty');
  assert.equal(classifyFieldScript(null), 'empty');
});

test('classifyFieldScript names the scripts the canonical rule calls neutral', () => {
  assert.equal(classifyFieldScript('Алексей'), 'cyrillic');
  assert.equal(classifyFieldScript('محمد'), 'arabic');
  assert.equal(classifyFieldScript('Γιώργος'), 'greek');
  assert.equal(classifyFieldScript('田中'), 'other_script');
  assert.equal(classifyFieldScript('김민준'), 'other_script');
  assert.equal(classifyFieldScript('-'), 'no_letters');
  assert.equal(classifyFieldScript('123'), 'no_letters');
  assert.equal(classifyFieldScript('.'), 'no_letters');
});

test('two named non-Hebrew scripts in one value are mixed, never moved', () => {
  assert.equal(classifyFieldScript('Алексей محمد'), 'mixed');
});

test('already-correct pairs are left alone', () => {
  assert.equal(planNameSlot('first', 'דור', 'Dor').action, 'none');
  assert.equal(planNameSlot('first', 'דור', '').action, 'none');
  assert.equal(planNameSlot('first', '', 'Dor').action, 'none');
  assert.equal(planNameSlot('first', '', '').action, 'none');
});

test('Latin in the Hebrew column moves out when English is free', () => {
  const p = planNameSlot('first', 'John', '');
  assert.equal(p.action, 'he_to_en');
  assert.deepEqual(p.next, { he: '', en: 'John' });
});

test('Hebrew in the English column moves out when Hebrew is free', () => {
  const p = planNameSlot('last', '', 'כהן');
  assert.equal(p.action, 'en_to_he');
  assert.deepEqual(p.next, { he: 'כהן', en: '' });
});

test('Cyrillic and Arabic park in the English slot (owner decision) verbatim', () => {
  const ru = planNameSlot('first', 'Алексей', '');
  assert.equal(ru.action, 'he_to_en');
  assert.equal(ru.next.en, 'Алексей', 'never transliterated');
  const ar = planNameSlot('last', 'محمد', '');
  assert.equal(ar.action, 'he_to_en');
  assert.equal(ar.next.en, 'محمد', 'never transliterated');
});

test('an occupied destination is a conflict, never an overwrite', () => {
  const p = planNameSlot('first', 'John', 'Jonathan');
  assert.equal(p.action, 'conflict');
  assert.equal(p.next, undefined);
});

test('a destination holding punctuation is occupied, not free', () => {
  assert.equal(planNameSlot('first', 'John', '-').action, 'conflict');
});

test('mixed-script values are never split or guessed', () => {
  assert.equal(planNameSlot('first', 'Dor דור', '').action, 'mixed');
  assert.equal(planNameSlot('first', '', 'Dor דור').action, 'mixed');
});

test('a mutual misplacement swaps losslessly', () => {
  const p = planNameSlot('first', 'John', 'דור');
  assert.equal(p.action, 'swap');
  assert.deepEqual(p.next, { he: 'דור', en: 'John' });
});

test('planContactNames patches only the columns that change', () => {
  const plan = planContactNames({
    id: 'c1',
    contactNo: 50001,
    firstNameHe: 'John',
    lastNameHe: 'כהן',
    firstNameEn: '',
    lastNameEn: '',
  });
  assert.deepEqual(plan.patch, { firstNameHe: '', firstNameEn: 'John' });
  assert.equal(plan.moves, 1);
});

test('first stays first and last stays last — no semantic reordering', () => {
  const plan = planContactNames({
    id: 'c2',
    firstNameHe: 'Cohen',
    lastNameHe: 'David',
    firstNameEn: '',
    lastNameEn: '',
  });
  assert.deepEqual(plan.patch, {
    firstNameHe: '',
    firstNameEn: 'Cohen',
    lastNameHe: '',
    lastNameEn: 'David',
  });
});

test('the plan is idempotent — replanning a repaired row yields no moves', () => {
  const before = {
    id: 'c3',
    firstNameHe: 'John',
    lastNameHe: '',
    firstNameEn: '',
    lastNameEn: 'כהן',
  };
  const plan = planContactNames(before);
  const after = { ...before, ...plan.patch };
  assert.equal(planContactNames(after).moves, 0);
  assert.deepEqual(verifyContactNames(after), []);
});

test('conflicts stay dirty by design and are reported, not repaired', () => {
  const contact = {
    id: 'c4',
    firstNameHe: 'John',
    lastNameHe: '',
    firstNameEn: 'Jonathan',
    lastNameEn: '',
  };
  const plan = planContactNames(contact);
  assert.deepEqual(plan.patch, {});
  assert.equal(plan.hasBlocked, true);
});
