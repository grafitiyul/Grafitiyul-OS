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

// Language strictness — a name recorded only in Hebrew must NEVER appear in an
// English message, and vice versa. An empty greeting is the correct output.
test('English NEVER borrows a Hebrew-only first name', () => {
  const out = resolveTemplateBody(BODY, ctxWith({ firstNameHe: 'דליה', firstNameEn: '' }), 'en');
  assert.ok(!out.text.includes('דליה'));
  assert.ok(!out.text.includes('{{'));
  assert.ok(!out.text.includes('@'));
  assert.equal(out.text, 'היי,\n\nרציתי לעדכן ש...'); // body chrome is Hebrew here; the NAME is what matters
  assert.deepEqual(out.missing, ['customer_first_name']);
});

test('Hebrew NEVER borrows an English-only first name', () => {
  const out = resolveTemplateBody(BODY, ctxWith({ firstNameHe: '', firstNameEn: 'John' }), 'he');
  assert.ok(!out.text.includes('John'));
  assert.ok(!out.text.includes('{{'));
  assert.equal(out.text, 'היי,\n\nרציתי לעדכן ש...');
});

test('each language uses its own name when both exist', () => {
  const ctx = ctxWith({ firstNameHe: 'ענת', firstNameEn: 'Anat' });
  assert.ok(resolveTemplateBody(BODY, ctx, 'he').text.includes('ענת'));
  assert.ok(!resolveTemplateBody(BODY, ctx, 'he').text.includes('Anat'));
  assert.ok(resolveTemplateBody(BODY, ctx, 'en').text.includes('Anat'));
  assert.ok(!resolveTemplateBody(BODY, ctx, 'en').text.includes('ענת'));
});

test('an English greeting with no English name reads cleanly, with no stray punctuation', () => {
  const en = '<p>Hi {{customer_first_name}},</p><p>Following your interest…</p>';
  const out = resolveTemplateBody(en, ctxWith({ firstNameHe: 'דוד' }), 'en');
  assert.equal(out.text, 'Hi,\n\nFollowing your interest…');
});

test('the automated delivery engine KEEPS its cross-language fallback (unchanged)', async () => {
  const { resolveVariables } = await import('../communication/variables.js');
  const ctx = ctxWith({ firstNameHe: 'דליה', firstNameEn: '' });
  const lenient = resolveVariables(['customer_first_name'], ctx, 'en');
  assert.equal(lenient.values.customer_first_name, 'דליה');
  const strict = resolveVariables(['customer_first_name'], ctx, 'en', { strictLanguage: true });
  assert.equal(strict.values.customer_first_name, null);
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

// ── Audience scoping (guide templates) ───────────────────────────────────────
//
// One table, two variable sets. The guarantee under test: a template can never
// STORE a token its audience cannot resolve, so a raw {{token}} can never reach
// a customer or a guide because the two sets were confused.

test('each audience exposes its own variable set', async () => {
  const { templateVariableKeys, templateAudience } = await import('./templateResolve.js');
  assert.deepEqual(templateVariableKeys('customer'), ['customer_first_name']);
  const guide = templateVariableKeys('guide');
  assert.ok(guide.includes('staff_first_name'));
  assert.ok(guide.includes('tour_date_natural'));
  assert.ok(guide.includes('org_name'));
  assert.ok(!guide.includes('customer_first_name'), 'a guide message greets the GUIDE, not the customer');
  // Anything unrecognised falls back to the original audience, never to "all".
  assert.equal(templateAudience('nonsense'), 'customer');
  assert.equal(templateAudience(undefined), 'customer');
});

test('a customer-only variable is refused inside a guide template', () => {
  assert.deepEqual(unsupportedTokens('שלום {{customer_first_name}}', 'guide'), ['customer_first_name']);
  assert.deepEqual(unsupportedTokens('שלום {{customer_first_name}}', 'customer'), []);
});

test('a guide/tour variable is refused inside a customer template', () => {
  assert.deepEqual(unsupportedTokens('הסיור היה {{tour_date_natural}}', 'customer'), ['tour_date_natural']);
  assert.deepEqual(unsupportedTokens('הסיור היה {{tour_date_natural}}', 'guide'), []);
});

test('guide-flavoured spellings are accepted on input and fold onto canonical keys', () => {
  assert.equal(canonicalTemplateKey('guide_first_name'), 'staff_first_name');
  assert.equal(canonicalTemplateKey('organization_name'), 'org_name');
  assert.equal(canonicalTemplateKey('customer_name'), 'customer_full_name');
  assert.deepEqual(unsupportedTokens('היי {{guide_first_name}} מ-{{organization_name}}', 'guide'), []);
  // …and are REWRITTEN before storage, so the database holds one spelling.
  assert.equal(
    canonicalizeTemplateTokens('היי {{guide_first_name}}'),
    'היי {{staff_first_name}}',
  );
});

test('the guide picker speaks about the guide, not about "איש צוות"', () => {
  const vars = templateVariables('guide');
  const first = vars.find((v) => v.key === 'staff_first_name');
  assert.equal(first.labelHe, 'שם פרטי של המדריך');
  const date = vars.find((v) => v.key === 'tour_date_natural');
  assert.match(date.descriptionHe, /היום/);
});
