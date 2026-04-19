// PDF render service for business documents. Takes a snapshot PDF + a
// resolved field list and produces a finalized PDF with all values baked in.
//
// PORTED from recruitment's publicSign.ts:442–553 (with minor adaptations).
// The bidi-js + fontkit double-reversal fix is LOAD-BEARING — do not touch
// without testing Hebrew output end-to-end.
//
// Coordinate system:
//   - input fields use percentages from the PAGE TOP-LEFT (0..100)
//   - pdf-lib uses PDF points from the PAGE BOTTOM-LEFT
//   - conversion is local to this file

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import bidiFactory from 'bidi-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTO_HEBREW_TTF = path.resolve(
  __dirname,
  '../../assets/fonts/NotoSansHebrew-Regular.ttf',
);
const HEB_RE = /[\u0590-\u05FF]/;

const bidi = bidiFactory();

// Produce the string that fontkit needs to render Hebrew correctly.
//
// @pdf-lib/fontkit's OpenType layout engine detects Hebrew as RTL and
// REVERSES the glyphs AFTER shaping. If we pass visual-order text directly,
// we get double-reversal (mirror image). Fix: run full UBA via bidi-js,
// then reverse the result before passing to pdf-lib. fontkit reverses it
// back into correct visual order.
//
// For pure Hebrew: reverse(bidi(x)) == x. For mixed text with LTR numbers:
// digit runs preserve their order within the RTL paragraph ("הרצל 15"
// renders "15", not "51"). Bracket mirroring handled by bidi-js.
function toFontkitInput(text) {
  const levels = bidi.getEmbeddingLevels(text, 'rtl');
  const visual = bidi.getReorderedString(text, levels);
  return [...visual].reverse().join('');
}

// Fields expected to be numeric-only (never Hebrew) — skip bidi for these.
const NUMERIC_FIELD_TYPES = new Set(['date', 'phone', 'number', 'email']);

/**
 * Render a final PDF.
 *
 * @param {Buffer} sourcePdfBytes - the snapshot PDF bytes
 * @param {Array} fields          - each: { fieldType, page, xPct, yPct, wPct, hPct,
 *                                          textValue?, imageBytes? (Buffer) }
 * @returns {Promise<Buffer>}     - the rendered PDF bytes
 */
export async function renderFinalPdf(sourcePdfBytes, fields) {
  const pdfDoc = await PDFDocument.load(sourcePdfBytes);
  pdfDoc.registerFontkit(fontkit);
  const notoFontBytes = fs.readFileSync(NOTO_HEBREW_TTF);
  const hebrewFont = await pdfDoc.embedFont(notoFontBytes);
  const pages = pdfDoc.getPages();

  // Text pass.
  for (const field of fields) {
    if (isImageField(field.fieldType)) continue;
    const raw = (field.textValue ?? '').toString().trim();
    if (!raw) continue;

    const page = pages[field.page - 1];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();

    const isNumeric = NUMERIC_FIELD_TYPES.has(field.fieldType);
    const isHebrew = HEB_RE.test(raw);

    let displayText = raw;
    if (field.fieldType === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      try {
        displayText = new Intl.DateTimeFormat('he-IL', {
          day: '2-digit',
          month: 'numeric',
          year: 'numeric',
        }).format(new Date(raw + 'T12:00:00'));
      } catch {
        const [fy, fm, fd] = raw.split('-');
        displayText = `${fd}/${fm}/${fy}`;
      }
    }

    const visualText =
      !isNumeric && isHebrew ? toFontkitInput(displayText) : displayText;

    const fieldX = (field.xPct / 100) * pw;
    const fieldW = (field.wPct / 100) * pw;
    const fieldH = (field.hPct / 100) * ph;
    // pdf-lib uses bottom-left origin; our input is top-left percentages.
    const fieldBottom = ph - (field.yPct / 100) * ph - fieldH;
    const fontSize = Math.min(fieldH * 0.65, 14);

    // Right-align within field box.
    const textWidth = hebrewFont.widthOfTextAtSize(visualText, fontSize);
    const usedW = Math.min(textWidth, Math.max(0, fieldW - 4));
    const textX = fieldX + fieldW - 2 - usedW;
    const textY = fieldBottom + (fieldH - fontSize) / 2;

    try {
      page.drawText(visualText, {
        x: Math.max(fieldX + 2, textX),
        y: textY,
        size: fontSize,
        font: hebrewFont,
        color: rgb(0, 0, 0),
      });
    } catch {
      // Skip fields whose chars cannot be encoded by the embedded font.
    }
  }

  // Image pass (signature / stamp / combined).
  for (const field of fields) {
    if (!isImageField(field.fieldType)) continue;
    if (!field.imageBytes || field.imageBytes.length === 0) continue;

    const page = pages[field.page - 1];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const x = (field.xPct / 100) * pw;
    const w = (field.wPct / 100) * pw;
    const h = (field.hPct / 100) * ph;
    const y = ph - (field.yPct / 100) * ph - h;

    try {
      const img = await pdfDoc.embedPng(field.imageBytes);
      page.drawImage(img, { x, y, width: w, height: h });
    } catch {
      // Malformed image — skip the field rather than aborting the whole render.
    }
  }

  const out = await pdfDoc.save();
  return Buffer.from(out);
}

// Validate that a buffer looks like a PDF (magic bytes "%PDF-").
export function looksLikePdf(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 5) return false;
  return (
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d
  );
}

// Count pages in a PDF buffer.
export async function countPdfPages(buf) {
  const doc = await PDFDocument.load(buf);
  return doc.getPageCount();
}

function isImageField(fieldType) {
  return (
    fieldType === 'signature' ||
    fieldType === 'stamp' ||
    fieldType === 'combined'
  );
}
