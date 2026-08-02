import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Every capability URL the SERVER mints must have a page on the CLIENT.
//
// The sibling guard (api.contract.test.js) catches an api.* method that does
// not exist. This catches the other half of the same class, and it is the one
// that actually shipped:
//
// On 2026-08-02 the server began minting /f/<token> links and sending them to
// guides in real WhatsApp messages. There was no `/f/:token` route in App.jsx,
// so React Router fell through to `<Route path="*">` → Navigate to "/". Three
// guides received working, correctly-authorized links that dropped them on the
// home page. Nothing failed: the server returned 200, the bundle built, every
// test passed, and the only symptom was a guide who could not do their job.
//
// A capability URL is a promise made to someone outside the building. This test
// asserts the promise can be kept.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', 'App.jsx');
const SERVER_SRC = path.resolve(HERE, '..', '..', '..', 'server', 'src');

// The public capability prefixes GOS hands out. Adding one here is deliberate:
// if you mint a new kind of link, you have to say who renders it.
const CAPABILITY_URLS = [
  { prefix: '/f/', route: '/f/:token', what: 'staff form (coordination / summary)' },
  { prefix: '/form/', route: '/form/:token', what: 'public customer form' },
  { prefix: '/quote/', route: '/quote/:token', what: 'customer quote' },
  { prefix: '/g/', route: '/g/:token', what: 'customer gallery' },
  { prefix: '/r/', route: '/r/:token', what: 'agent reservation' },
  { prefix: '/p/', route: '/p/:token', what: 'guide portal' },
];

const appSource = fs.readFileSync(APP, 'utf8');

test('every capability URL the server mints has a client route', () => {
  for (const { route, what } of CAPABILITY_URLS) {
    assert.ok(
      appSource.includes(`path="${route}"`),
      `no <Route path="${route}"> — ${what} links would land on the catch-all redirect`,
    );
  }
});

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * Every `${...}/x/` prefix built on OUR public origin.
 *
 * Scoped to files that use `publicOrigin()` — the canonical marker for a URL
 * that will be opened in a browser against app.grafitiyul.co.il. Without that
 * scope the scan also matches iCount's `/doc/`, Google Calendar's `/events/`,
 * WooCommerce's `/terms/` and the recruitment SPA's `/e/`, none of which this
 * router serves. A guard that cries wolf just teaches people to add exclusions.
 */
function mintedPrefixes(dir, out = new Set()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { mintedPrefixes(full, out); continue; }
    if (!entry.name.endsWith('.js') || entry.name.endsWith('.test.js')) continue;
    const src = stripComments(fs.readFileSync(full, 'utf8'));
    if (!src.includes('publicOrigin')) continue;
    for (const m of src.matchAll(/\$\{\s*\w+\s*\}(\/[a-z]{1,6}\/)/g)) out.add(m[1]);
  }
  return out;
}

test('the server mints no capability URL this test does not know about', () => {
  const known = new Set(CAPABILITY_URLS.map((c) => c.prefix));
  // A portal SUB-path: it is appended to an already-routed /p/<token> base, so
  // it is served by the portal's own nested route, not a top-level one.
  const subPaths = new Set(['/tour/']);
  const unknown = [...mintedPrefixes(SERVER_SRC)].filter((p) => !known.has(p) && !subPaths.has(p));
  assert.deepEqual(
    unknown, [],
    'a new capability URL shape appeared in the server. Add it to CAPABILITY_URLS '
    + 'with the route that renders it — or confirm it is not a browser URL.',
  );
});
