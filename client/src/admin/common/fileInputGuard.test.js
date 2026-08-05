import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// THE upload-field guard. Every upload field in GOS supports BOTH click-to-pick
// AND drag-and-drop through the shared useFileDrop hook (which owns the hidden
// <input type="file">, drag-over state, and accept/size validation) — that was
// the CRM-Products incident: a library-only picker forced operators to upload
// somewhere else and come back.
//
// A raw `type="file"` input in a component is therefore a smell: it usually
// means a click-only picker with no drop support. This test fails when a NEW
// raw file input appears outside the allowlist below. The fix is useFileDrop
// (spread `inputProps` + `dropProps`); adding an allowlist entry instead needs
// an explicit reason, like the existing ones.

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');

// path (relative to src/, forward slashes) → why a raw input is accepted there.
// This list may only SHRINK.
const RAW_FILE_INPUT_ALLOWLIST = new Map([
  ['admin/common/useFileDrop.js', 'the ONE owner of the shared hidden input'],
  ['admin/whatsapp/ChatComposer.jsx', 'has its own proven drop + clipboard-paste implementation'],
  ['admin/email/EmailComposer.jsx', 'has its own drop implementation'],
  ['admin/deals/files/DealFilesTab.jsx', 'has its own drop implementation'],
  ['admin/tours/gallery/TourGalleryWorkspace.jsx', 'has its own proven whole-page drop implementation'],
  ['editor/Toolbar.jsx', 'editor toolbar pickers; drop/paste live in RichEditor editorProps'],
  ['editor/MediaImage.jsx', 'in-editor image replace control; editor-level drop covers insertion'],
  ['admin/documents/signers/SignerDetail.jsx', 'signature/stamp PNG asset domain (click-only accepted)'],
  ['admin/documents/instances/InstanceEditor.jsx', 'signature PNG override (click-only accepted)'],
  ['admin/documents/templates/TemplatesPage.jsx', 'PDF template upload, not an image field'],
  ['admin/documents/index_/DocumentsIndexPage.jsx', 'PDF upload, not an image field'],
  ['admin/deals/collection/ManualPaymentModal.jsx', 'any-file evidence attach (click-only accepted)'],
  ['portal/ProfilePage.jsx', 'mobile-first portal surface — camera/library picker'],
  ['questionnaire/QuestionnaireRuntime.jsx', 'mobile-first form runtime (staff/public fillers)'],
  ['gallery/CustomerGalleryPage.jsx', 'customer-facing surface'],
  ['quote/SignaturePopup.jsx', 'customer-facing surface'],
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

test('raw <input type="file"> appears only on the reviewed allowlist (new upload fields must use useFileDrop)', () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const src = readFileSync(file, 'utf8');
    if (!/type=["']file["']/.test(src)) continue;
    if (!RAW_FILE_INPUT_ALLOWLIST.has(rel)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    'New raw file input(s) found. Use the shared useFileDrop hook (click + drag-and-drop) ' +
      'instead of a hand-rolled <input type="file">, or add a justified allowlist entry: ' +
      offenders.join(', '),
  );
});

test('allowlist entries still exist (stale entries must be pruned)', () => {
  const stale = [];
  for (const rel of RAW_FILE_INPUT_ALLOWLIST.keys()) {
    const p = path.join(SRC, ...rel.split('/'));
    let src = null;
    try {
      src = readFileSync(p, 'utf8');
    } catch {
      stale.push(rel + ' (file missing)');
      continue;
    }
    if (!/type=["']file["']/.test(src)) stale.push(rel + ' (no raw file input any more)');
  }
  assert.deepEqual(stale, [], 'Prune these allowlist entries: ' + stale.join(', '));
});

test('RichEditor wires image drop AND paste into the editor (capability parity with the toolbar image button)', () => {
  const src = readFileSync(path.join(SRC, 'editor', 'RichEditor.jsx'), 'utf8');
  assert.match(src, /handleDrop/, 'editorProps.handleDrop missing');
  assert.match(src, /handlePaste/, 'editorProps.handlePaste missing');
  assert.match(src, /uploadImagesIntoEditor/, 'drop/paste must ride the canonical editor upload runner');
});
