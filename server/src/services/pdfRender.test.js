// Regression tests for the note annotation layout engine + render smoke.
//
// Guards the fix for the "smeared note" defect: multi-line notes used to go
// through bidi + whole-string reversal (merging lines and reversing their
// order) and were then drawn by pdf-lib at a fixed 24pt line height,
// overlapping into a smear for fontSize > 24. Layout is now per-line.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { layoutNoteLines, renderFinalPdf, looksLikePdf } from './pdfRender.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadFont() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = fs.readFileSync(
    path.resolve(__dirname, '../../assets/fonts/NotoSansHebrew-Regular.ttf'),
  );
  return doc.embedFont(bytes);
}

async function blankPagePdf() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return Buffer.from(await doc.save());
}

function noteAnn(text, extra = {}) {
  return {
    id: 'a1',
    kind: 'note',
    page: 1,
    xPct: 50,
    yPct: 10,
    wPct: 40,
    hPct: 10,
    order: 0,
    text,
    fontSize: 14,
    color: '#111827',
    ...extra,
  };
}

test('one-line Hebrew note stays a single logical line', async () => {
  const font = await loadFont();
  const lines = layoutNoteLines('הערה חשובה מאוד', font, 14, 500);
  assert.deepEqual(lines, ['הערה חשובה מאוד']);
});

test('explicit newlines keep logical order (the smear regression)', async () => {
  const font = await loadFont();
  const lines = layoutNoteLines('שורה ראשונה\nשורה שנייה\nשורה שלישית', font, 14, 500);
  assert.deepEqual(lines, ['שורה ראשונה', 'שורה שנייה', 'שורה שלישית']);
});

test('mixed Hebrew/numbers line survives layout unchanged', async () => {
  const font = await loadFont();
  const text = 'פגישה ב-15:30 בתאריך 12/08/2026';
  assert.deepEqual(layoutNoteLines(text, font, 14, 500), [text]);
});

test('long note wraps into multiple lines that each fit the width', async () => {
  const font = await loadFont();
  const text =
    'זוהי הערה ארוכה מאוד שאמורה להתעטף על פני מספר שורות בתוך המלבן של ההערה ולא לגלוש החוצה';
  const maxW = 200;
  const lines = layoutNoteLines(text, font, 14, maxW);
  assert.ok(lines.length > 1, 'expected wrapping into multiple lines');
  for (const line of lines) {
    assert.ok(
      font.widthOfTextAtSize(line, 14) <= maxW,
      `line exceeds max width: "${line}"`,
    );
  }
  // No word lost or reordered by wrapping.
  assert.equal(lines.join(' '), text);
});

test('empty and whitespace-only notes produce no lines', async () => {
  const font = await loadFont();
  assert.deepEqual(layoutNoteLines('', font, 14, 200), []);
  assert.deepEqual(layoutNoteLines('   \n  ', font, 14, 200), []);
  assert.deepEqual(layoutNoteLines(null, font, 14, 200), []);
});

test('intentional blank middle line keeps its slot; trailing blanks trimmed', async () => {
  const font = await loadFont();
  assert.deepEqual(layoutNoteLines('א\n\nב', font, 14, 200), ['א', '', 'ב']);
  assert.deepEqual(layoutNoteLines('א\n\n\n', font, 14, 200), ['א']);
});

test('windows newlines are normalised', async () => {
  const font = await loadFont();
  assert.deepEqual(layoutNoteLines('א\r\nב', font, 14, 200), ['א', 'ב']);
});

test('render smoke: notes near the page boundary and large fonts do not throw', async () => {
  const src = await blankPagePdf();
  const out = await renderFinalPdf(src, [], [
    noteAnn('הערה קרובה לתחתית העמוד', { yPct: 97, hPct: 2.5 }),
    noteAnn('הערה גדולה\nעם שתי שורות', { yPct: 40, hPct: 14, fontSize: 36 }),
    noteAnn(''),
  ]);
  assert.ok(looksLikePdf(out));
});

test('render smoke: ellipse annotation draws as vector outline', async () => {
  const src = await blankPagePdf();
  const out = await renderFinalPdf(src, [], [
    { id: 'e1', kind: 'ellipse', page: 1, xPct: 10, yPct: 10, wPct: 20, hPct: 10, order: 0, color: '#b91c1c', thickness: 2.5 },
    { id: 'e2', kind: 'ellipse', page: 1, xPct: 40, yPct: 40, wPct: 12, hPct: 8.48, order: 1, color: '#1d4ed8', thickness: 1 },
  ]);
  assert.ok(looksLikePdf(out));
  assert.ok(out.length > src.length);
});
