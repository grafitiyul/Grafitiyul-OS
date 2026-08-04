import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyNameScript, routeLeadName, nameFieldMismatch } from '../../../shared/nameLanguage.mjs';

test('classifyNameScript: the deterministic script rules', () => {
  assert.equal(classifyNameScript('ורד גולן'), 'he');
  assert.equal(classifyNameScript('Sarah Cohen'), 'en');
  assert.equal(classifyNameScript('José Müller'), 'en'); // extended Latin
  assert.equal(classifyNameScript('דנה Cohen'), 'mixed');
  assert.equal(classifyNameScript('050-1234567 !!'), 'neutral'); // punctuation/digits never decide
  assert.equal(classifyNameScript('  '), 'empty');
  assert.equal(classifyNameScript('Иван'), 'neutral'); // other scripts are never guessed
});

test('routeLeadName: Latin lead names land in the ENGLISH fields, Hebrew stays Hebrew', () => {
  const en = routeLeadName({ firstName: 'Shirleen', lastName: 'Askenazi' });
  assert.deepEqual(en, { firstNameHe: '', lastNameHe: '', firstNameEn: 'Shirleen', lastNameEn: 'Askenazi', script: 'en' });
  const he = routeLeadName({ firstName: 'ורד', lastName: 'גולן' });
  assert.deepEqual(he, { firstNameHe: 'ורד', lastNameHe: 'גולן', firstNameEn: '', lastNameEn: '', script: 'he' });
});

test('routeLeadName: a MIXED pair is never split across languages — whole in the default fields', () => {
  const mixed = routeLeadName({ firstName: 'Dana', lastName: 'לוי' });
  assert.equal(mixed.script, 'mixed');
  assert.equal(mixed.firstNameHe, 'Dana');
  assert.equal(mixed.lastNameHe, 'לוי');
  assert.equal(mixed.firstNameEn, '');
});

test('routeLeadName: neutral punctuation/whitespace does not flip the language', () => {
  const he = routeLeadName({ firstName: 'ורד-גל', lastName: '(גולן)' });
  assert.equal(he.script, 'he');
  const en = routeLeadName({ firstName: "O'Brien", lastName: '-' });
  assert.equal(en.script, 'en');
});

test('nameFieldMismatch: only FULLY-wrong-script values are flagged', () => {
  assert.equal(nameFieldMismatch('he', 'Sarah'), 'belongs_en');
  assert.equal(nameFieldMismatch('en', 'שרה'), 'belongs_he');
  assert.equal(nameFieldMismatch('he', 'שרה Cohen'), null); // mixed — allowed
  assert.equal(nameFieldMismatch('he', ''), null);
  assert.equal(nameFieldMismatch('en', '123'), null); // neutral — allowed
});
