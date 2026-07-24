// Travel Agency Reservations — THE canonical reservation-summary PDF
// ("סיכום הזמנת פעילות לסוכני תיירות").
//
// Input contract: a FROZEN content snapshot (built once by
// reservations/document.js when the session finishes processing) — booker
// identity, group labels, pricing models and Deal order numbers are all
// values-as-submitted/values-as-created, never live catalog reads. The
// function is pure: the same snapshot always renders the identical document.
//
// Generated THROUGH the canonical Documents engine — every glyph is drawn by
// services/pdfRender.js `renderFinalPdf` (Heebo font, the load-bearing
// per-line bidi rule, note wrapping). This module only (a) creates blank A4
// base pages with the same pdf-lib the renderer uses, and (b) computes a
// MEASURED flow layout: every text block is wrapped with the SAME font +
// width the renderer will draw with (layoutNoteLines), so vertical positions
// are exact — long notes, long names and long addresses push content down
// and onto the next page instead of overlapping. NO second PDF engine.
//
// Layout contract (QA 2026-07-18, extended for the summary document):
//   - notes render in FULL (paragraph breaks + blank lines preserved, long
//     words/emails character-wrapped) — never truncated, never overflowing
//     the margins;
//   - a group block is kept on one page when it fits, split at line level
//     when it is taller than a page;
//   - pricing rows are two independent runs — label on the leading edge,
//     amount on the trailing edge as a PURE-LTR string — so the semantic
//     order "qty × unit = total" can never be bidi-reordered;
//   - checkboxes are VECTOR marks (outlined square + drawn check), never
//     font glyphs or form widgets — identical in every viewer and in print;
//   - the signature/disclaimer footer is pinned to the bottom of the final
//     page — if content reaches into the footer zone, the footer moves to
//     its own page;
//   - EN copies are left-aligned, HE copies right-aligned (mirrored layout).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import {
  renderFinalPdf,
  layoutNoteLines,
  createMeasurementFont,
  supportedTextFilter,
  NOTE_LINE_HEIGHT_RATIO,
} from '../services/pdfRender.js';
import { formatMinor, formatQuantityRow } from '../lib/money.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Brand logo for the document header — server-owned copy of the canonical
// asset (232×202 PNG). Loaded once; absence degrades to a text-only header.
const LOGO_PNG = path.resolve(__dirname, '../../assets/brand/logo.png');
let logoCache;
function logoBytes() {
  if (logoCache === undefined) {
    try {
      logoCache = fs.readFileSync(LOGO_PNG);
    } catch {
      logoCache = null;
    }
  }
  return logoCache;
}

const A4 = { w: 595.28, h: 841.89 };
const MARGIN_X_PCT = 8;
const CONTENT_W_PCT = 100 - 2 * MARGIN_X_PCT; // 84
const CONTENT_W_PT = (CONTENT_W_PCT / 100) * A4.w;
// The renderer wraps note text at (rect width − 4pt) — mirror it exactly.
const WRAP_W_PT = Math.max(8, CONTENT_W_PT - 4);
const TOP_FIRST_PT = (5 / 100) * A4.h;
const TOP_REST_PT = (8 / 100) * A4.h;
const BOTTOM_PT = (92 / 100) * A4.h; // content floor on regular pages
const FOOTER_TOP_PT = (74 / 100) * A4.h; // content floor on the footer page

// Logo box (header, leading edge). Height fixed; width follows the PNG's
// true aspect ratio at build time.
const LOGO_H_PCT = 4.6;

// Vector checkbox metrics (pt → pct of page dimensions).
const CHECK_W_PCT = 1.7;
const CHECK_GUTTER_PCT = 2.8;

// Amount column: gap between the label run and the trailing amount run.
const ROW_GAP_PCT = 2;

