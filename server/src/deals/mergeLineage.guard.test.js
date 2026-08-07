// The retired-deal EXCLUSION guard.
//
// A merge is only safe if a retired deal disappears from every surface that
// means "the deals we are working on". That is not one change — it is a rule
// spread across ~25 query sites, and a rule spread across 25 sites is a rule
// that will be broken by the next feature that adds the 26th.
//
// So this test scans the source for deal COLLECTION queries (findMany / count /
// groupBy / aggregate) and fails on any that neither carries the exclusion nor
// appears in the allowlist below with a reason. The same enforcement shape as
// dealTitleGuard.test.js, which already keeps a harder invariant honest.
//
// Adding a new deal query is therefore a deliberate act: either use
// activeDealWhere()/ACTIVE_DEAL_FILTER, or say here why history belongs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every collection read of Deal. A findUnique/findFirst by id is NOT here: a
// retired deal must still be readable by id — that is the whole point of
// retiring rather than deleting.
// The receiver is deliberately unconstrained: production code reaches the model
// as `prisma.deal`, `db.deal`, `tx.deal` and `(db || prisma).deal`, and a
// pattern that lists receivers is a pattern the next call style slips past.
// A fresh RegExp per scan — a shared /g literal carries lastIndex between uses
// and would silently skip matches.
const queryRe = () => /\.deal\.(?:findMany|count|groupBy|aggregate)\b/g;

