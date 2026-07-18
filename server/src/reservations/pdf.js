// Travel Agency Reservations — the customer's official reservation copy
// (BINDING #7/#8): "הורד הזמנה (PDF)" on the Thank-You page.
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
// Layout contract (QA 2026-07-18):
//   - notes render in FULL (paragraph breaks + blank lines preserved, long
//     words/emails character-wrapped) — never truncated, never overflowing
//     the margins;
//   - a group block is kept on one page when it fits, split at line level
//     when it is taller than a page;
//   - the signature/disclaimer footer is pinned to the bottom of the final
//     page — if content reaches into the footer zone, the footer moves to
//     its own page;
//   - EN copies are left-aligned, HE copies right-aligned (mirrored layout).

import { PDFDocument } from 'pdf-lib';
import {
  renderFinalPdf,
  layoutNoteLines,
  createMeasurementFont,
  supportedTextFilter,
  NOTE_LINE_HEIGHT_RATIO,
} from '../services/pdfRender.js';

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

// Check-mark gutter for confirmation lines (pt → pct of page width).
const CHECK_W_PCT = 1.7;
const CHECK_GUTTER_PCT = 2.8;

const L = {
  he: {
    title: 'אישור קבלת בקשת הזמנה',
    brand: 'גרפיטיול',
    request: (no) => `בקשה מספר ${no}`,
    submitted: (d) => `הוגשה בתאריך ${d}`,
    agent: (name, org) => `סוכן: ${name} · ${org}`,
    totals: (g, p) => `${g} קבוצות · ${p} משתתפים סה״כ`,
    group: (i) => `קבוצה ${i}`,
    order: (no) => `מספר הזמנה: GOS-${no}`,
    orderPending: 'מספר הזמנה: יימסר באישור',
    when: (d, t) => `תאריך: ${d}${t ? ` · שעה: ${t}` : ''}`,
    where: (loc, prod) => [loc, prod].filter(Boolean).join(' · '),
    participants: (n) => `משתתפים: ${n}`,
    tourLanguage: (l2) => `שפת הסיור: ${l2}`,
    onSite: (n, p) => `נציג בשטח: ${n}${p ? ` · ${p}` : ''}`,
    notes: (t) => `הערות: ${t}`,
    invoiceTitle: 'משלוח חשבונית',
    invOrganizer: (name) => `למזמין ההזמנה${name ? ` — ${name}` : ''}`,
    invFinance: (parts) => `לאיש הכספים${parts ? ` — ${parts}` : ''}`,
    confirmed:
      'אושרו תנאי הביטול לסוכני תיירות: עד 24 שעות לפני הפעילות — ללא דמי ביטול; בפחות מ־24 שעות — דמי ביטול של 100%.',
    signedBy: (name, d) => `נחתם על ידי ${name} · ${d}`,
    signedOn: (d) => `נחתם בתאריך ${d}`,
    continued: (no) => `גרפיטיול · בקשה מספר ${no} — המשך`,
    pageOf: (i, n) => `עמוד ${i} מתוך ${n}`,
    disclaimer:
      'מסמך זה מאשר את קבלת בקשת ההזמנה בלבד. ההזמנה תיכנס לתוקף רק לאחר אישור סופי של גרפיטיול לכל קבוצה.',
    langNames: { he: 'עברית', en: 'אנגלית', es: 'ספרדית', fr: 'צרפתית', ru: 'רוסית' },
  },
  en: {
    title: 'Reservation Request Received',
    brand: 'Grafitiyul',
    request: (no) => `Request #${no}`,
    submitted: (d) => `Submitted on ${d}`,
    agent: (name, org) => `Agent: ${name} · ${org}`,
    totals: (g, p) => `${g} groups · ${p} participants in total`,
    group: (i) => `Group ${i}`,
    order: (no) => `Order number: GOS-${no}`,
    orderPending: 'Order number: assigned upon confirmation',
    when: (d, t) => `Date: ${d}${t ? ` · Time: ${t}` : ''}`,
    where: (loc, prod) => [loc, prod].filter(Boolean).join(' · '),
    participants: (n) => `Participants: ${n}`,
    tourLanguage: (l2) => `Tour language: ${l2}`,
    onSite: (n, p) => `On-site contact: ${n}${p ? ` · ${p}` : ''}`,
    notes: (t) => `Notes: ${t}`,
    invoiceTitle: 'Invoice delivery',
    invOrganizer: (name) => `To the booker${name ? ` — ${name}` : ''}`,
    invFinance: (parts) => `To the finance contact${parts ? ` — ${parts}` : ''}`,
    confirmed:
      'Travel-agent cancellation terms accepted: up to 24 hours before the activity — no cancellation fee; less than 24 hours — a 100% cancellation fee.',
    signedBy: (name, d) => `Signed by ${name} · ${d}`,
    signedOn: (d) => `Signed on ${d}`,
    continued: (no) => `Grafitiyul · Request #${no} — continued`,
    pageOf: (i, n) => `Page ${i} of ${n}`,
    disclaimer:
      'This document confirms receipt of the reservation request only. The reservation becomes final only after confirmation by Grafitiyul for each group.',
    langNames: { he: 'Hebrew', en: 'English', es: 'Spanish', fr: 'French', ru: 'Russian' },
  },
};

