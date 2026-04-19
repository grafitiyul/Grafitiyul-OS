// PDF render service for business documents. Takes a snapshot PDF, a
// resolved field list, and a free-form annotations list, then produces a
// finalized PDF with values baked in and annotations drawn on top.
//
// Text + signature rendering was PORTED from recruitment's publicSign.ts
// (lines 442–553). The bidi-js + fontkit double-reversal fix is LOAD-BEARING
// — do not touch without testing Hebrew output end-to-end.
//
// Coordinate system:
//   - input positions use percentages from the PAGE TOP-LEFT (0..100)
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

// Text sizing rule for value fields. Scales with field height; floor keeps
// small fields readable; cap keeps oversized fields from looking absurd.
// The same ratio is mirrored on the client preview so WYSIWYG holds.
//
// Tuning: default placement height is 2.6%, which targets ~12–13pt on both
// A4 (842pt × 0.026 × 0.60 ≈ 13.1pt) and Letter (792pt × 0.026 × 0.60 ≈
// 12.4pt). Resize still scales text proportionally via the same ratio.
const TEXT_SIZE_MIN = 10;
const TEXT_SIZE_MAX = 36;
const TEXT_SIZE_RATIO = 0.6;
function fontSizeForFieldHeight(fieldHPt) {
  return Math.max(TEXT_SIZE_MIN, Math.min(TEXT_SIZE_MAX, fieldHPt * TEXT_SIZE_RATIO));
}

/**
 * Render a final PDF.
 *
 * @param {Buffer} sourcePdfBytes
 * @param {Array} fields       - [{ fieldType, page, xPct, yPct, wPct, hPct, textValue?, imageBytes? }]
 * @param {Array} [annotations] - [{ kind, page, xPct, yPct, wPct, hPct, ...kindSpecific }]
 * @returns {Promise<Buffer>}
 */
export async function renderFinalPdf(sourcePdfBytes, fields, annotations = []) {
  const pdfDoc = await PDFDocument.load(sourcePdfBytes);
  pdfDoc.registerFontkit(fontkit);
  const notoFontBytes = fs.readFileSync(NOTO_HEBREW_TTF);
  const hebrewFont = await pdfDoc.embedFont(notoFontBytes);
  const pages = pdfDoc.getPages();

  // ── Pass 1: highlights (under values, so text reads over the colour) ─────
  for (const ann of annotations) {
    if (ann?.kind !== 'highlight') continue;
    const page = pages[ann.page - 1];
    if (!page) continue;
    drawRectAnnotation(page, ann);
  }

  // ── Pass 2: value fields (text) ──────────────────────────────────────────
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
    const fieldBottom = ph - (field.yPct / 100) * ph - fieldH;
    const fontSize = fontSizeForFieldHeight(fieldH);

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

  // ── Pass 3: value fields (images — signature / stamp / combined) ─────────
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

  // ── Pass 4: non-highlight annotations on top of values ───────────────────
  for (const ann of annotations) {
    if (!ann || ann.kind === 'highlight') continue;
    const page = pages[ann.page - 1];
    if (!page) continue;
    try {
      if (ann.kind === 'check') drawCheckAnnotation(page, ann);
      else if (ann.kind === 'x') drawXAnnotation(page, ann);
      else if (ann.kind === 'line') drawLineAnnotation(page, ann);
      else if (ann.kind === 'note') drawNoteAnnotation(page, ann, hebrewFont);
    } catch {
      // Swallow per-annotation errors so a bad one cannot kill the render.
    }
  }

  const out = await pdfDoc.save();
  return Buffer.from(out);
}

// ─── Annotation drawing helpers ──────────────────────────────────────────────

function annRect(page, ann) {
  const { width: pw, height: ph } = page.getSize();
  const x = (ann.xPct / 100) * pw;
  const w = (ann.wPct / 100) * pw;
  const h = (ann.hPct / 100) * ph;
  const y = ph - (ann.yPct / 100) * ph - h;
  return { x, y, w, h, pw, ph };
}

