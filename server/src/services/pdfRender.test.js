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
import { PDFDocument, PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { layoutNoteLines, renderFinalPdf, looksLikePdf } from './pdfRender.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_PATH = path.resolve(__dirname, '../../assets/fonts/Heebo-Regular.ttf');

// Run a render with PDFPage.drawText instrumented; returns every call's
// text payload + coordinates. This is the draw-count harness for the
// "double glyph / shadow" regression class: each value must be drawn
// EXACTLY once, with no second call at a nearby coordinate.
async function renderWithSpy(fields, annotations) {
  const calls = [];
  const orig = PDFPage.prototype.drawText;
  PDFPage.prototype.drawText = function (text, opts) {
    calls.push({ text, x: opts?.x, y: opts?.y, size: opts?.size });
    return orig.call(this, text, opts);
  };
  try {
    const src = await PDFDocument.create();
    src.addPage([595, 842]);
    const out = await renderFinalPdf(
      Buffer.from(await src.save()),
      fields,
      annotations,
    );
    return { calls, out };
  } finally {
    PDFPage.prototype.drawText = orig;
  }
}

function nearDuplicates(calls, tolerancePt = 8) {
  const dups = [];
  for (let i = 0; i < calls.length; i++)
    for (let j = i + 1; j < calls.length; j++)
      if (
        calls[i].text === calls[j].text &&
        Math.abs(calls[i].x - calls[j].x) < tolerancePt &&
        Math.abs(calls[i].y - calls[j].y) < tolerancePt
      )
        dups.push([calls[i], calls[j]]);
  return dups;
}

async function loadFont() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  return doc.embedFont(fs.readFileSync(FONT_PATH));
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

// ── Font asset guard ─────────────────────────────────────────────────────────
//
// Production incident 2026-07 (two rounds — see the asset-history comment in
// pdfRender.js): a VARIABLE font rendered Thin(100), then a synthetically-
// instanced wght=400 build kept overlapping contours that Acrobat rasterizes
// with white seams ("ghost / double-edge" glyphs). The asset must be a
// professionally-released STATIC Regular — currently Heebo-Regular.
test('embedded Hebrew font is a professionally-built static Regular (400)', () => {
  const font = fontkit.create(fs.readFileSync(FONT_PATH));
  assert.equal(font.postscriptName, 'Heebo-Regular');
  assert.equal(font['OS/2'].usWeightClass, 400);
  assert.ok(!font.fvar, 'font must be static (no variation axes)');
  for (const cp of [0x05d0, 0x05ea, 0x30, 0x39, 0x41, 0x7a, 0x2d, 0x22, 0x28, 0x3a, 0x20aa]) {
    assert.ok(font.hasGlyphForCodePoint(cp), `missing glyph U+${cp.toString(16)}`);
  }
});

// ── Draw-count regression (double-glyph / shadow class) ─────────────────────

const PROD_NOTE = 'אלינוי קיסלוב'; // shape of the 2026-07 production example

test('one-line Hebrew note is drawn EXACTLY once at its rect', async () => {
  const { calls } = await renderWithSpy(
    [],
    [{ id: 'n1', kind: 'note', page: 1, xPct: 56.5, yPct: 33.9, wPct: 24.1, hPct: 1.8, order: 0, text: PROD_NOTE, fontSize: 20, color: '#111827' }],
  );
  assert.equal(calls.length, 1, `expected 1 drawText, got ${JSON.stringify(calls)}`);
  const c = calls[0];
  // payload: the bidi/visual form must contain exactly the note's glyphs.
  assert.equal([...c.text].sort().join(''), [...PROD_NOTE].sort().join(''));
  assert.equal(c.size, 20);
  // coordinates: right-aligned inside the rect on an A4 page (595×842pt).
  // rect: x=56.5% → 336.2pt, w=24.1% → 143.4pt; top y=33.9% h=1.8%.
  const rectX = (56.5 / 100) * 595;
  const rectRight = rectX + (24.1 / 100) * 595;
  const rectTop = 842 - (33.9 / 100) * 842;
  assert.ok(c.x >= rectX && c.x < rectRight, `x=${c.x} outside rect`);
  assert.ok(c.y <= rectTop && c.y > rectTop - 40, `y=${c.y} not at rect top`);
  assert.equal(nearDuplicates(calls).length, 0);
});

test('multiline Hebrew note draws once per line, spaced by 1.25×fontSize', async () => {
  const { calls } = await renderWithSpy(
    [],
    [{ id: 'n1', kind: 'note', page: 1, xPct: 40, yPct: 20, wPct: 50, hPct: 12, order: 0, text: 'שורה ראשונה\nשורה שנייה', fontSize: 16, color: '#111827' }],
  );
  assert.equal(calls.length, 2);
  assert.ok(Math.abs(calls[0].y - calls[1].y - 16 * 1.25) < 0.01, `line gap=${calls[0].y - calls[1].y}`);
  assert.equal(nearDuplicates(calls).length, 0);
});

test('note overlapping a nearby field: each drawn exactly once', async () => {
  const { calls } = await renderWithSpy(
    [{ id: 'f1', fieldType: 'text', page: 1, xPct: 42, yPct: 21, wPct: 30, hPct: 2.6, textValue: 'ערך שדה', valueSource: 'override_only', language: 'he' }],
    [{ id: 'n1', kind: 'note', page: 1, xPct: 40, yPct: 20, wPct: 35, hPct: 4, order: 0, text: PROD_NOTE, fontSize: 18, color: '#111827' }],
  );
  assert.equal(calls.length, 2, JSON.stringify(calls));
  assert.equal(nearDuplicates(calls).length, 0);
});

test('correction re-render (v1 then v2 from the same frozen source) never accumulates draws', async () => {
  const note = { id: 'n1', kind: 'note', page: 1, xPct: 40, yPct: 20, wPct: 50, hPct: 5, order: 0, text: PROD_NOTE, fontSize: 20, color: '#111827' };
  const field = (v) => [{ id: 'f1', fieldType: 'text', page: 1, xPct: 40, yPct: 40, wPct: 30, hPct: 2.6, textValue: v, valueSource: 'override_only', language: 'he' }];
  const v1 = await renderWithSpy(field('ערך מקורי'), [note]);
  const v2 = await renderWithSpy(field('ערך מתוקן'), [note]);
  assert.equal(v1.calls.length, 2);
  assert.equal(v2.calls.length, 2, 'v2 must not contain extra draws');
  // the note draw is identical between versions; only the field text changed
  assert.deepEqual(v1.calls[1], v2.calls[1]);
  assert.equal(nearDuplicates(v2.calls).length, 0);
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
