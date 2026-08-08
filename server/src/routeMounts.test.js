import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Route-shadowing guard.
//
// THE INCIDENT (2026-08-08): the standalone media galleries were mounted at
// '/api/media/galleries', but the legacy asset router already owned '/api/media'
// and declares GET '/:id'. Express matched the list request against that first,
// looked up a mediaAsset with id "galleries", found none, and answered
// 404 {"error":"not found"}.
//
// The failure was invisible in every obvious way: the row existed, the service
// returned it, POST/PATCH/DELETE on deeper paths all worked (they have two path
// segments and miss '/:id'), and only the bare LIST endpoint died — so the
// operator's gallery simply never appeared in the list.
//
// This test encodes the structural rule that prevents it: a mount path may not
// live UNDER another mount's path. Sibling paths ('/api/media-files',
// '/api/media-galleries') are unambiguous no matter what order they are
// registered in; nested ones depend on mount order and on what ':param' routes
// the parent happens to declare, which is exactly the kind of coupling that
// breaks silently later.

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'index.js'), 'utf8');

function mounts() {
  const out = [];
  const re = /app\.use\(\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(source))) {
    out.push({ path: m[1], line: source.slice(0, m.index).split('\n').length });
  }
  return out;
}

// '/api' is a bare middleware prefix (no-store headers etc.), not a router that
// can swallow a path — every API mount legitimately sits under it.
const BARE_PREFIXES = new Set(['/', '/api']);

test('no API route is registered under a mount that was registered BEFORE it', () => {
  const all = mounts();
  assert.ok(all.length > 50, 'sanity: found the mount list');

  // Direction matters, and it is the whole bug. Express tries mounts in
  // registration order:
  //   child BEFORE parent → the child wins; nesting is harmless.
  //   child AFTER parent  → the parent sees the request first and its
  //                         '/:param' routes can swallow it. This is what
  //                         happened to /api/media/galleries.
  // Only the second case is an error. (/api/whatsapp/staff-send is nested but
  // registered first, which is why it works and must keep that order.)
  const offenders = [];
  for (const child of all) {
    for (const parent of all) {
      if (parent === child) continue;
      if (BARE_PREFIXES.has(parent.path)) continue;
      if (child.path === parent.path) continue; // several routers may share a path
      if (child.path.startsWith(`${parent.path}/`) && child.line > parent.line) {
        offenders.push(
          `${child.path} (line ${child.line}) is registered AFTER ${parent.path} (line ${parent.line})`,
        );
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "A mount registered under an EARLIER mount can be swallowed by that parent's\n" +
      '/:param routes and will 404 in production while every deeper path works.\n' +
      'Use a SIBLING path (e.g. /api/media-galleries, not /api/media/galleries):\n  ' +
      offenders.join('\n  '),
  );
});

test('nested mounts that rely on registration order are known and deliberate', () => {
  // A nested mount registered BEFORE its parent is correct but ORDER-DEPENDENT:
  // moving it down the file would silently break it. Pinning the known set here
  // means adding another one is a conscious decision, not an accident.
  const all = mounts();
  const orderDependent = [];
  for (const child of all) {
    for (const parent of all) {
      if (parent === child || BARE_PREFIXES.has(parent.path)) continue;
      if (child.path === parent.path) continue;
      if (child.path.startsWith(`${parent.path}/`) && child.line < parent.line) {
        orderDependent.push(`${child.path} before ${parent.path}`);
      }
    }
  }
  assert.deepEqual(orderDependent, ['/api/whatsapp/staff-send before /api/whatsapp']);
});

test('the media galleries list is mounted where the legacy asset router cannot see it', () => {
  // The specific regression, asserted by name so a future "tidy-up" that moves
  // it back under /api/media fails here rather than in production.
  assert.ok(
    source.includes("app.use('/api/media-galleries'"),
    'media galleries must stay on the sibling path',
  );
  assert.ok(
    !source.includes("app.use('/api/media/galleries'"),
    "'/api/media/galleries' is shadowed by the legacy GET /api/media/:id route",
  );
});
