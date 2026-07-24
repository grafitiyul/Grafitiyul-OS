import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToWhatsApp, whatsAppTextPreview } from '../../../shared/waMarkup.mjs';

test('bold/italic/strike convert to WhatsApp marks', () => {
  assert.equal(htmlToWhatsApp('<p><strong>שלום</strong> <em>עולם</em> <s>לא</s></p>'), '*שלום* _עולם_ ~לא~');
});

test('paragraphs become blank-line separated; <br> is a single newline', () => {
  assert.equal(htmlToWhatsApp('<p>שורה 1</p><p>שורה 2</p>'), 'שורה 1\n\nשורה 2');
  assert.equal(htmlToWhatsApp('<p>שורה 1<br>שורה 2</p>'), 'שורה 1\nשורה 2');
});

test('lists convert to dash / numbered lines', () => {
  assert.equal(htmlToWhatsApp('<ul><li>אחד</li><li>שניים</li></ul>'), '- אחד\n- שניים');
  assert.equal(htmlToWhatsApp('<ol><li>אחד</li><li>שניים</li></ol>'), '1. אחד\n2. שניים');
});

test('variable chips serialize to {{key}} tokens', () => {
  const html = '<p>שלום <span data-type="dynamic-field" data-field-key="customer_first_name">שם פרטי</span>!</p>';
  assert.equal(htmlToWhatsApp(html), 'שלום {{customer_first_name}}!');
});

test('links keep label + url; bare urls pass through', () => {
  assert.equal(htmlToWhatsApp('<p><a href="https://x.co/a">לתשלום</a></p>'), 'לתשלום: https://x.co/a');
  assert.equal(htmlToWhatsApp('<p><a href="https://x.co/a">https://x.co/a</a></p>'), 'https://x.co/a');
});

test('marks hug the text (whitespace stays outside the markers)', () => {
  assert.equal(htmlToWhatsApp('<p><strong> מודגש </strong>רגיל</p>'), '*מודגש* רגיל');
});

test('unknown tags degrade to their text content; entities decode', () => {
  assert.equal(htmlToWhatsApp('<p><span style="color:red">צבע</span> &amp; עוד</p>'), 'צבע & עוד');
});

test('plain text (no tags) passes through', () => {
  assert.equal(htmlToWhatsApp('שלום עולם'), 'שלום עולם');
});

test('preview strips markup', () => {
  assert.equal(whatsAppTextPreview('*שלום* _עולם_'), 'שלום עולם');
});

test('nested marks compose', () => {
  assert.equal(htmlToWhatsApp('<p><strong><em>חשוב</em></strong></p>'), '*_חשוב_*');
});