const L = {
  he: {
    title: 'סיכום הזמנת פעילות לסוכני תיירות',
    brand: 'גרפיטיול',
    request: (no) => `בקשה מספר ${no}`,
    submitted: (d) => `הוגשה בתאריך ${d}`,
    totals: (g, p) => `${g} קבוצות · ${p} משתתפים סה״כ`,
    bookerTitle: 'פרטי המזמין',
    bookerName: (v) => `שם: ${v}`,
    bookerPhone: (v) => `טלפון: ${v}`,
    bookerEmail: (v) => `אימייל: ${v}`,
    bookerCompany: (v) => `חברת נסיעות: ${v}`,
    group: (i) => `קבוצה ${i}`,
    order: (no) => `מספר הזמנה: GOS-${no}`,
    orderPending: 'מספר הזמנה: יימסר באישור',
    city: (v) => `עיר: ${v}`,
    activity: (v) => `פעילות: ${v}`,
    when: (d, t) => `תאריך: ${d}${t ? ` · שעה: ${t}` : ''}`,
    participants: (n) => `משתתפים: ${n}`,
    guides: (n) => `מספר מדריכים: ${n}`,
    tourLanguage: (l2) => `שפת הסיור: ${l2}`,
    onSite: (n, p) => `נציג בשטח: ${n}${p ? ` · ${p}` : ''}`,
    notes: (t) => `הערות / דגשים: ${t}`,
    pricingTitle: 'מחיר לסוכנים',
    row: {
      fixed_price: () => 'מחיר קבוע',
      per_participant: () => 'מחיר למשתתף',
      tier_up_to: (n) => `עד ${n} משתתפים`,
      extra_participant: () => 'כל משתתף נוסף',
      saturday_surcharge: () => 'תוספת שבת/חג',
      holiday_surcharge: () => 'תוספת שבת/חג',
    },
    subtotal: 'צפי להזמנה זו',
    vat: (rate) => (rate != null ? `מע״מ (${rate}%)` : 'מע״מ'),
    vatExempt: 'פטור ממע״מ',
    total: 'סה״כ לתשלום',
    priceFallback:
      'החישוב האוטומטי של המחיר לא זמין למוצר זה, המחיר יהיה כפי שכתוב במחירון לסוכנים.',
    priceDegraded: 'המחיר יהיה כפי שכתוב במחירון לסוכנים.',
    invoiceTitle: 'משלוח חשבונית',
    invOrganizer: (name) => `למזמין ההזמנה${name ? ` — ${name}` : ''}`,
    invFinance: (parts) => `לאיש הכספים${parts ? ` — ${parts}` : ''}`,
    confirmed:
      'אושרו תנאי הביטול לסוכני תיירות: עד 24 שעות לפני הפעילות — ללא דמי ביטול; בפחות מ־24 שעות — דמי ביטול של 100%.',
    signedBy: (name, d) => `נחתם על ידי ${name} · ${d}`,
    signedOn: (d) => `נחתם בתאריך ${d}`,
    continued: (no) => `גרפיטיול · בקשה מספר ${no} — המשך`,
    pageOf: (i, n) => `עמוד ${i} מתוך ${n}`,
    generated: (no, d) => `בקשה מספר ${no} · המסמך הופק בתאריך ${d}`,
    disclaimer:
      'מסמך זה מסכם את בקשת ההזמנה כפי שהוגשה. ההזמנה תיכנס לתוקף רק לאחר אישור סופי של גרפיטיול לכל קבוצה.',
    langNames: { he: 'עברית', en: 'אנגלית', es: 'ספרדית', fr: 'צרפתית', ru: 'רוסית' },
  },
  en: {
    title: 'Travel Agent Activity Reservation Summary',
    brand: 'Grafitiyul',
    request: (no) => `Request #${no}`,
    submitted: (d) => `Submitted on ${d}`,
    totals: (g, p) => `${g} groups · ${p} participants in total`,
    bookerTitle: 'Booker details',
    bookerName: (v) => `Name: ${v}`,
    bookerPhone: (v) => `Phone: ${v}`,
    bookerEmail: (v) => `Email: ${v}`,
    bookerCompany: (v) => `Travel company: ${v}`,
    group: (i) => `Group ${i}`,
    order: (no) => `Order number: GOS-${no}`,
    orderPending: 'Order number: assigned upon confirmation',
    city: (v) => `City: ${v}`,
    activity: (v) => `Activity: ${v}`,
    when: (d, t) => `Date: ${d}${t ? ` · Time: ${t}` : ''}`,
    participants: (n) => `Participants: ${n}`,
    guides: (n) => `Number of guides: ${n}`,
    tourLanguage: (l2) => `Tour language: ${l2}`,
    onSite: (n, p) => `On-site contact: ${n}${p ? ` · ${p}` : ''}`,
    notes: (t) => `Notes / Highlights: ${t}`,
    pricingTitle: 'Agent price',
    row: {
      fixed_price: () => 'Fixed price',
      per_participant: () => 'Price per participant',
      tier_up_to: (n) => `Up to ${n} participants`,
      extra_participant: () => 'Each additional participant',
      saturday_surcharge: () => 'Saturday / Holiday surcharge',
      holiday_surcharge: () => 'Saturday / Holiday surcharge',
    },
    subtotal: 'Expected for this reservation',
    vat: (rate) => (rate != null ? `VAT (${rate}%)` : 'VAT'),
    vatExempt: 'VAT exempt',
    total: 'Total to pay',
    priceFallback:
      'Automatic price calculation is not available for this product. The price will be according to the agent price list.',
    priceDegraded: 'The price will be according to the agent price list.',
    invoiceTitle: 'Invoice delivery',
    invOrganizer: (name) => `To the booker${name ? ` — ${name}` : ''}`,
    invFinance: (parts) => `To the finance contact${parts ? ` — ${parts}` : ''}`,
    confirmed:
      'Travel-agent cancellation terms accepted: up to 24 hours before the activity — no cancellation fee; less than 24 hours — a 100% cancellation fee.',
    signedBy: (name, d) => `Signed by ${name} · ${d}`,
    signedOn: (d) => `Signed on ${d}`,
    continued: (no) => `Grafitiyul · Request #${no} — continued`,
    pageOf: (i, n) => `Page ${i} of ${n}`,
    generated: (no, d) => `Request #${no} · document generated on ${d}`,
    disclaimer:
      'This document summarizes the reservation request as submitted. The reservation becomes final only after confirmation by Grafitiyul for each group.',
    langNames: { he: 'Hebrew', en: 'English', es: 'Spanish', fr: 'French', ru: 'Russian' },
  },
};

