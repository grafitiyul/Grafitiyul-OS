// Export endpoints. One foundation, three entry points (item / folder /
// flow), two output formats (DOCX download, print-friendly HTML).
//
// Format selection comes from the URL path so each variant can be
// returned with the correct Content-Type and filename without inspecting
// query params: /docx → DOCX download; /print → standalone HTML.
//
// Include filters & pagination are query params:
//   ?content=1|0       include content items (default 1)
//   ?questions=1|0     include question items (default 1)
//   ?pagination=compact|page-per-item   default compact

import { Router } from 'express';
import { handle } from '../asyncHandler.js';
import {
  collectContentItem,
  collectQuestionItem,
  collectFolder,
  collectFlow,
  htmlToPlain,
} from '../services/exports/collect.js';
import { renderDocx } from '../services/exports/docx.js';
import { renderPrintHtml } from '../services/exports/printHtml.js';

const router = Router();

function readOpts(req) {
  // Tolerant boolean parsing — checkboxes typically POST '1'/'0' or
  // 'true'/'false', and an absent param means "default to true".
  const truthy = (v) =>
    v === undefined || v === null || v === '' || v === '1' || v === 'true';
  return {
    includeContent: truthy(req.query.content),
    includeQuestions: truthy(req.query.questions),
    pagination:
      req.query.pagination === 'page-per-item' ? 'page-per-item' : 'compact',
  };
}

// ASCII-only filename for the Content-Disposition `filename=` parameter.
// Modern browsers honour `filename*=` (RFC 5987) for the real Hebrew name.
function asciiName(s) {
  return (s || 'export').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) ||
    'export';
}

function setDocxHeaders(res, baseName) {
  const safe = asciiName(baseName);
  const utf8 = encodeURIComponent(`${baseName}.docx`);
  res.set(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  res.set(
    'Content-Disposition',
    `attachment; filename="${safe}.docx"; filename*=UTF-8''${utf8}`,
  );
  res.set('Cache-Control', 'no-store');
}

function setPrintHeaders(res) {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
}

async function loadDoc(kind, id, req) {
  const opts = readOpts(req);
  if (kind === 'content') return [await collectContentItem(id, opts), opts];
  if (kind === 'question') return [await collectQuestionItem(id, opts), opts];
  if (kind === 'folder') return [await collectFolder(id, opts), opts];
  if (kind === 'flow') return [await collectFlow(id, opts), opts];
  return [null, opts];
}

function makeHandlers(kind) {
  const docxHandler = handle(async (req, res) => {
    const [doc, opts] = await loadDoc(kind, req.params.id, req);
    if (!doc) return res.status(404).json({ error: 'not_found' });
    const buffer = await renderDocx(doc, opts);
    const baseName = htmlToPlain(doc.title) || `${kind}-export`;
    setDocxHeaders(res, baseName);
    res.send(buffer);
  });
  const printHandler = handle(async (req, res) => {
    const [doc, opts] = await loadDoc(kind, req.params.id, req);
    if (!doc) return res.status(404).json({ error: 'not_found' });
    const html = renderPrintHtml(doc, opts);
    setPrintHeaders(res);
    res.send(html);
  });
  return { docxHandler, printHandler };
}

for (const kind of ['content', 'question', 'folder', 'flow']) {
  const { docxHandler, printHandler } = makeHandlers(kind);
  router.get(`/${kind}/:id/docx`, docxHandler);
  router.get(`/${kind}/:id/print`, printHandler);
}

export default router;
