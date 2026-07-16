// Travel Agency Reservations — the customer's official reservation copy
// (BINDING #7/#8): "הורד הזמנה (PDF)" on the Thank-You page.
//
// Generated THROUGH the canonical Documents engine — every glyph is drawn by
// services/pdfRender.js `renderFinalPdf` (Heebo font, the load-bearing
// per-line bidi rule, note wrapping). This module only (a) creates blank A4
// base pages with the same pdf-lib the renderer uses (the renderer's contract
// is "caller provides the source pages"; its own test suite blesses
// programmatically-created blanks), and (b) maps the frozen ReservationSession
// into note annotations + a signature image field. NO second PDF engine.
//
// Future (documents infra reuse, per the approved plan): the programmatic
// base can be replaced by an admin-authored DocumentTemplate snapshot — the
// data mapping below stays, only the source bytes change.

import { PDFDocument } from 'pdf-lib';
import { renderFinalPdf } from '../services/pdfRender.js';

const A4 = { w: 595.28, h: 841.89 };
// Groups per page — sized so the last page always leaves room for the
// signature/footer block. Conservative on purpose: a group block is ≤ 7 short
// lines; wrapping pushes lines down INSIDE the single body note, and the
// capacity keeps even fully-wrapped pages clear of the footer.
const GROUPS_FIRST_PAGE = 4;
const GROUPS_PER_PAGE = 6;

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
    onSite: (n, p) => `נציג בשטח: ${n} · ${p}`,
    notes: (t) => `הערות: ${t}`,
    signedBy: (name, d) => `נחתם על ידי ${name} · ${d}`,
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
    onSite: (n, p) => `On-site contact: ${n} · ${p}`,
    notes: (t) => `Notes: ${t}`,
    signedBy: (name, d) => `Signed by ${name} · ${d}`,
    disclaimer:
      'This document confirms receipt of the reservation request only. The reservation becomes final only after confirmation by Grafitiyul for each group.',
    langNames: { he: 'Hebrew', en: 'English', es: 'Spanish', fr: 'French', ru: 'Russian' },
  },
};

const fmtDate = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(ymd || '');
};

// Split groups across pages (exported for tests).
export function paginateGroups(groups) {
  const pages = [];
  let rest = [...groups];
  pages.push(rest.slice(0, GROUPS_FIRST_PAGE));
  rest = rest.slice(GROUPS_FIRST_PAGE);
  while (rest.length) {
    pages.push(rest.slice(0, GROUPS_PER_PAGE));
    rest = rest.slice(GROUPS_PER_PAGE);
  }
  return pages;
}

function groupLines(t, g, index) {
  const lines = [
    `${t.group(index + 1)} — ${g.groupName}`,
    g.createdDealOrderNo ? t.order(g.createdDealOrderNo) : t.orderPending,
  ];
  const where = t.where(g.locationLabel, g.productLabel);
  if (where) lines.push(where);
  lines.push(t.when(fmtDate(g.tourDate), g.tourTime));
  lines.push(t.participants(g.participants));
  if (g.tourLanguage) lines.push(t.tourLanguage(t.langNames[g.tourLanguage] || g.tourLanguage));
  if (g.onSiteContactName) lines.push(t.onSite(g.onSiteContactName, g.onSiteContactPhone || ''));
  if (g.notes) lines.push(t.notes(String(g.notes).slice(0, 150)));
  lines.push(''); // block separator
  return lines;
}

/**
 * Build the reservation-copy PDF from a frozen session (+ groups, each
 * optionally carrying createdDealOrderNo). Pure function of session data —
 * a re-download regenerates the identical official copy.
 */
export async function buildReservationPdf(session) {
  const t = L[session.language === 'en' ? 'en' : 'he'];
  const groups = session.groups || [];
  const pagesOfGroups = paginateGroups(groups);
  const pageCount = pagesOfGroups.length;

  // Blank A4 base — same pdf-lib as the canonical renderer.
  const base = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) base.addPage([A4.w, A4.h]);
  const baseBytes = Buffer.from(await base.save());

  const totalParticipants = groups.reduce((a, g) => a + (g.participants || 0), 0);
  const submittedDate = session.submittedAt
    ? fmtDate(new Date(session.submittedAt).toISOString().slice(0, 10))
    : '';

  const annotations = [];

  // Header (page 1): brand, title, request meta.
  annotations.push(
    { kind: 'note', page: 1, xPct: 8, yPct: 5, wPct: 84, hPct: 4, fontSize: 12, color: '#6b7280', text: t.brand },
    { kind: 'note', page: 1, xPct: 8, yPct: 8.5, wPct: 84, hPct: 5, fontSize: 22, text: t.title },
    {
      kind: 'note', page: 1, xPct: 8, yPct: 14.5, wPct: 84, hPct: 8, fontSize: 11, color: '#374151',
      text: [
        `${t.request(session.sessionNo)} · ${t.submitted(submittedDate)}`,
        t.agent(session.agentName || '', session.organizationName || ''),
        t.totals(groups.length, totalParticipants),
      ].join('\n'),
    },
    { kind: 'line', page: 1, xPct: 8, yPct: 22.5, wPct: 84, hPct: 0.1, color: '#d1d5db', thickness: 1 },
  );

  // Body: ONE multi-line note per page — wrapping and per-line bidi are the
  // renderer's job, and lines can never overlap inside a single note.
  let groupIndex = 0;
  pagesOfGroups.forEach((pageGroups, p) => {
    const lines = pageGroups.flatMap((g) => groupLines(t, g, groupIndex++));
    if (!lines.length) return;
    annotations.push({
      kind: 'note',
      page: p + 1,
      xPct: 8,
      yPct: p === 0 ? 25 : 8,
      wPct: 84,
      hPct: 60,
      fontSize: 11,
      text: lines.join('\n'),
    });
  });

  // Footer (last page): signature + disclaimer.
  const last = pageCount;
  if (session.signerName) {
    annotations.push({
      kind: 'note', page: last, xPct: 8, yPct: 84, wPct: 84, hPct: 3, fontSize: 10, color: '#374151',
      text: t.signedBy(session.signerName, submittedDate),
    });
  }
  annotations.push({
    kind: 'note', page: last, xPct: 8, yPct: 92, wPct: 84, hPct: 5, fontSize: 9, color: '#6b7280',
    text: t.disclaimer,
  });

  const fields = [];
  if (session.signatureBytes?.length) {
    // Drawn signature — image field on the last page above the signer line.
    fields.push({
      fieldType: 'signature',
      page: last,
      xPct: 8,
      yPct: 76,
      wPct: 22,
      hPct: 7,
      imageBytes: session.signatureBytes,
    });
  }

  return renderFinalPdf(baseBytes, fields, annotations);
}
