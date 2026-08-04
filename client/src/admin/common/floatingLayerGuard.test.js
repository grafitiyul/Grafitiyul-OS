import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// THE floating-layer guard. A dropdown positioned with `absolute` inside its
// parent is clipped by ANY ancestor that has overflow — a scrolling dialog
// body, a capped popover panel, a table scroll container — and no z-index can
// rescue it, because overflow clipping is not a stacking-order concern. That
// is exactly how the guide picker inside the Deal → Tour Details popover ended
// up cut off.
//
// So: floating UI (menus, dropdowns, comboboxes, pickers) renders through the
// shared portal layer — AnchoredMenu, or SearchSelect for the searchable-async
// case. This test fails when a NEW in-flow floating panel appears.
//
// Signature we detect on ONE element: `absolute` + a z-index + a panel shadow,
// and NOT inset-stretched. A menu is offset from its anchor's edge; something
// stretched with `inset-0` / `inset-y-0` is a bounded drawer filling its pane
// on purpose (DealDrawer, the quote TOC), not a floating surface. A positioned
// decoration (a logo, a drop indicator) has no shadow and is not matched.

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');

// Known surfaces that still position their own dropdown in flow. Each is
// OUTSIDE the Deal workspace and has not been reviewed for a clipping ancestor.
// This list may only SHRINK — converting one to AnchoredMenu is the fix, and
// adding a new entry needs an explicit owner decision.
const NOT_YET_CONVERTED = new Set([
  'admin/communication/EventEditorPage.jsx',
  'admin/crm/contacts/ContactDetail.jsx',
  'admin/documents/instances/InstanceEditor.jsx',
  'admin/email/RecipientField.jsx',
  'admin/pricing/PricingBoard.jsx',
  'admin/procedures/bank/BankListPane.jsx',
  'admin/procedures/flows/FlowTreeRow.jsx',
  'admin/products/LocationsSettings.jsx',
  'admin/products/ProductsSettings.jsx',
  'admin/quote/QuotePreviewCanvas.jsx',
  'admin/tour-content/StationEditor.jsx',
  'admin/whatsapp/ChatComposer.jsx',
  'editor/DynamicFieldNode.jsx',
  'editor/EmojiButton.jsx',
  'editor/TitleEditor.jsx',
  'editor/Toolbar.jsx',
  'profile/BankDetailsFields.jsx',
  'quote/CustomerQuoteView.jsx',
  'shell/search/GlobalSearch.jsx',
]);

// `absolute` and `z-<n>`/`z-[..]` and a shadow, in any order, on one element.
const CLASS_ATTR = /class(Name)?=\{?[`"'][^`"']*\babsolute\b[^`"']*/g;

function isInFlowFloatingPanel(chunk) {
  if (!/\bz-(\d+|\[)/.test(chunk)) return false;
  if (!/\bshadow-(lg|xl|2xl)\b/.test(chunk)) return false;
  // Stretched VERTICALLY (`inset-0`, `inset-y-0`) = a bounded drawer filling
  // its pane on purpose. `inset-x-0` alone is just a full-width dropdown under
  // its anchor — that IS a floating panel and must not be excused.
  if (/\binset-(0|y-)/.test(chunk)) return false;
  return true;
}

function offendingFiles(files, srcRoot) {
  const hits = new Set();
  for (const file of files) {
    const rel = path.relative(srcRoot, file).split(path.sep).join('/');
    const source = readFileSync(file, 'utf8');
    for (const [chunk] of source.matchAll(CLASS_ATTR)) {
      if (isInFlowFloatingPanel(chunk)) hits.add(rel);
    }
  }
  return hits;
}

function jsxFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) jsxFiles(full, out);
    else if (entry.endsWith('.jsx')) out.push(full);
  }
  return out;
}

test('no NEW in-flow floating panel — dropdowns go through the shared portal layer', () => {
  const offenders = [...offendingFiles(jsxFiles(SRC), SRC)].filter(
    (rel) => !NOT_YET_CONVERTED.has(rel),
  );
  assert.deepEqual(
    offenders.sort(),
    [],
    'render these through AnchoredMenu (or SearchSelect) instead of an `absolute` panel — ' +
      'an ancestor with overflow will clip them, and z-index cannot fix that',
  );
});

test('the allowlist stays honest — every entry still has an in-flow panel', () => {
  // A stale allowlist quietly re-opens the door. Once a file is converted its
  // entry must be deleted, not left behind.
  const stale = [...NOT_YET_CONVERTED].filter(
    (rel) => !offendingFiles([path.join(SRC, rel)], SRC).size,
  );
  assert.deepEqual(stale, [], 'these are already converted — remove them from NOT_YET_CONVERTED');
});

test('the Deal workspace floating surfaces are all on the shared layer', () => {
  // The surfaces from the reported bug, pinned: the guide picker and its role
  // menu inside the Deal → Tour Details popover, the pickers inside Deal
  // dialogs, the Builder VAT menu, and the filter combobox that sits inside
  // its own popover.
  for (const rel of [
    'admin/tours/TourTeamEditor.jsx',
    'admin/crm/common/ContactPicker.jsx',
    'admin/crm/common/OrgPicker.jsx',
    'admin/deals/PriceBuilderDialog.jsx',
    'admin/common/filters/AdvancedFilterButton.jsx',
  ]) {
    const source = readFileSync(path.join(SRC, rel), 'utf8');
    assert.match(source, /AnchoredMenu/, `${rel} must use the shared portal layer`);
    assert.equal(
      offendingFiles([path.join(SRC, rel)], SRC).size,
      0,
      `${rel} must not position a floating panel in flow`,
    );
  }
});
