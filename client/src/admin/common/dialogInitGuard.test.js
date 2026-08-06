import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// THE "an open dialog is the operator's workspace" guard.
//
// GOS surfaces refetch in the background: realtime invalidation hints, stream
// recovery, the Tours midnight rollover, a sibling save's onRefresh. Every
// refetch hands its children a NEW entity object with the same id.
//
// A dialog that seeds its local state with
//
//     useEffect(() => { …setForm(fromEntity)… }, [open, deal]);
//
// therefore re-initialises itself on a refresh nobody asked for — blanking
// fetched sub-state, unmounting inline forms and retyping fields the operator
// is in the middle of filling. That was the production bug where switching
// browser tabs to copy a phone number made the open "צור איש קשר חדש" form
// vanish under the organization dialog.
//
// The rule: seed on IDENTITY (`[open, deal?.id]`), never on the object. Then
// only opening the dialog — or pointing it at a different record — rebuilds the
// buffer, and background truth flows through props/read paths instead.
//
// Related: lib/realtime.js only refetches on wake when the stream actually
// dropped, so simply returning to the tab no longer triggers a refresh at all.

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');

// Bare identifiers that name a business ENTITY object (not an id, not a
// callback). A dependency array holding `open` plus one of these is the smell.
const ENTITY_DEPS = new Set([
  'deal',
  'tour',
  'org',
  'organization',
  'contact',
  'person',
  'staff',
  'entry',
  'booking',
  'task',
  'offer',
  'quote',
  'product',
  'registration',
  'activity',
  'issue',
  'record',
  'row',
]);

// path (relative to src/, forward slashes) → why seeding on the object is safe
// there. This list may only SHRINK, and an entry needs a real reason.
const ALLOWLIST = new Map();

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

test('dialogs seed from a record IDENTITY, never from the refetched object', () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    if (ALLOWLIST.has(rel)) continue;
    const src = readFileSync(file, 'utf8');
    // Every effect/callback dependency array in the file.
    for (const m of src.matchAll(/\}\s*,\s*\[([^\]\n]*)\]\s*\)/g)) {
      const deps = m[1]
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      if (!deps.includes('open')) continue;
      const entity = deps.find((d) => ENTITY_DEPS.has(d));
      if (entity) offenders.push(`${rel} → [open, ${entity}]`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `A dialog re-seeds itself from a whole entity object. Depend on its id instead ` +
      `(e.g. \`[open, deal?.id]\`), so a background refetch cannot reset an open ` +
      `workspace:\n  ${offenders.join('\n  ')}`,
  );
});
