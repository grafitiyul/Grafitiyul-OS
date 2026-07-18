// Pure-logic tests for the "מידע ממערכת קודמת" card helpers (no DOM needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isUrlValue,
  shortenUrl,
  isLongText,
  LONG_TEXT_THRESHOLD,
  normalizeCardData,
} from './legacyCardCore.js';

test('isUrlValue: only http(s) URLs count', () => {
  assert.equal(isUrlValue('https://drive.google.com/file/d/abc'), true);
  assert.equal(isUrlValue('http://example.com'), true);
  assert.equal(isUrlValue('  https://example.com/x  '), true); // tolerant of padding
  assert.equal(isUrlValue('example.com'), false);
  assert.equal(isUrlValue('ftp://example.com'), false);
  assert.equal(isUrlValue('http:// spaced.com'), false);
  assert.equal(isUrlValue('טקסט בעברית'), false);
  assert.equal(isUrlValue(null), false);
});

test('shortenUrl strips the protocol and ellipses long tails', () => {
  assert.equal(shortenUrl('https://example.com/a'), 'example.com/a');
  const long = `https://drive.google.com/${'x'.repeat(120)}`;
  const short = shortenUrl(long);
  assert.ok(short.length <= 60);
  assert.ok(short.endsWith('…'));
  assert.ok(short.startsWith('drive.google.com/'));
});

test('isLongText: over the threshold, but URLs never clamp', () => {
  assert.equal(isLongText('קצר'), false);
  assert.equal(isLongText('א'.repeat(LONG_TEXT_THRESHOLD)), false); // exactly at → no clamp
  assert.equal(isLongText('א'.repeat(LONG_TEXT_THRESHOLD + 1)), true);
  assert.equal(isLongText(`https://x.il/${'a'.repeat(300)}`), false);
});

test('normalizeCardData: the canonical [{label, value}] array passes through trimmed', () => {
  assert.deepEqual(
    normalizeCardData([
      { label: 'בעלים', value: ' דור ' },
      { label: 'שלב מקורי', value: 'הצעה נשלחה' },
    ]),
    [
      { label: 'בעלים', value: 'דור' },
      { label: 'שלב מקורי', value: 'הצעה נשלחה' },
    ],
  );
});

test('normalizeCardData drops unusable entries instead of crashing', () => {
  assert.deepEqual(
    normalizeCardData([
      { label: '', value: 'no label' },
      { label: 'ריק', value: '' },
      { label: 'null ערך', value: null },
      { label: 'אובייקט', value: { nested: true } },
      null,
      { label: 'תקין', value: '42' },
    ]),
    [{ label: 'תקין', value: '42' }],
  );
});

test('normalizeCardData tolerates a plain object map and junk inputs', () => {
  assert.deepEqual(normalizeCardData({ בעלים: 'דור' }), [{ label: 'בעלים', value: 'דור' }]);
  assert.deepEqual(normalizeCardData(null), []);
  assert.deepEqual(normalizeCardData('string'), []);
  assert.deepEqual(normalizeCardData(7), []);
});
