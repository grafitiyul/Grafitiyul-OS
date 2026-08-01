import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// EVERY api.* call site must resolve to a real function on the client.
//
// `api` is a NAMESPACED object (api.whatsapp.sendMessage, api.deals.get …) with
// no generic api.get/post/put. Nothing in the toolchain catches a call to a
// method that does not exist: it is a plain property access, so the bundle
// builds, the unit tests pass, and it throws "api.get is not a function" the
// first time the module runs — in the browser, on the live site.
//
// That is exactly what happened on 2026-08-01: senderAccount.js shipped
// `api.get('/api/whatsapp/connected-accounts')`, which threw while the admin
// shell was loading and took the ENTIRE frontend down (white screen on every
// admin route, not just WhatsApp). This test is the guard that makes that class
// of outage impossible to ship again.
//
// It walks the real source files, extracts every `api.<path>(` expression, and
// asserts the path exists on the real exported object.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');

const { api } = await import('./api.js');

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(js|jsx)$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

// `api` followed by one or more `.member` hops and then a call. Whitespace and
// newlines are allowed between hops — the outage shipped as `api\n  .get(...)`,
// which a line-oriented search does not see.
const CALL = /\bapi(?:\s*\.\s*[A-Za-z_$][\w$]*)+\s*\(/g;
const HOP = /\.\s*([A-Za-z_$][\w$]*)/g;

// Call sites that legitimately reach a NON-function member, or that shadow the
// name locally. Keep this list empty unless there is a real reason.
const IGNORE_FILES = new Set();

// Comments discuss api.* freely (this file's own header does). Scan CODE only.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('every api.* call site resolves to a function on the exported client', () => {
  const failures = [];
  for (const file of sourceFiles(SRC)) {
    if (IGNORE_FILES.has(path.relative(SRC, file))) continue;
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    // Only files that import the shared client — `api` is a common local name.
    if (!/from\s+['"][^'"]*lib\/api\.js['"]/.test(text)) continue;
    for (const match of text.match(CALL) || []) {
      const hops = [...match.matchAll(HOP)].map((m) => m[1]);
      let node = api;
      const walked = [];
      for (const hop of hops) {
        walked.push(hop);
        node = node == null ? undefined : node[hop];
        if (node === undefined) break;
      }
      if (typeof node !== 'function') {
        failures.push(
          `${path.relative(SRC, file)} → api.${hops.join('.')}() — ${
            node === undefined ? `api.${walked.join('.')} does not exist` : `not a function (${typeof node})`
          }`,
        );
      }
    }
  }
  assert.deepEqual(failures, [], `unresolvable api call sites:\n  ${failures.join('\n  ')}`);
});

test('the client exposes no generic verb helpers (namespaced by design)', () => {
  for (const verb of ['get', 'post', 'put', 'patch', 'del', 'delete']) {
    assert.equal(
      typeof api[verb],
      'undefined',
      `api.${verb} exists — either the client gained generic verbs (update this test and the guard above) or a namespace was flattened by accident`,
    );
  }
});
