import test from 'node:test';
import assert from 'node:assert/strict';
import { waPreviewHtml } from './waPreview.js';
import { htmlToWhatsApp } from '../../../../shared/waMarkup.mjs';

// The contract of the ONE preview renderer. Every WhatsApp preview in GOS runs
// through waPreviewHtml, in exactly two states — template (variables present)
// and resolved (variables already substituted for a real recipient) — so these
// tests are what stop the two states from drifting into two renderers.

test('formatting survives: bold, italic, strike, monospace', () => {
  const html = waPreviewHtml('*מודגש* _נטוי_ ~חוצה~ ```קוד```');
  assert.match(html, /<strong>מודגש<\/strong>/);
  assert.match(html, /<em>נטוי<\/em>/);
  assert.match(html, /<s>חוצה<\/s>/);
  assert.match(html, /<code[^>]*>קוד<\/code>/);
});

test('line structure survives — blank lines and bullets are not collapsed', () => {
  const html = waPreviewHtml('שלום\n\n- אחד\n- שתיים');
  assert.equal((html.match(/<br>/g) || []).length, 3);
  assert.match(html, /- אחד/);
});

test('links are marked up, and markup inside them is not invented', () => {
  const html = waPreviewHtml('פרטים: https://grafitiyul.co.il/a');
  assert.match(html, /class="text-sky-700 underline">https:\/\/grafitiyul\.co\.il\/a</);
});

test('HTML in the message is escaped, never executed', () => {
  const html = waPreviewHtml('<img src=x onerror=alert(1)> & <b>');
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img/);
  assert.match(html, /&amp;/);
});

test('a variable renders as a chip, and its underscores are NOT read as italics', () => {
  // customer_first_name contains `_first_`, which the italic rule would eat —
  // mangling the chip and hiding that the variable was recognised at all.
  const html = waPreviewHtml('שלום {{customer_first_name}}');
  assert.ok(!html.includes('<em>'));
  assert.match(html, /customer_first_name/);
});

test('a URL containing underscores is never italicised', () => {
  // Real payment/portal links carry underscores. Italicising half a link is a
  // preview that misrepresents the message.
  const html = waPreviewHtml('קישור: https://grafitiyul.co.il/pay/a_b_c');
  assert.ok(!html.includes('<em>'));
  assert.match(html, /a_b_c/);
});

test('formatting still applies to prose AROUND a link or a chip', () => {
  const html = waPreviewHtml('*חשוב* https://x.co/a_b ו_גם_ זה');
  assert.match(html, /<strong>חשוב<\/strong>/);
  assert.match(html, /<em>גם<\/em>/);
  assert.match(html, /a_b/);
});

test('RESOLVED text renders identically — same renderer, real values', () => {
  // What the Team composer actually shows: the server substituted the variable,
  // so nothing is left but formatting. Visual accuracy AND real values, from
  // one code path.
  const resolved = 'שלום *דנה*, נתראה מחר';
  const html = waPreviewHtml(resolved);
  assert.match(html, /<strong>דנה<\/strong>/);
  assert.ok(!html.includes('{{'));
  assert.ok(!html.includes('bg-blue-100')); // no chips left in a resolved text
});

test('a variable that survived resolution stays visible as a chip', () => {
  // A missing value must not silently vanish from the preview — it is exactly
  // what the operator needs to see before sending.
  const html = waPreviewHtml('שלום {{staff_first_name}}');
  assert.match(html, /bg-blue-100/);
});

test('editor HTML → markup → preview keeps the author\'s formatting end to end', () => {
  // The full pipeline the operator experiences: TipTap HTML is serialized by
  // the SAME converter the server sends with, then previewed.
  const markup = htmlToWhatsApp('<p><strong>כותרת</strong></p><ul><li>פריט</li></ul>');
  assert.match(markup, /\*כותרת\*/);
  const html = waPreviewHtml(markup);
  assert.match(html, /<strong>כותרת<\/strong>/);
  assert.match(html, /- פריט/);
});
