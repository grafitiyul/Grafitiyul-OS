import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Regression guard: the converted admin flows must use the system dialogs
// (ConfirmDialog / PromptDialog / AlertDialog / inline error banners) — never
// native browser dialogs. Scans WHOLE DIRECTORIES recursively (not a hand-kept
// file list) so a new file in a converted area is covered automatically.
//
// Scope (converted so far): Operations Control, the entire Tours admin module
// (open-tour settings, tour page/modal/team/components, gallery, Woo mapping
// flows), the orphan-tours shell indicator, and the shared dialog components.
// Extend SCOPED_DIRS as more modules are converted.

const SCOPED_DIRS = ['src/admin/control', 'src/admin/tours', 'src/admin/common'];
const SCOPED_FILES = ['src/shell/OrphanToursIndicator.jsx'];

// A real CALL of a native dialog: window.confirm(...) or a bare confirm(...)/
// alert(...)/prompt(...) not preceded by `.`/identifier chars (so member calls
// and local helpers like `pendingConfirm(` don't false-positive).
const NATIVE = /(^|[^.\w$])(window\s*\.\s*)?(confirm|alert|prompt)\s*\(/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(jsx|js)$/.test(name) && !/\.test\.js$/.test(name)) out.push(p);
  }
  return out;
}

const files = [...SCOPED_DIRS.flatMap((d) => walk(d)), ...SCOPED_FILES];
assert.ok(files.length > 20, 'scan scope unexpectedly small — did the directories move?');

for (const file of files) {
  test(`no native browser dialog in ${file}`, () => {
    const src = readFileSync(file, 'utf8');
    const offenders = src
      .split('\n')
      .map((line, i) => ({ line: line.replace(/\/\/.*$/, ''), n: i + 1 })) // strip line comments
      .filter(({ line }) => NATIVE.test(line));
    assert.equal(
      offenders.length,
      0,
      `native dialog call(s) found: ${offenders.map((o) => `L${o.n}`).join(', ')} — use ConfirmDialog/PromptDialog/AlertDialog`,
    );
  });
}