// Files whose deal queries deliberately INCLUDE retired deals. Each entry is a
// reason, not a mute button: it is the documented answer to "why does this
// surface still show a merged-away deal?".
const ALLOWLIST = new Map([
  ['deals/mergeLineage.js', 'IS the lineage walk — it exists to find retired deals'],
  ['timeline/lineageFeed.js', 'resolves the merged history; reads the lineage by id'],
  ['control/detectors/dealMergeIntegrity.js', 'detects broken merges — must see retired deals'],
  ['search/providers/deals.js', 'a retired deal MUST stay findable by its old order number; the row says it was merged and links to the survivor'],
  ['search/providers/timeline.js', 'historical note/timeline search — history is not hidden'],
  ['routes/timeline.js', 'the contact/organization history aggregate; a past deal is history'],
  ['routes/adminReports.js', 'hydrates names for ids an already-built report references'],
  ['routes/communication.js', 'hydrates names for ids a delivery already references (the deal PICKER in the same file is guarded)'],
  ['collection.js', 'the guarded queries live here; loadEvidence reads by explicit lineage ids'],
  ['collectionBackfillRunner.js', 'one-off historical backfill over all deals ever'],
  ['collectionMatcherRunner.js', 'one-off historical evidence matcher over all deals ever'],
  ['maintenance/classifyCollectionWorkQueue.js', 'one-off maintenance classification over history'],
  ['maintenance/unlockUnpaidMigratedBuilders.js', 'one-off migration repair over history'],
  ['mirror/sources/airtableTourChildDeps.js', 'legacy mirror source; reads by explicit legacy ids'],
  ['routes/products.js', 'catalog DELETE guard — a retired deal still references the product, and deleting it would still null that reference'],
  ['crm/dealResolution.js', 'guarded (activeDealWhere) — listed because the file also reads by explicit ids'],
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.js') && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

// The exclusion may be expressed three ways, all canonical.
const GUARDED = /activeDealWhere\s*\(|ACTIVE_DEAL_FILTER|mergedIntoDealId:\s*null/;

// Guarding is frequently INDIRECT, and correctly so: the real rule for "which
// WON deals still owe a tour" lives in ONE shared where-builder
// (liveWonObligationWhere), and the deals list shares one filter builder across
// its list, count and summary queries. Duplicating the exclusion at each call
// site to satisfy a scanner would be worse code.
//
// So the scan first learns which where-BUILDERS are themselves guarded, across
// the whole tree, and then accepts a query that uses one.
function guardedBuilderNames(files) {
  const names = new Set();
  // `function name(...) { … }` and `const name = (…) => { … }` / `= {`
  const DECL = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(|(?:export\s+)?const\s+(\w+)\s*=\s*(?:\(|\{|async)/g;
  for (const { source } of files) {
    DECL.lastIndex = 0;
    let d;
    while ((d = DECL.exec(source)) !== null) {
      const name = d[1] || d[2];
      if (!name) continue;
      // The declaration's body, bounded — long enough for a where-builder,
      // short enough not to swallow the next function.
      const body = source.slice(d.index, d.index + 1400);
      if (GUARDED.test(body)) names.add(name);
    }
  }
  return names;
}

/**
 * Local variables in ONE file that hold the result of a guarded builder —
 * `const where = dealFilterWhere(req.query)`. The deals list assigns once and
 * then passes `{ where }` to a count and a findMany many lines later, which no
 * proximity window can honestly cover.
 */
function guardedVarNames(source, builders) {
  const names = new Set();
  const ASSIGN = /(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\s*\(/g;
  let m;
  while ((m = ASSIGN.exec(source)) !== null) {
    if (builders.has(m[2])) names.add(m[1]);
  }
  return names;
}

// The window around a query in which a DIRECT guard must appear. Deliberately
// tight: a wide window would let an unrelated guarded query a few lines away
// launder an unguarded one.
function isGuarded(source, index, builders = new Set(), vars = new Set()) {
  const window = source.slice(Math.max(0, index - 400), Math.min(source.length, index + 400));
  if (GUARDED.test(window)) return true;
  // A query that is ABOUT retired deals, marked at the call site rather than by
  // allowlisting its whole file — which would blind the guard to every other
  // query in it. Deliberately per-line and self-documenting.
  const before = source.slice(Math.max(0, index - 200), index);
  if (/merge-lineage-query:/.test(before)) return true;
  const after = source.slice(index, index + 300);
  // `where: someGuardedBuilder(...)`
  for (const name of builders) {
    if (new RegExp(`where:\\s*(?:\\.\\.\\.)?${name}\\s*\\(`).test(after)) return true;
  }
  // `where: whereVar` or the `{ where, orderBy }` shorthand.
  for (const name of vars) {
    if (new RegExp(`where:\\s*${name}\\b`).test(after)) return true;
    if (name === 'where' && /\{\s*where\s*[,}]/.test(after)) return true;
  }
  return false;
}

function loadTree() {
  return walk(SRC).map((file) => ({
    rel: path.relative(SRC, file).split(path.sep).join('/'),
    source: readFileSync(file, 'utf8'),
  }));
}

test('every Deal collection query either excludes retired deals or is allowlisted', () => {
  const files = loadTree();
  const builders = guardedBuilderNames(files);
  const offenders = [];
  for (const { rel, source } of files) {
    if (ALLOWLIST.has(rel)) continue;
    const vars = guardedVarNames(source, builders);
    const re = queryRe();
    let m;
    while ((m = re.exec(source)) !== null) {
      if (isGuarded(source, m.index, builders, vars)) continue;
      const line = source.slice(0, m.index).split('\n').length;
      offenders.push(`${rel}:${line} — ${m[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'Unguarded Deal queries. Use activeDealWhere({...}) so a deal retired by a merge '
    + 'cannot appear as an active deal — or add the file to ALLOWLIST in this test '
    + 'with the reason history belongs there.\n' + offenders.join('\n'),
  );
});

test('the allowlist only names files that still exist and still query deals', () => {
  const stale = [];
  for (const rel of ALLOWLIST.keys()) {
    const full = path.join(SRC, rel);
    let source;
    try {
      source = readFileSync(full, 'utf8');
    } catch {
      stale.push(`${rel} — file no longer exists`);
      continue;
    }
    if (!queryRe().test(source)) stale.push(`${rel} — no deal collection query left`);
  }
  assert.deepEqual(stale, [], 'The allowlist only ever grows with a reason; dead entries hide the next real one.');
});

test('the guard would actually catch an unguarded query', () => {
  // Proving the scanner works, not just that it passes: a rule nobody has seen
  // fail is a rule nobody knows is enforced.
  const sample = 'const rows = await prisma.deal.findMany({ where: { status: "open" } });';
  assert.match(sample, queryRe(), 'the pattern matches a plain deal query');
  assert.equal(isGuarded(sample, sample.indexOf('prisma.deal')), false);
  const guarded = 'const rows = await prisma.deal.findMany({ where: activeDealWhere({ status: "open" }) });';
  assert.equal(isGuarded(guarded, guarded.indexOf('prisma.deal')), true);
});

test('a shared where-builder counts as a guard only when it really carries one', () => {
  const good = [{ source: 'function liveWhere() { return { ...ACTIVE_DEAL_FILTER, status: "won" }; }' }];
  assert.ok(guardedBuilderNames(good).has('liveWhere'));
  const bad = [{ source: 'function plainWhere() { return { status: "won" }; }' }];
  assert.ok(!guardedBuilderNames(bad).has('plainWhere'), 'an unguarded builder never launders a query');
});