// Parse #RRGGBB into { r, g, b } in [0..1]. Falls back to black.
function parseColor(hex) {
  if (typeof hex !== 'string') return rgb(0, 0, 0);
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return rgb(0, 0, 0);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

function drawRectAnnotation(page, ann) {
  const { x, y, w, h } = annRect(page, ann);
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: parseColor(ann.color || '#fde047'),
    opacity: typeof ann.opacity === 'number' ? ann.opacity : 0.35,
    borderWidth: 0,
  });
}

function drawLineAnnotation(page, ann) {
  const { x, y, w, h } = annRect(page, ann);
  const color = parseColor(ann.color || '#111827');
  const thickness = Number(ann.thickness) || 2;
  if (ann.orientation === 'vertical') {
    // Vertical line centered horizontally in the rect.
    const cx = x + w / 2;
    page.drawLine({
      start: { x: cx, y },
      end: { x: cx, y: y + h },
      thickness,
      color,
    });
  } else {
    // Horizontal line centered vertically in the rect.
    const cy = y + h / 2;
    page.drawLine({
      start: { x, y: cy },
      end: { x: x + w, y: cy },
      thickness,
      color,
    });
  }
}

function drawCheckAnnotation(page, ann) {
  const { x, y, w, h } = annRect(page, ann);
  const color = parseColor(ann.color || '#111827');
  const thickness = Number(ann.thickness) || 3;
  // Two-segment check: short stroke from left-mid down to lower-third,
  // then long stroke up to top-right. Coords in bottom-left PDF space.
  const pad = Math.min(w, h) * 0.1;
  const leftX = x + pad;
  const midX = x + w * 0.38;
  const rightX = x + w - pad;
  const topY = y + h - pad;
  const midY = y + h * 0.55;
  const lowY = y + pad;
  page.drawLine({
    start: { x: leftX, y: midY },
    end: { x: midX, y: lowY },
    thickness,
    color,
  });
  page.drawLine({
    start: { x: midX, y: lowY },
    end: { x: rightX, y: topY },
    thickness,
    color,
  });
}

function drawXAnnotation(page, ann) {
  const { x, y, w, h } = annRect(page, ann);
  const color = parseColor(ann.color || '#b91c1c');
  const thickness = Number(ann.thickness) || 3;
  const pad = Math.min(w, h) * 0.1;
  page.drawLine({
    start: { x: x + pad, y: y + pad },
    end: { x: x + w - pad, y: y + h - pad },
    thickness,
    color,
  });
  page.drawLine({
    start: { x: x + pad, y: y + h - pad },
    end: { x: x + w - pad, y: y + pad },
    thickness,
    color,
  });
}

function drawNoteAnnotation(page, ann, hebrewFont) {
  const { x, y, w, h } = annRect(page, ann);
  const raw = (ann.text ?? '').toString();
  if (!raw.trim()) return;
  const color = parseColor(ann.color || '#111827');
  const isHebrew = HEB_RE.test(raw);
  const fontSize = Number.isFinite(ann.fontSize)
    ? Math.max(8, Math.min(48, ann.fontSize))
    : fontSizeForFieldHeight(h);
  const visualText = isHebrew ? toFontkitInput(raw) : raw;
  // Start at top of rect, account for font baseline.
  const textY = y + h - fontSize - 1;
  const textWidth = hebrewFont.widthOfTextAtSize(visualText, fontSize);
  // Right-align for Hebrew, left-align for Latin.
  const textX = isHebrew
    ? x + w - 2 - Math.min(textWidth, Math.max(0, w - 4))
    : x + 2;
  page.drawText(visualText, {
    x: textX,
    y: Math.max(y + 1, textY),
    size: fontSize,
    font: hebrewFont,
    color,
  });
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
