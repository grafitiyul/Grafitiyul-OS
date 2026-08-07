import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWaMarkup, waPlainText } from './waFormat.js';
import { waPreviewHtml } from './waPreview.js';

// The contract of the ONE WhatsApp markup grammar. The authoring preview and
// the live conversation are two PAINTERS over these nodes — these tests are
// what stops them from drifting back into two interpretations.

const flat = (nodes) => nodes.map((n) => n.type).join(',');

test('the four WhatsApp marks parse — and the raw text is never mutated', () => {
  const raw = '*מודגש* _נטוי_ ~חוצה~ ```קוד```';
  const before = raw;
  const nodes = parseWaMarkup(raw);
  assert.ok(nodes.some((n) => n.type === 'bold'));
  assert.ok(nodes.some((n) => n.type === 'italic'));
  assert.ok(nodes.some((n) => n.type === 'strike'));
  assert.ok(nodes.some((n) => n.type === 'code'));
  // Formatting is presentation only: the canonical message body is untouched.
  assert.equal(raw, before);
});

test('marks nest — *a _b_ c* is bold containing italic', () => {
  const [bold] = parseWaMarkup('*שלום _דנה_ שלי*');
  assert.equal(bold.type, 'bold');
  assert.equal(flat(bold.children), 'text,italic,text');
});

test('a customer typing {{braces}} is NOT read as a GOS variable in a conversation', () => {
  // The live conversation shows text we did not write. `{{x}}` is an authoring
  // token, not WhatsApp markup.
  const conversation = parseWaMarkup('מחיר {{500}} שקל', { variables: false });
  assert.ok(!conversation.some((n) => n.type === 'variable'));
  assert.equal(waPlainText('מחיר {{500}} שקל'), 'מחיר {{500}} שקל');
  // The authoring preview keeps chips — same grammar, different painter.
  assert.ok(parseWaMarkup('שלום {{customer_first_name}}').some((n) => n.type === 'variable'));
});

test('a URL is one link node and its underscores/asterisks are not markup', () => {
  const nodes = parseWaMarkup('קישור https://grafitiyul.co.il/pay/a_b_c עכשיו');
  const link = nodes.find((n) => n.type === 'link');
  assert.equal(link.href, 'https://grafitiyul.co.il/pay/a_b_c');
  assert.ok(!nodes.some((n) => n.type === 'italic'));
});

test('a link that ENDS a bold span keeps the URL whole', () => {
  // splitTrailing (shared linkifyCore) already treats the closing `*` as
  // punctuation, so the bold span closes and the href stays clean.
  const [bold] = parseWaMarkup('*https://grafitiyul.co.il/a*');
  assert.equal(bold.type, 'bold');
  assert.equal(bold.children[0].href, 'https://grafitiyul.co.il/a');
});

test('newlines become break nodes, blank lines survive', () => {
  assert.equal(flat(parseWaMarkup('א\n\nב')), 'text,break,break,text');
});

test('waPlainText drops the syntax, keeps the words', () => {
  assert.equal(waPlainText('*שלום* _דנה_ ~בוטל~ ```קוד```'), 'שלום דנה בוטל קוד');
});

test('an unmatched marker is literal text, exactly as WhatsApp shows it', () => {
  assert.equal(waPlainText('5 * 3 = 15'), '5 * 3 = 15');
  assert.ok(!parseWaMarkup('5 * 3 = 15').some((n) => n.type === 'bold'));
});

test('a message body can never inject HTML through the preview painter', () => {
  const html = waPreviewHtml('<script>alert(1)</script> *מודגש*');
  assert.ok(!html.includes('<script'));
  assert.match(html, /&lt;script/);
  assert.match(html, /<strong>מודגש<\/strong>/);
});

test('a NUL byte in the body cannot impersonate a placeholder', () => {
  const nul = String.fromCharCode(0);
  const nodes = parseWaMarkup(`שלום${nul}0${nul} *כן*`);
  assert.ok(nodes.some((n) => n.type === 'bold'));
  assert.equal(waPlainText(`שלום${nul}0${nul}`), 'שלום0');
});