const fmtDate = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(ymd || '');
};

// PNG pixel dimensions from the IHDR chunk (always at a fixed offset in a
// valid PNG — intake verified the magic). Used to place the drawn signature
// with its TRUE aspect ratio instead of stretching it into a fixed box.
export function pngDimensions(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return w > 0 && h > 0 ? { w, h } : null;
}

// ── flow layout engine ───────────────────────────────────────────────────────
// Items: { text, fontSize, color?, spaceAfter?, check? } | { divider: true,
// spaceAfter? } | { gap: pt }. Blocks: { items } — kept on one page when the
// whole block fits on a fresh page; split at LINE level otherwise. All
// heights are measured with the renderer's own wrap function + font.

function flowBlocks(blocks, font, { align }) {
  const annotations = [];
  let page = 1;
  let cursor = TOP_FIRST_PT;

  const lineH = (fs) => fs * NOTE_LINE_HEIGHT_RATIO;
  const newPage = () => {
    page += 1;
    cursor = TOP_REST_PT;
  };

  const measureItem = (item) => {
    if (item.gap) return { kind: 'gap', h: item.gap };
    if (item.divider) return { kind: 'divider', h: 2, spaceAfter: item.spaceAfter ?? 10 };
    const wrapW = item.check ? WRAP_W_PT - (CHECK_GUTTER_PCT / 100) * A4.w : WRAP_W_PT;
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

  const emitText = (m) => {
    let lines = m.lines;
    const fs = m.item.fontSize;
    const lh = lineH(fs);
    let checkPending = m.item.check === true;
    while (lines.length) {
      const maxLines = Math.floor((BOTTOM_PT - cursor) / lh);
      if (maxLines < 1) {
        newPage();
        continue;
      }
      const chunk = lines.slice(0, maxLines);
      lines = lines.slice(maxLines);
      const chunkH = chunk.length * lh;
      // Confirmation lines reserve a leading-edge gutter for the check mark.
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
        annotations.push({
          kind: 'check',
          page,
          xPct:
            align === 'left'
              ? MARGIN_X_PCT
              : 100 - MARGIN_X_PCT - CHECK_W_PCT,
          yPct: (cursor / A4.h) * 100 + 0.1,
          wPct: CHECK_W_PCT,
          hPct: 1.15,
          thickness: 1.8,
          color: '#059669',
        });
      }
      cursor += chunkH;
      if (lines.length) newPage();
    }
    cursor = Math.min(cursor + m.spaceAfter, BOTTOM_PT);
  };

  const freshCapacity = BOTTOM_PT - TOP_REST_PT;
  for (const block of blocks) {
    const measured = block.items.map(measureItem).filter((m) => m.kind !== 'text' || m.lines.length);
    if (!measured.length) continue;
    const blockH = measured.reduce((a, m) => a + m.h + (m.spaceAfter || 0), 0);
    if (blockH > BOTTOM_PT - cursor && blockH <= freshCapacity) newPage();
    for (const m of measured) {
      if (m.kind === 'gap') {
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
      } else {
        emitText(m);
      }
    }
  }

  return { annotations, lastPage: page, cursorPt: cursor };
}

