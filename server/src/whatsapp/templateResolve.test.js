import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTemplateBody,
  normalizeAfterEmptyFill,
  unsupportedTokens,
  canonicalTemplateKey,
  canonicalizeTemplateTokens,
  templateVariables,
} from './templateResolve.js';

const chip = (key, label) => `<span data-type="dynamic-field" data-field-key="${key}">${label}</span>`;
const ctxWith = (contact) => ({ contact });
const BODY = `<p>היי ${chip('customer_first_name', 'שם פרטי של הלקוח')},</p><p>רציתי לעדכן ש...</p>`;

test('canonicalTemplateKey folds the first_name alias onto the canonical customer key', () => {
  assert.equal(canonicalTemplateKey('first_name'), 'customer_first_name');
  assert.equal(canonicalTemplateKey('customer_first_name'), 'customer_first_name');
});

test('templateVariables exposes exactly the supported set, labelled from the canonical registry', () => {
  const vars = templateVariables();
  assert.deepEqual(vars.map((v) => v.key), ['customer_first_name']);
  assert.equal(vars[0].labelHe, 'שם פרטי של הלקוח');
});

test('templateVariables carries business-language help, never the technical key', () => {
  const [v] = templateVariables();
  assert.equal(v.descriptionHe, 'מתמלא אוטומטית בשם הפרטי של הלקוח בדיל');
  assert.ok(!v.labelHe.includes('customer_first_name'));
  assert.ok(!v.descriptionHe.includes('customer_first_name'));
});

test('canonicalizeTemplateTokens stores the canonical token for an alias', () => {
  assert.equal(
    canonicalizeTemplateTokens('<p>היי {{first_name}},</p>'),
    '<p>היי {{customer_first_name}},</p>',
  );
});

test('canonicalizeTemplateTokens leaves canonical tokens, chips and other keys alone', () => {
  assert.equal(canonicalizeTemplateTokens('<p>{{customer_first_name}}</p>'), '<p>{{customer_first_name}}</p>');
  assert.equal(canonicalizeTemplateTokens(chip('customer_first_name', 'x')), chip('customer_first_name', 'x'));
  assert.equal(canonicalizeTemplateTokens('<p>{{tour_date}}</p>'), '<p>{{tour_date}}</p>');
  assert.equal(canonicalizeTemplateTokens(''), '');
});

test('unsupportedTokens accepts supported keys and the alias', () => {
  assert.deepEqual(unsupportedTokens(`<p>היי ${chip('customer_first_name', 'שם')}</p>`), []);
  assert.deepEqual(unsupportedTokens('<p>היי {{first_name}}</p>'), []);
});

test('unsupportedTokens flags anything this slice does not resolve', () => {
  assert.deepEqual(unsupportedTokens('<p>{{tour_date}} {{customer_first_name}}</p>'), ['tour_date']);
});

test('normalizeAfterEmptyFill removes the gap an empty value leaves before punctuation', () => {
  assert.equal(normalizeAfterEmptyFill('היי ,'), 'היי,');
  assert.equal(normalizeAfterEmptyFill('Hi !'), 'Hi!');
});

test('normalizeAfterEmptyFill collapses the doubled inner space', () => {
  assert.equal(normalizeAfterEmptyFill('היי  שלום'), 'היי שלום');
});

test('normalizeAfterEmptyFill keeps intentional blank lines', () => {
  assert.equal(normalizeAfterEmptyFill('שורה\n\n\nאחרת'), 'שורה\n\n\nאחרת');
});

test('normalizeAfterEmptyFill strips trailing spaces on every line', () => {
  assert.equal(normalizeAfterEmptyFill('היי \nמה נשמע '), 'היי\nמה נשמע');
});

test('resolveTemplateBody replaces the chip with the structured Hebrew first name', () => {
  const out = resolveTemplateBody(BODY, ctxWith({ firstNameHe: 'דליה', lastNameHe: 'כהן' }), 'he');
  assert.equal(out.text, 'היי דליה,\n\nרציתי לעדכן ש...');
  assert.deepEqual(out.missing, []);
});

test('resolveTemplateBody uses the English first name when the language is English', () => {
  const out = resolveTemplateBody(BODY, ctxWith({ firstNameHe: 'דליה', firstNameEn: 'Dalia' }), 'en');
  assert.ok(out.text.includes('Dalia'));
});

test('resolveTemplateBody falls back to the other language rather than emptying a known name', () => {
  const out = resolveTemplateBody(BODY, ctxWith({ firstNameHe: 'דליה' }), 'en');
  assert.ok(out.text.includes('דליה'));
});

test('resolveTemplateBody never leaks a raw token when there is no first name', () => {
  const out = resolveTemplateBody(BODY, ctxWith({ lastNameHe: 'כהן' }), 'he');
  assert.ok(!out.text.includes('{{'));
  assert.equal(out.text, 'היי,\n\nרציתי לעדכן ש...');
  assert.deepEqual(out.missing, ['customer_first_name']);
});

test('resolveTemplateBody never leaks a raw token when there is no contact at all', () => {
  const out = resolveTemplateBody(BODY, {}, 'he');
  assert.ok(!out.text.includes('{{'));
  assert.ok(!out.text.includes('}}'));
});

test('resolveTemplateBody resolves the {{first_name}} alias typed as raw text', () => {
  const out = resolveTemplateBody('<p>היי {{first_name}},</p>', ctxWith({ firstNameHe: 'דליה' }), 'he');
  assert.equal(out.text, 'היי דליה,');
});

test('resolveTemplateBody serializes WhatsApp formatting through the shared converter', () => {
  const out = resolveTemplateBody('<p><strong>מודגש</strong> ו<em>נטוי</em></p>', {}, 'he');
  assert.equal(out.text, '*מודגש* ו_נטוי_');
});

test('resolveTemplateBody returns empty text for an empty body', () => {
  assert.equal(resolveTemplateBody('', {}, 'he').text, '');
  assert.equal(resolveTemplateBody('<p></p>', {}, 'he').text, '');
});
