import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// ── The no-undef guard: a referenced name that nothing declares ──────────────
//
// THE BUG THIS EXISTS FOR (2026-08-07, production white screen): a shared
// constant was moved out of DealDetail.jsx into deals/config.js, the local
// `const` was deleted — and the import was never added. The identifier was
// still referenced inside the activity-type editor. Nothing caught it:
//
//   * `vite build` succeeded — an undefined global is a RUNTIME ReferenceError,
//     not a bundling error, so rollup happily emitted it;
//   * the full client suite passed — no test rendered that popover;
//   * the project has no ESLint at all, so `no-undef` was never running.
//
// The first person to click "סוג פעילות" on a Deal got a white screen.
//
// This is the frontend twin of the fake-db blind spot, and of the api-contract
// guard (lib/api.contract.test.js) that exists because a missing api method
// white-screens the same way. A green suite is not evidence when nothing
// evaluates the code path.
//
// The check is real scope analysis, not a regex: every referenced identifier
// must resolve to a binding (import, declaration, parameter, function/class
// name, catch clause, JSX-scoped variable…) or to a known global. That is
// exactly what ESLint's no-undef does, run here so it protects EVERY client
// module without adding a toolchain.

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..');
const clientRoot = path.resolve(here, '..', '..');
const require2 = createRequire(pathToFileURL(path.join(clientRoot, 'package.json')));

const { parse } = require2('@babel/parser');
// @babel/traverse ships CJS with an interop default.
const traverseMod = require2('@babel/traverse');
const traverse = traverseMod.default || traverseMod;

// Runtime globals a browser module may legitimately reference. Deliberately a
// CLOSED list: anything not here must be imported or declared, which is the
// whole point — a typo'd or orphaned name has nowhere to hide.
const GLOBALS = new Set([
  // language built-ins
  'globalThis', 'console', 'JSON', 'Math', 'Date', 'Object', 'Array', 'String', 'Number',
  'Boolean', 'Symbol', 'BigInt', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'Intl', 'Infinity', 'NaN',
  'undefined', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'structuredClone', 'queueMicrotask',
  'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array',
  'Float32Array', 'Float64Array', 'ArrayBuffer', 'DataView', 'TextEncoder', 'TextDecoder',
  // browser
  'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'fetch', 'Headers', 'Request', 'Response', 'FormData', 'URL', 'URLSearchParams', 'Blob', 'File',
  'FileReader', 'AbortController', 'AbortSignal', 'Image', 'Audio', 'Event', 'CustomEvent',
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'MessageChannel', 'WebSocket',
  'EventSource', 'DOMParser', 'XMLHttpRequest', 'getComputedStyle', 'matchMedia', 'crypto',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'alert', 'confirm',
  'prompt', 'atob', 'btoa', 'Notification', 'HTMLElement', 'Node', 'NodeList', 'CSS',
  'IDBKeyRange', 'indexedDB', 'performance', 'screen', 'scrollTo', 'print', 'open', 'close',
  'ClipboardItem', 'DataTransfer', 'Range', 'Selection', 'getSelection', 'CanvasRenderingContext2D',
  'SVGElement', 'MediaRecorder', 'AudioContext', 'Worker', 'OffscreenCanvas', 'createImageBitmap',
  'BroadcastChannel', 'Element', 'DocumentFragment', 'ShadowRoot', 'CSSStyleSheet',
  // build-time
  'process', 'import',
  // Vite `define` constants — replaced at build time (see vite.config.js), so
  // they are genuinely undeclared in source and genuinely defined at runtime.
  '__BUILD_ID__', '__BUILT_AT__',
]);

function listFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      listFiles(full, out);
    } else if (/\.jsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function undefinedIdentifiersIn(file) {
  const code = fs.readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator',
        'objectRestSpread', 'dynamicImport', 'topLevelAwait', 'importAssertions'],
    });
  } catch (err) {
    return [{ name: `<parse error: ${err.message}>`, line: err.loc?.line ?? 0 }];
  }

  const found = [];
  traverse(ast, {
    ReferencedIdentifier(p) {
      const { name } = p.node;
      if (GLOBALS.has(name)) return;
      // A resolvable binding anywhere up the scope chain is the definition of
      // "declared" — imports, consts, params, function/class names, catch
      // params, for-of bindings, everything.
      if (p.scope.hasBinding(name, /* noGlobals */ true)) return;
      // Object property keys / member accesses that merely LOOK like
      // identifiers are excluded by ReferencedIdentifier already, but JSX
      // member expressions and labels need one more guard.
      if (p.parentPath?.isJSXAttribute?.()) return;
      found.push({ name, line: p.node.loc?.start.line ?? 0 });
    },
  });
  return found;
}

test('no client module references an identifier nothing declares', () => {
  const files = listFiles(SRC).filter((f) => !/\.test\.jsx?$/.test(f));
  assert.ok(files.length > 100, `expected to scan the client source tree, got ${files.length} files`);

  // Deduped: babel's ReferencedIdentifier alias can visit the same node through
  // more than one visitor key, and one name reported twice reads like two bugs.
  const problems = [...new Set(
    files.flatMap((file) =>
      undefinedIdentifiersIn(file).map(
        (hit) => `${path.relative(clientRoot, file).replace(/\\/g, '/')}:${hit.line}  ${hit.name}`,
      )),
  )].sort();

  assert.deepEqual(
    problems,
    [],
    'Undefined identifier(s) — these are runtime ReferenceErrors (white screen), '
    + 'invisible to `vite build`:\n  ' + problems.join('\n  '),
  );
});
