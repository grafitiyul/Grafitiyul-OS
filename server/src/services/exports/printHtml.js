// ExportDocument → standalone print-friendly HTML page.
//
// This is the "PDF" path: the server returns a single HTML document
// that is already RTL-laid-out and print-styled. The user opens it in
// a new tab and uses the browser's "Save as PDF". This avoids shipping
// a server-side Chromium / wkhtmltopdf dependency, and Hebrew renders
// correctly because it's just the browser doing what it already does
// for the rest of the app.
//
// Section heading mapping mirrors the DOCX side:
//   document.title             → <h1>
//   folder/group at depth 0    → <h2>
//   folder/group at depth ≥ 1  → <h3>
//   content/question (any d)   → <h4> (skipped if section.title is omitted)

import { htmlToPlain } from './collect.js';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Replace media that we don't want rendered with a textual placeholder.
// Inline <img> stays. <video> and embeds become "[label]" italic spans.
function sanitizeBodyHtml(html) {
  if (!html) return '';
  let out = String(html);
  out = out.replace(
    /<video\b[^>]*?(?:src="([^"]*)")?[^>]*>[\s\S]*?<\/video>/gi,
    (_, src) => placeholder('סרטון', src || ''),
  );
  out = out.replace(
    /<iframe\b[^>]*?(?:src="([^"]*)")?[^>]*>[\s\S]*?<\/iframe>/gi,
    (_, src) => placeholder('סרטון מוטמע', src || ''),
  );
  out = out.replace(
    /<div\b([^>]*data-type="media-embed"[^>]*)>[\s\S]*?<\/div>/gi,
    (_, attrs) => {
      const m = /\bsrc="([^"]*)"/i.exec(attrs || '');
      const url =
        (m && m[1]) ||
        ((/data-provider="([^"]*)"/i.exec(attrs) || [])[1] &&
          (/data-video-id="([^"]*)"/i.exec(attrs) || [])[1])
          ? ''
          : '';
      return placeholder('סרטון מוטמע', url);
    },
  );
  return out;
}

function placeholder(label, href) {
  if (href) {
    return `<p class="media-placeholder"><a href="${escapeHtml(href)}" target="_blank" rel="noopener">[${escapeHtml(label)}]</a></p>`;
  }
  return `<p class="media-placeholder">[${escapeHtml(label)}]</p>`;
}

function sectionHeading(section) {
  if (!section.title) return '';
  const isHierarchy = section.type === 'folder' || section.type === 'group';
  const tag = isHierarchy ? (section.depth <= 0 ? 'h2' : 'h3') : 'h4';
  // Item titles are HTML and may contain dynamic field chips / formatting;
  // folder & group titles are plain text from the DB.
  if (section.titleIsHtml) {
    return `<${tag} class="section-title section-title--item">${section.title}</${tag}>`;
  }
  return `<${tag} class="section-title section-title--hierarchy">${escapeHtml(section.title)}</${tag}>`;
}

function questionExtraHtml(qd) {
  let out = '';
  if (qd.options && qd.options.length > 0) {
    out += `<div class="q-options"><div class="q-options-label">אפשרויות:</div><ol>`;
    for (const opt of qd.options) {
      out += `<li>${escapeHtml(opt)}</li>`;
    }
    out += `</ol></div>`;
  }
  if (qd.allowTextAnswer) {
    out += `<div class="q-meta"><b>שדה טקסט חופשי:</b> מופעל</div>`;
  }
  out += `<div class="q-meta"><b>דרישה:</b> ${escapeHtml(qd.requirementLabel || qd.requirement || '')}</div>`;
  return out;
}

