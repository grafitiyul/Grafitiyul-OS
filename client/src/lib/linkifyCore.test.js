import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeLinks } from './linkifyCore.js';

const links = (s) => tokenizeLinks(s).filter((t) => t.type === 'link');

test('plain text without URLs stays a single text token', () => {
  const t = tokenizeLinks('שלום, מה שלומך? 😀');
  assert.deepEqual(t, [{ type: 'text', text: 'שלום, מה שלומך? 😀' }]);
});

test('https URL becomes a link with the same href', () => {
  const [l] = links('בדוק את https://example.com/page בבקשה');
  assert.equal(l.text, 'https://example.com/page');
  assert.equal(l.href, 'https://example.com/page');
});

test('www URL gets https:// prefixed to its href only', () => {
  const [l] = links('היכנסו ל www.grafitiyul.co.il עוד היום');
  assert.equal(l.text, 'www.grafitiyul.co.il');
  assert.equal(l.href, 'https://www.grafitiyul.co.il');
});

test('trailing punctuation is split off the URL', () => {
  const [l] = links('ראו: https://example.com/a.');
  assert.equal(l.text, 'https://example.com/a');
  assert.equal(l.rest, '.');
});

test('Hebrew text around the URL is preserved verbatim (RTL + newlines)', () => {
  const t = tokenizeLinks('שורה ראשונה\nhttps://example.com\nשורה שנייה');
  assert.deepEqual(
    t.map((x) => x.type),
    ['text', 'link', 'text'],
  );
  assert.equal(t[0].text, 'שורה ראשונה\n');
  assert.equal(t[2].text, '\nשורה שנייה');
});

test('balanced parens stay inside the URL, unbalanced close-paren is trimmed', () => {
  const [wiki] = links('https://en.wikipedia.org/wiki/Graffiti_(disambiguation)');
  assert.equal(wiki.text, 'https://en.wikipedia.org/wiki/Graffiti_(disambiguation)');
  const [wrapped] = links('(ראו https://example.com/a)');
  assert.equal(wrapped.text, 'https://example.com/a');
  assert.equal(wrapped.rest, ')');
});

test('multiple URLs in one message are each linked', () => {
  const l = links('https://a.example וגם www.b.example בסוף');
  assert.equal(l.length, 2);
  assert.equal(l[1].href, 'https://www.b.example');
});

test('never produces a non-http(s) href', () => {
  for (const s of ['javascript:alert(1)', 'data:text/html;x', 'ftp://x.com/a', 'שלום javascript:alert(1) עולם']) {
    for (const l of links(s)) assert.match(l.href, /^https?:\/\//);
  }
  assert.equal(links('javascript:alert(1)').length, 0);
});

test('bare "www." alone is not a link', () => {
  assert.equal(links('סתם www. באמצע משפט').length, 0);
});

test('empty and non-string input are safe', () => {
  assert.deepEqual(tokenizeLinks(''), [{ type: 'text', text: '' }]);
  assert.deepEqual(tokenizeLinks(null), [{ type: 'text', text: '' }]);
});