const fmtDate = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(ymd || '');
};

const fmtIsoDate = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? fmtDate(d.toISOString().slice(0, 10)) : '';
};

const fmtInt = (n) => String(Math.trunc(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// PNG pixel dimensions from the IHDR chunk (always at a fixed offset in a
// valid PNG — intake verified the magic). Used to place drawn images with
// their TRUE aspect ratio instead of stretching them into a fixed box.
export function pngDimensions(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return w > 0 && h > 0 ? { w, h } : null;
}

// ── pricing model → flow items ───────────────────────────────────────────────
// Renders the FROZEN agent-pricing display model (pricing/pricingDisplay.js
// semantics) exactly as the form showed it: applied rows ("qty × unit =
// total" for quantity > 1), Saturday/holiday surcharges, then the structured
// VAT totals. Unavailable/structural models degrade to the same price-list
// fallback sentence the form uses.
function pricingRowLabel(row, t, lang) {
  const fn = t.row[row.type];
  if (fn) return fn(row.threshold != null ? fmtInt(row.threshold) : '');
  // Business-labeled rows (generic surcharge / ticket): the frozen snapshot
  // carries the catalog label in both languages — the EN document uses the EN
  // label (legacy rows without labelEn keep the Hebrew one).
  return (lang === 'en' ? row.labelEn || row.labelHe : row.labelHe) || '';
}

function pricingRowAmount(row) {
  const qty = Number(row.quantity) || 0;
  if (qty > 1) return formatQuantityRow(qty, row.unitAmountMinor, row.totalMinor);
  return formatMinor(row.totalMinor != null ? row.totalMinor : row.unitAmountMinor);
}

function pricingItems(model, t, clean, lang) {
  const items = [{ text: clean(t.pricingTitle), fontSize: 11.5, color: '#065f46', spaceAfter: 3 }];
  if (!model || model.available !== true || model.degraded) {
    items.push({ text: clean(t.priceFallback), fontSize: 10, color: '#6b7280', spaceAfter: 0 });
    return items;
  }
  for (const row of model.rows || []) {
    items.push({
      rowLabel: clean(pricingRowLabel(row, t, lang)),
      rowAmount: pricingRowAmount(row),
      fontSize: 10.5,
      color: row.type?.endsWith?.('surcharge') ? '#92400e' : '#374151',
      spaceAfter: 2,
    });
  }
  const totals = model.mode === 'exact' ? model.totals : null;
  if (totals) {
    items.push({ gap: 3 });
    items.push({
      rowLabel: clean(t.subtotal),
      rowAmount: formatMinor(totals.netMinor),
      fontSize: 11.5,
      color: '#065f46',
      spaceAfter: 2,
    });
    if (totals.vatMode === 'exempt') {
      items.push({
        rowLabel: clean(t.vatExempt),
        rowAmount: formatMinor(0),
        fontSize: 10,
        color: '#6b7280',
        spaceAfter: 2,
      });
    } else {
      items.push({
        rowLabel: clean(t.vat(totals.vatRate ?? null)),
        rowAmount: formatMinor(totals.vatMinor),
        fontSize: 10,
        color: '#6b7280',
        spaceAfter: 2,
      });
    }
    items.push({
      rowLabel: clean(t.total),
      rowAmount: formatMinor(totals.grossMinor),
      fontSize: 11,
      color: '#111827',
      spaceAfter: 0,
    });
  } else {
    items.push({ gap: 2 });
    items.push({ text: clean(t.priceDegraded), fontSize: 10, color: '#6b7280', spaceAfter: 0 });
  }
  return items;
}

// ── flow layout engine ───────────────────────────────────────────────────────
// Items:
//   { text, fontSize, color?, spaceAfter?, check? }        — wrapped text
//       check: true → green check gutter (accepted confirmation)
//       check: 'checked' | 'unchecked' → vector checkbox frame (+ check)
//   { rowLabel, rowAmount, fontSize, color?, spaceAfter? } — two-run pricing
//       row: label on the leading edge, PURE-LTR amount on the trailing edge
//   { divider: true, spaceAfter? } | { gap: pt }
//   { cardStart: { color, fill?, padX? } } … { cardEnd: true } — FORM-SNAPSHOT
//       cards: everything between the markers is wrapped in a bordered
//       (optionally filled) card box, mirroring the reservation form's card
//       language. A card that splits across pages draws one box per page
//       segment. Cards nest one level (a group card containing the emerald
//       pricing box). Inner padding comes from the block's own {gap} items;
//       horizontal padding extends OUTSIDE the content margin (padX, pct).
// Blocks: { items } — kept on one page when the whole block fits on a fresh
// page; split at LINE level otherwise. All heights are measured with the
// renderer's own wrap function + font.

function flowBlocks(blocks, font, { align }) {
  const annotations = [];
  const cardBoxes = []; // drawn BEFORE text annotations ⇒ always behind content
  const openCards = [];
  let page = 1;
  let cursor = TOP_FIRST_PT;

  const lineH = (fs) => fs * NOTE_LINE_HEIGHT_RATIO;
  const pushCardSegment = (c, endPt) => {
    if (endPt - c.segStart < 4) return; // skip empty/hairline segments
    const padX = c.opts.padX ?? 1.6;
    cardBoxes.push({
      kind: 'box',
      page: c.segPage,
      xPct: MARGIN_X_PCT - padX,
      yPct: (c.segStart / A4.h) * 100,
      wPct: CONTENT_W_PCT + 2 * padX,
      hPct: ((endPt - c.segStart) / A4.h) * 100,
      color: c.opts.color || '#bfdbfe',
      thickness: c.opts.thickness ?? 1.1,
      ...(c.opts.fill ? { fillColor: c.opts.fill } : {}),
    });
  };
  const newPage = () => {
    // Close every open card's segment on the page we are leaving; reopen on
    // the fresh page so a split card keeps its border on both sides.
    for (const c of openCards) pushCardSegment(c, cursor);
    page += 1;
    cursor = TOP_REST_PT;
    for (const c of openCards) {
      c.segPage = page;
      c.segStart = cursor;
    }
  };

  const measureItem = (item) => {
    if (item.cardStart) return { kind: 'cardStart', opts: item.cardStart, h: 0, spaceAfter: 0 };
    if (item.cardEnd) return { kind: 'cardEnd', h: 0, spaceAfter: item.spaceAfter ?? 0 };
    if (item.gap) return { kind: 'gap', h: item.gap };
    if (item.divider) return { kind: 'divider', h: 2, spaceAfter: item.spaceAfter ?? 10 };
    if (item.rowLabel !== undefined) {
      const amountWPt = font.widthOfTextAtSize(item.rowAmount, item.fontSize) + 4;
      const amountWPct = Math.min(50, (amountWPt / A4.w) * 100);
      const labelWrapPt = Math.max(40, WRAP_W_PT - ((amountWPct + ROW_GAP_PCT) / 100) * A4.w);
      const lines = layoutNoteLines(item.rowLabel, font, item.fontSize, labelWrapPt, {
        breakLongWords: true,
      });
      return {
        kind: 'row',
        item,
        lines: lines.length ? lines : [''],
        amountWPct,
        h: Math.max(lines.length, 1) * lineH(item.fontSize),
        spaceAfter: item.spaceAfter ?? 0,
      };
    }
    const gutter = item.check ? CHECK_GUTTER_PCT : 0;
    const wrapW = gutter ? WRAP_W_PT - (gutter / 100) * A4.w : WRAP_W_PT;
    const lines = layoutNoteLines(item.text, font, item.fontSize, wrapW, {
      breakLongWords: true,
    });
    return {
      kind: 'text',
      item,
      lines,
      h: lines.length * lineH(item.fontSize),
      spaceAfter: item.spaceAfter ?? 0,
    };
  };

  // Vector check/checkbox marks in the leading-edge gutter of the item's
  // first line. `mode` true → bare green check (accepted confirmation);
  // 'checked' → outlined box, light fill, dark check; 'unchecked' → outlined
  // empty box.
  const emitCheckMark = (mode, yPct) => {
    const boxX = align === 'left' ? MARGIN_X_PCT : 100 - MARGIN_X_PCT - CHECK_W_PCT;
    if (mode === 'checked' || mode === 'unchecked') {
      annotations.push({
        kind: 'box',
        page,
        xPct: boxX,
        yPct,
        wPct: CHECK_W_PCT,
        hPct: 1.15,
        thickness: 1.1,
        color: '#374151',
        ...(mode === 'checked' ? { fillColor: '#d1fae5' } : {}),
      });
    }
    if (mode === true || mode === 'checked') {
      annotations.push({
        kind: 'check',
        page,
        xPct: boxX + (mode === 'checked' ? 0.2 : 0),
        yPct: yPct + 0.1,
        wPct: CHECK_W_PCT - (mode === 'checked' ? 0.4 : 0),
        hPct: mode === 'checked' ? 0.95 : 1.15,
        thickness: 1.8,
        color: mode === 'checked' ? '#065f46' : '#059669',
      });
    }
  };

  const emitText = (m) => {
    let lines = m.lines;
    const fs = m.item.fontSize;
    const lh = lineH(fs);
    let checkPending = !!m.item.check;
    while (lines.length) {
      const maxLines = Math.floor((BOTTOM_PT - cursor) / lh);
      if (maxLines < 1) {
        newPage();
        continue;
      }
      const chunk = lines.slice(0, maxLines);
      lines = lines.slice(maxLines);
      const chunkH = chunk.length * lh;
      // Check/checkbox lines reserve a leading-edge gutter for the mark.
      const xPct = m.item.check
        ? align === 'left'
          ? MARGIN_X_PCT + CHECK_GUTTER_PCT
          : MARGIN_X_PCT
        : MARGIN_X_PCT;
      const wPct = m.item.check ? CONTENT_W_PCT - CHECK_GUTTER_PCT : CONTENT_W_PCT;
      annotations.push({
        kind: 'note',
        page,
        xPct,
        yPct: (cursor / A4.h) * 100,
        wPct,
        hPct: (chunkH / A4.h) * 100,
        fontSize: fs,
        ...(m.item.color ? { color: m.item.color } : {}),
        text: chunk.join('\n'),
        align,
        breakLongWords: true,
      });
      if (checkPending) {
        checkPending = false;
        emitCheckMark(m.item.check, (cursor / A4.h) * 100 + 0.1);
      }
      cursor += chunkH;
      if (lines.length) newPage();
    }
    cursor = Math.min(cursor + m.spaceAfter, BOTTOM_PT);
  };

  // A pricing row never splits across pages (it is at most a few lines) —
  // when it does not fit, it moves to the next page whole.
  const emitRow = (m) => {
    if (cursor + m.h > BOTTOM_PT) newPage();
    const fs = m.item.fontSize;
    const yPct = (cursor / A4.h) * 100;
    const labelWPct = CONTENT_W_PCT - m.amountWPct - ROW_GAP_PCT;
    // Label on the leading edge (right in HE, left in EN)…
    annotations.push({
      kind: 'note',
      page,
      xPct: align === 'left' ? MARGIN_X_PCT : MARGIN_X_PCT + m.amountWPct + ROW_GAP_PCT,
      yPct,
      wPct: labelWPct,
      hPct: (m.h / A4.h) * 100,
      fontSize: fs,
      ...(m.item.color ? { color: m.item.color } : {}),
      text: m.lines.join('\n'),
      align,
      breakLongWords: true,
    });
    // …amount on the trailing edge, as its own pure-LTR run. It contains no
    // Hebrew, so the renderer draws it verbatim — "qty × unit = total" order
    // is locked by construction.
    annotations.push({
      kind: 'note',
      page,
      xPct: align === 'left' ? 100 - MARGIN_X_PCT - m.amountWPct : MARGIN_X_PCT,
      yPct,
      wPct: m.amountWPct,
      hPct: (lineH(fs) / A4.h) * 100,
      fontSize: fs,
      ...(m.item.color ? { color: m.item.color } : {}),
      text: m.item.rowAmount,
      // Amount hugs the trailing edge: right-aligned in EN (trailing = right),
      // left-aligned in HE (trailing = left).
      align: align === 'left' ? undefined : 'left',
    });
    cursor += m.h;
    cursor = Math.min(cursor + m.spaceAfter, BOTTOM_PT);
  };

  const freshCapacity = BOTTOM_PT - TOP_REST_PT;
  for (const block of blocks) {
    const measured = block.items
      .map(measureItem)
      .filter((m) => m.kind !== 'text' || m.lines.length);
    if (!measured.length) continue;
    const blockH = measured.reduce((a, m) => a + m.h + (m.spaceAfter || 0), 0);
    if (blockH > BOTTOM_PT - cursor && blockH <= freshCapacity) newPage();
    for (const m of measured) {
      if (m.kind === 'cardStart') {
        openCards.push({ opts: m.opts, segPage: page, segStart: cursor });
      } else if (m.kind === 'cardEnd') {
        const c = openCards.pop();
        if (c) pushCardSegment(c, cursor);
        cursor = Math.min(cursor + (m.spaceAfter || 0), BOTTOM_PT);
      } else if (m.kind === 'gap') {
        cursor = Math.min(cursor + m.h, BOTTOM_PT);
      } else if (m.kind === 'divider') {
        if (cursor + 16 > BOTTOM_PT) newPage();
        annotations.push({
          kind: 'line',
          page,
          xPct: MARGIN_X_PCT,
          yPct: (cursor / A4.h) * 100,
          wPct: CONTENT_W_PCT,
          hPct: 0.1,
          color: '#d1d5db',
          thickness: 1,
        });
        cursor = Math.min(cursor + m.h + m.spaceAfter, BOTTOM_PT);
      } else if (m.kind === 'row') {
        emitRow(m);
      } else {
        emitText(m);
      }
    }
  }

  // Unbalanced cardStart (builder bug guard) — close at the current cursor.
  for (const c of openCards.splice(0)) pushCardSegment(c, cursor);
  // Card boxes first ⇒ borders/fills always render BEHIND text and checkboxes.
  return { annotations: [...cardBoxes, ...annotations], lastPage: page, cursorPt: cursor };
}

// Compose the full layout (annotations + fields + page count) from a frozen
// content snapshot. Pure and deterministic — exported for tests.
export async function buildReservationSummaryLayout(snapshot, opts = {}) {
  const t = L[snapshot.language === 'en' ? 'en' : 'he'];
  const align = snapshot.language === 'en' ? 'left' : 'right';
  const measureFont = opts.font || (await createMeasurementFont());
  const clean = supportedTextFilter(measureFont);
  const groups = snapshot.groups || [];
  const signatureBytes = opts.signatureBytes || null;

  const totalParticipants = groups.reduce((a, g) => a + (g.participants || 0), 0);
  const submittedDate = fmtIsoDate(snapshot.submittedAt);

  const blocks = [];
  const fields = [];

  // Header — logo (leading edge, true aspect ratio), title, request meta.
  const logo = logoBytes();
  let logoHPct = 0;
  if (logo) {
    const dims = pngDimensions(logo);
    const hPct = LOGO_H_PCT;
    const wPct = dims
      ? Math.min(24, ((dims.w / dims.h) * ((hPct / 100) * A4.h) * 100) / A4.w)
      : 8;
    fields.push({
      fieldType: 'stamp',
      page: 1,
      xPct: align === 'left' ? MARGIN_X_PCT : 100 - MARGIN_X_PCT - wPct,
      yPct: 4,
      wPct,
      hPct,
      imageBytes: logo,
    });
    logoHPct = hPct + 1.2;
  }

  blocks.push({
    items: [
      ...(logoHPct
        ? [{ gap: (logoHPct / 100) * A4.h }]
        : [{ text: clean(t.brand), fontSize: 12, color: '#6b7280', spaceAfter: 6 }]),
      { text: clean(t.title), fontSize: 20, spaceAfter: 8 },
      {
        text: clean(
          [
            `${t.request(snapshot.sessionNo)} · ${t.submitted(submittedDate)}`,
            t.totals(groups.length, totalParticipants),
          ].join('\n'),
        ),
        fontSize: 11,
        color: '#374151',
        spaceAfter: 10,
      },
      { divider: true, spaceAfter: 12 },
    ],
  });

  // FORM-SNAPSHOT STYLING: the document mirrors the reservation form's card
  // language — every section is a bordered card in the form's palette (blue
  // card borders; the emerald pricing box; the blue on-site sub-box), in the
  // form's section order. Someone holding the submitted form next to this
  // document should immediately recognize the same document.
  const CARD = { color: '#bfdbfe', padX: 1.6 }; // form: white card, blue border
  const PRICE_BOX = { color: '#a7f3d0', fill: '#ecfdf5', padX: 0.8 }; // emerald box
  const ONSITE_BOX = { color: '#dbeafe', fill: '#eff6ff', padX: 0.8 }; // blue-50 box

  // Booker details card ("פרטי המזמין") — same order as the form: name, phone,
  // email, travel company.
  const booker = snapshot.booker || {};
  const bookerLines = [];
  if (booker.name) bookerLines.push(t.bookerName(booker.name));
  if (booker.phone) bookerLines.push(t.bookerPhone(booker.phone));
  if (booker.email) bookerLines.push(t.bookerEmail(booker.email));
  if (booker.company) bookerLines.push(t.bookerCompany(booker.company));
  if (bookerLines.length) {
    blocks.push({
      items: [
        { cardStart: CARD },
        { gap: 9 },
        { text: clean(t.bookerTitle), fontSize: 13, spaceAfter: 4 },
        { text: clean(bookerLines.join('\n')), fontSize: 11, color: '#374151', spaceAfter: 0 },
        { gap: 9 },
        { cardEnd: true, spaceAfter: 14 },
      ],
    });
  }

  // Group cards — one keep-together card each, mirroring the form card's
  // internal order: header (group N — name) → details (city, activity,
  // date/time, participants, guides, tour language) → on-site contact sub-box →
  // notes → the emerald pricing box. FULL notes with paragraph breaks.
  groups.forEach((g, i) => {
    const details = [g.orderNo ? t.order(g.orderNo) : t.orderPending];
    if (g.cityLabel) details.push(t.city(g.cityLabel));
    if (g.activityLabel) details.push(t.activity(g.activityLabel));
    details.push(t.when(fmtDate(g.tourDate), g.tourTime));
    details.push(t.participants(g.participants));
    if (g.guides != null) details.push(t.guides(g.guides));
    if (g.tourLanguage) details.push(t.tourLanguage(t.langNames[g.tourLanguage] || g.tourLanguage));

    const items = [
      { cardStart: CARD },
      { gap: 9 },
      { text: clean(`${t.group(g.index || i + 1)} — ${g.groupName || ''}`), fontSize: 12.5, spaceAfter: 4 },
      { text: clean(details.join('\n')), fontSize: 11, color: '#374151', spaceAfter: 0 },
    ];
    if (g.onSiteContactName) {
      // On-site contact — the form's quiet blue sub-box.
      items.push({ gap: 6 });
      items.push({ cardStart: ONSITE_BOX });
      items.push({ gap: 5 });
      items.push({
        text: clean(t.onSite(g.onSiteContactName, g.onSiteContactPhone || '')),
        fontSize: 10.5,
        color: '#1e3a5f',
        spaceAfter: 0,
      });
      items.push({ gap: 5 });
      items.push({ cardEnd: true });
    }
    if (g.notes) {
      items.push({ gap: 6 });
      items.push({ text: clean(t.notes(String(g.notes))), fontSize: 11, color: '#374151' });
    }
    // Pricing — the form's emerald box, same rows/totals the agent saw.
    items.push({ gap: 8 });
    items.push({ cardStart: PRICE_BOX });
    items.push({ gap: 6 });
    items.push(...pricingItems(g.pricing, t, clean, snapshot.language));
    items.push({ gap: 6 });
    items.push({ cardEnd: true });
    items.push({ gap: 9 });
    items.push({ cardEnd: true, spaceAfter: 14 });
    blocks.push({ items });
  });

  // Invoice delivery — the checkbox group as submitted: BOTH options with
  // vector checked/unchecked boxes, preserving each label and state.
  //
  // LEGAL IMMUTABILITY: every legal sentence below renders from the FROZEN
  // snapshot (snapshot.legal + each confirmation's frozen textLines) when the
  // session recorded it; the module's L tables are only the fallback for
  // legacy snapshots issued before wording was frozen. Editing the registry
  // can therefore never reword a previously-submitted reservation.
  const legal = snapshot.legal || null;
  const inv = snapshot.invoice || null;

  // Cancellation acknowledgement card — FIRST, matching the form's order
  // (the checkbox card sits above the invoice section). The EXACT accepted
  // statement, line for line (frozen on the confirmation at submit;
  // snapshot.legal is the same registry text). Legacy sessions without frozen
  // text keep the historical one-line summary.
  const confirmations = Array.isArray(snapshot.confirmations) ? snapshot.confirmations : [];
  const cancellation = confirmations.find((c) => c?.key === 'flexible_cancellation');
  if (cancellation) {
    const frozenLines =
      (Array.isArray(cancellation.textLines) && cancellation.textLines.length
        ? cancellation.textLines
        : null) ||
      (Array.isArray(legal?.cancellation?.lines) && legal.cancellation.lines.length
        ? legal.cancellation.lines
        : null);
    const items = [{ cardStart: CARD }, { gap: 8 }];
    if (frozenLines) {
      frozenLines.forEach((line, i) => {
        items.push({
          text: clean(line),
          fontSize: 10,
          color: '#374151',
          ...(i === 0 ? { check: true } : {}),
          spaceAfter: i === frozenLines.length - 1 ? 0 : 2,
        });
      });
    } else {
      items.push({ text: clean(t.confirmed), fontSize: 10, color: '#374151', check: true });
    }
    items.push({ gap: 8 });
    items.push({ cardEnd: true, spaceAfter: 14 });
    blocks.push({ items });
  }

  // Invoice delivery card — the checkbox group as submitted: BOTH options with
  // vector checked/unchecked boxes, preserving each label and state.
  if (inv && (inv.toOrganizer !== undefined || inv.toFinance !== undefined)) {
    const invLabel = (frozenStem, legacyFn, details) =>
      frozenStem ? `${frozenStem}${details ? ` — ${details}` : ''}` : legacyFn(details);
    const financeParts = [inv.financeName, inv.financeEmail, inv.financePhone]
      .filter(Boolean)
      .join(' · ');
    blocks.push({
      items: [
        { cardStart: CARD },
        { gap: 8 },
        { text: clean(legal?.invoice?.title || t.invoiceTitle), fontSize: 12.5, spaceAfter: 4 },
        {
          text: clean(invLabel(legal?.invoice?.toOrganizer, t.invOrganizer, booker.name || '')),
          fontSize: 11,
          color: inv.toOrganizer ? '#111827' : '#9ca3af',
          check: inv.toOrganizer ? 'checked' : 'unchecked',
          spaceAfter: 4,
        },
        {
          text: clean(invLabel(legal?.invoice?.toFinance, t.invFinance, inv.toFinance ? financeParts : '')),
          fontSize: 11,
          color: inv.toFinance ? '#111827' : '#9ca3af',
          check: inv.toFinance ? 'checked' : 'unchecked',
          spaceAfter: 0,
        },
        { gap: 8 },
        { cardEnd: true },
      ],
    });
  }

  const flow = flowBlocks(blocks, measureFont, { align });

  // Footer — pinned to the bottom of the final page; moves to its own page
  // when content reaches into the footer zone.
  const footerPage = flow.cursorPt > FOOTER_TOP_PT ? flow.lastPage + 1 : flow.lastPage;
  const pageCount = footerPage;
  const annotations = [...flow.annotations];

  annotations.push({
    kind: 'line',
    page: footerPage,
    xPct: MARGIN_X_PCT,
    yPct: 75.5,
    wPct: CONTENT_W_PCT,
    hPct: 0.1,
    color: '#d1d5db',
    thickness: 1,
  });

  if (signatureBytes?.length) {
    // Drawn signature — aspect-fit into a 24% × 8% box, anchored to the
    // leading edge (right in HE, left in EN), above the signer line.
    const dims = pngDimensions(signatureBytes);
    const maxWpt = (24 / 100) * A4.w;
    const maxHpt = (8 / 100) * A4.h;
    let wPct = 24;
    let hPct = 8;
    if (dims) {
      const scale = Math.min(maxWpt / dims.w, maxHpt / dims.h);
      wPct = ((dims.w * scale) / A4.w) * 100;
      hPct = ((dims.h * scale) / A4.h) * 100;
    }
    fields.push({
      fieldType: 'signature',
      page: footerPage,
      xPct: align === 'left' ? MARGIN_X_PCT : 100 - MARGIN_X_PCT - wPct,
      yPct: 77 + (8 - hPct), // bottom-anchored inside the 77–85% zone
      wPct,
      hPct,
      imageBytes: signatureBytes,
    });
  } else if (snapshot.signature?.signerName) {
    // Typed signature — the name IS the signature; render it prominently.
    annotations.push({
      kind: 'note',
      page: footerPage,
      xPct: MARGIN_X_PCT,
      yPct: 80.5,
      wPct: CONTENT_W_PCT,
      hPct: 3,
      fontSize: 16,
      text: snapshot.signature.signerName,
      align,
      breakLongWords: true,
    });
  }

  const signerName = snapshot.signature?.signerName || null;
  const signedLine = signerName
    ? t.signedBy(signerName, submittedDate)
    : signatureBytes?.length
      ? t.signedOn(submittedDate)
      : null;
  if (signedLine) {
    annotations.push({
      kind: 'note',
      page: footerPage,
      xPct: MARGIN_X_PCT,
      yPct: 86,
      wPct: CONTENT_W_PCT,
      hPct: 2,
      fontSize: 10,
      color: '#374151',
      text: clean(signedLine),
      align,
      breakLongWords: true,
    });
  }

  annotations.push({
    kind: 'note',
    page: footerPage,
    xPct: MARGIN_X_PCT,
    yPct: 89.5,
    wPct: CONTENT_W_PCT,
    hPct: 4,
    fontSize: 9,
    color: '#6b7280',
    // Frozen disclaimer wins (legal immutability); L-table only for legacy.
    text: clean(legal?.disclaimer || t.disclaimer),
    align,
  });

  // Reservation reference + generation timestamp — small, on the footer page.
  const generatedDate = fmtIsoDate(snapshot.generatedAt) || submittedDate;
  annotations.push({
    kind: 'note',
    page: footerPage,
    xPct: MARGIN_X_PCT,
    yPct: 94.2,
    wPct: CONTENT_W_PCT,
    hPct: 1.4,
    fontSize: 8.5,
    color: '#9ca3af',
    text: clean(t.generated(snapshot.sessionNo, generatedDate)),
    align,
  });

  // Continuation headers + page numbers (multi-page documents only).
  if (pageCount > 1) {
    for (let p = 2; p <= pageCount; p += 1) {
      annotations.push({
        kind: 'note',
        page: p,
        xPct: MARGIN_X_PCT,
        yPct: 4,
        wPct: CONTENT_W_PCT,
        hPct: 1.6,
        fontSize: 9,
        color: '#9ca3af',
        text: clean(t.continued(snapshot.sessionNo)),
        align,
      });
    }
    for (let p = 1; p <= pageCount; p += 1) {
      annotations.push({
        kind: 'note',
        page: p,
        xPct: MARGIN_X_PCT,
        yPct: 96.3,
        wPct: CONTENT_W_PCT,
        hPct: 1.4,
        fontSize: 8.5,
        color: '#9ca3af',
        text: t.pageOf(p, pageCount),
        // Page numbers sit on the TRAILING edge — mirrored per language.
        align: align === 'left' ? undefined : 'left',
      });
    }
  }

  return { pageCount, annotations, fields };
}

/**
 * Build the canonical reservation-summary PDF from a frozen content snapshot
 * (+ the session's signature PNG bytes, kept outside the JSON snapshot).
 * Pure function of its inputs — the same snapshot renders the identical
 * document, forever.
 */
export async function buildReservationSummaryPdf(snapshot, { signatureBytes = null } = {}) {
  const layout = await buildReservationSummaryLayout(snapshot, { signatureBytes });

  // Blank A4 base — same pdf-lib as the canonical renderer.
  const base = await PDFDocument.create();
  // Pin the PDF metadata dates to the snapshot's FROZEN generation time —
  // pdf-lib otherwise stamps wall-clock "now" (second granularity), which was
  // the only nondeterminism in the bytes. With the dates pinned, the same
  // frozen snapshot always yields the exact same PDF bytes.
  const docDate = snapshot.generatedAt ? new Date(snapshot.generatedAt) : new Date(0);
  base.setCreationDate(docDate);
  base.setModificationDate(docDate);
  for (let i = 0; i < layout.pageCount; i += 1) base.addPage([A4.w, A4.h]);
  const baseBytes = Buffer.from(await base.save());

  return renderFinalPdf(baseBytes, layout.fields, layout.annotations);
}