// Compose the full layout (annotations + fields + page count) from a frozen
// session. Pure and deterministic — exported for tests + stress harness.
export async function buildReservationLayout(session, font = null) {
  const t = L[session.language === 'en' ? 'en' : 'he'];
  const align = session.language === 'en' ? 'left' : 'right';
  const measureFont = font || (await createMeasurementFont());
  const clean = supportedTextFilter(measureFont);
  const groups = session.groups || [];

  const totalParticipants = groups.reduce((a, g) => a + (g.participants || 0), 0);
  const submittedDate = session.submittedAt
    ? fmtDate(new Date(session.submittedAt).toISOString().slice(0, 10))
    : '';

  const blocks = [];

  // Header: brand, title, request meta, divider.
  blocks.push({
    items: [
      { text: clean(t.brand), fontSize: 12, color: '#6b7280', spaceAfter: 6 },
      { text: clean(t.title), fontSize: 22, spaceAfter: 10 },
      {
        text: clean(
          [
            `${t.request(session.sessionNo)} · ${t.submitted(submittedDate)}`,
            t.agent(session.agentName || '', session.organizationName || ''),
            t.totals(groups.length, totalParticipants),
          ].join('\n'),
        ),
        fontSize: 11,
        color: '#374151',
        spaceAfter: 10,
      },
      { divider: true, spaceAfter: 14 },
    ],
  });

  // Groups — one keep-together block each; FULL notes with paragraph breaks.
  groups.forEach((g, i) => {
    const details = [g.createdDealOrderNo ? t.order(g.createdDealOrderNo) : t.orderPending];
    const where = t.where(g.locationLabel, g.productLabel);
    if (where) details.push(where);
    details.push(t.when(fmtDate(g.tourDate), g.tourTime));
    details.push(t.participants(g.participants));
    if (g.tourLanguage) details.push(t.tourLanguage(t.langNames[g.tourLanguage] || g.tourLanguage));
    if (g.onSiteContactName) details.push(t.onSite(g.onSiteContactName, g.onSiteContactPhone || ''));

    const items = [
      { text: clean(`${t.group(i + 1)} — ${g.groupName || ''}`), fontSize: 12.5, spaceAfter: 4 },
      { text: clean(details.join('\n')), fontSize: 11, color: '#374151', spaceAfter: 0 },
    ];
    if (g.notes) {
      items.push({ gap: 4 });
      items.push({ text: clean(t.notes(String(g.notes))), fontSize: 11, color: '#374151' });
    }
    items.push({ gap: 16 });
    blocks.push({ items });
  });

  // Invoice delivery + accepted confirmations — one closing block.
  const inv = session.payloadSnapshot?.invoice || null;
  const closing = [];
  if (inv && (inv.toOrganizer || inv.toFinance)) {
    closing.push({ divider: true, spaceAfter: 10 });
    closing.push({ text: clean(t.invoiceTitle), fontSize: 12.5, spaceAfter: 4 });
    const lines = [];
    if (inv.toOrganizer) lines.push(t.invOrganizer(session.agentName || ''));
    if (inv.toFinance) {
      const parts = [inv.financeName, inv.financeEmail, inv.financePhone]
        .filter(Boolean)
        .join(' · ');
      lines.push(t.invFinance(parts));
    }
    closing.push({ text: clean(lines.join('\n')), fontSize: 11, color: '#374151', spaceAfter: 10 });
  }
  const confirmations = Array.isArray(session.legalConfirmations) ? session.legalConfirmations : [];
  if (confirmations.some((c) => c?.key === 'flexible_cancellation')) {
    closing.push({ text: clean(t.confirmed), fontSize: 10, color: '#374151', check: true });
  }
  if (closing.length) blocks.push({ items: closing });

  const flow = flowBlocks(blocks, measureFont, { align });

  // Footer — pinned to the bottom of the final page; moves to its own page
  // when content reaches into the footer zone.
  const footerPage = flow.cursorPt > FOOTER_TOP_PT ? flow.lastPage + 1 : flow.lastPage;
  const pageCount = footerPage;
  const annotations = [...flow.annotations];
  const fields = [];

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

  if (session.signatureBytes?.length) {
    // Drawn signature — aspect-fit into a 24% × 8% box, anchored to the
    // leading edge (right in HE, left in EN), above the signer line.
    const dims = pngDimensions(session.signatureBytes);
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
      imageBytes: session.signatureBytes,
    });
  } else if (session.signerName) {
    // Typed signature — the name IS the signature; render it prominently.
    annotations.push({
      kind: 'note',
      page: footerPage,
      xPct: MARGIN_X_PCT,
      yPct: 80.5,
      wPct: CONTENT_W_PCT,
      hPct: 3,
      fontSize: 16,
      text: session.signerName,
      align,
      breakLongWords: true,
    });
  }

  const signedLine = session.signerName
    ? t.signedBy(session.signerName, submittedDate)
    : session.signatureBytes?.length
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
    text: clean(t.disclaimer),
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
        text: clean(t.continued(session.sessionNo)),
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
 * Build the reservation-copy PDF from a frozen session (+ groups, each
 * optionally carrying createdDealOrderNo). Pure function of session data —
 * a re-download regenerates the identical official copy.
 */
export async function buildReservationPdf(session) {
  const layout = await buildReservationLayout(session);

  // Blank A4 base — same pdf-lib as the canonical renderer.
  const base = await PDFDocument.create();
  for (let i = 0; i < layout.pageCount; i += 1) base.addPage([A4.w, A4.h]);
  const baseBytes = Buffer.from(await base.save());

  return renderFinalPdf(baseBytes, layout.fields, layout.annotations);
}