function sectionHtml(section, opts) {
  const heading = sectionHeading(section);
  const isItem = section.type === 'content' || section.type === 'question';
  const body = section.bodyHtml ? sanitizeBodyHtml(section.bodyHtml) : '';
  const extra =
    section.type === 'question' && section.questionData
      ? questionExtraHtml(section.questionData)
      : '';
  const cls = [
    'export-section',
    `export-section--${section.type}`,
    isItem && opts.pagination === 'page-per-item' ? 'page-break-before' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<section class="${cls}">${heading}<div class="gos-prose section-body">${body}${extra}</div></section>`;
}

// Inline CSS — we deliberately don't link to Tailwind / app CSS because
// the print page is a standalone artefact. The styles below cover only
// what gos-prose markup actually emits.
const STYLES = `
  *,*::before,*::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111; }
  body {
    font-family: 'Arial', 'Segoe UI', 'Helvetica', sans-serif;
    direction: rtl;
    line-height: 1.55;
    font-size: 14px;
  }
  .page { max-width: 800px; margin: 0 auto; padding: 32px 28px; }
  h1.doc-title {
    font-size: 28px;
    font-weight: 700;
    margin: 0 0 24px 0;
    border-bottom: 2px solid #111;
    padding-bottom: 10px;
  }
  .section-title { margin: 28px 0 12px 0; font-weight: 700; }
  h2.section-title { font-size: 22px; }
  h3.section-title { font-size: 18px; }
  h4.section-title { font-size: 16px; }
  .section-title--hierarchy { color: #1d4ed8; }
  .section-title--item { color: #111; }
  .section-body { font-size: 14px; }
  .section-body p { margin: 8px 0; }
  .section-body ul, .section-body ol { padding-inline-start: 22px; margin: 8px 0; }
  .section-body img,
  .section-body figure img {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
  }
  .section-body figure { margin: 12px 0; text-align: center; }
  .section-body figcaption { font-size: 12px; color: #555; font-style: italic; margin-top: 4px; }
  .section-body blockquote {
    border-inline-start: 3px solid #999;
    padding: 4px 12px;
    color: #444;
    margin: 10px 0;
  }
  .section-body a { color: #1d4ed8; text-decoration: underline; }
  .section-body hr { border: none; border-top: 1px solid #ccc; margin: 16px 0; }
  .media-placeholder {
    background: #f3f4f6;
    border: 1px dashed #9ca3af;
    color: #4b5563;
    padding: 8px 12px;
    border-radius: 4px;
    font-style: italic;
    text-align: center;
  }
  .q-options { margin-top: 12px; }
  .q-options-label { font-weight: 700; margin-bottom: 4px; }
  .q-options ol { margin: 0; padding-inline-start: 22px; }
  .q-meta { margin-top: 6px; font-size: 13px; }
  .controls {
    position: sticky;
    top: 0;
    background: #fff;
    border-bottom: 1px solid #e5e7eb;
    padding: 12px 24px;
    display: flex;
    gap: 8px;
    align-items: center;
    z-index: 10;
  }
  .controls .hint { color: #6b7280; font-size: 13px; }
  .controls button {
    background: #1d4ed8;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .controls button:hover { background: #1e40af; }
  .page-break-before { break-before: page; page-break-before: always; }
  @media print {
    .controls { display: none; }
    body { font-size: 12pt; }
    .page { padding: 0; max-width: none; }
    h1.doc-title { font-size: 22pt; }
    h2.section-title { font-size: 16pt; }
    h3.section-title { font-size: 14pt; }
    h4.section-title { font-size: 13pt; }
    a { color: inherit; text-decoration: none; }
    .section-body img { break-inside: avoid; }
  }
  @page { margin: 18mm 16mm; }
`;

export function renderPrintHtml(doc, opts = {}) {
  const pagination = opts.pagination || 'compact';
  const pageTitle = htmlToPlain(doc.title) || 'Export';
  const sections = (doc.sections || [])
    .map((s) => sectionHtml(s, { pagination }))
    .join('');
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(pageTitle)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${STYLES}</style>
</head>
<body>
<div class="controls">
  <button type="button" onclick="window.print()">הדפסה / שמירה כ-PDF</button>
  <span class="hint">הדפסה תפתח את חלון השמירה של הדפדפן. בחרו "שמור כ-PDF" כיעד.</span>
</div>
<main class="page">
  <h1 class="doc-title">${escapeHtml(pageTitle)}</h1>
  ${sections}
</main>
</body>
</html>`;
}
