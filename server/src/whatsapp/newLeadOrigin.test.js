// ── ARCHITECTURAL INVARIANT: only genuine EXTERNAL lead intake auto-replies ──
//
// The automatic WhatsApp reply to a new lead must reach real strangers who just
// contacted the business — and nobody else. It must NEVER fire for a deal
// created manually in Admin, from the WhatsApp inbox, from the Email module, by
// duplication, by import/migration, by a repair or recovery script, by a
// Pipedrive mirror REPLAY, or by any Woo/payment/order flow.
//
// That distinction is NOT a flag on a record and NOT a heuristic over titles or
// names — either would be something a future code path could get wrong. It is
// defined structurally: exactly one fan-out function exists, and only genuine
// external intake paths call it.
//
// This guard scans the whole server source and fails when anything outside the
// allowlist reaches for that fan-out. Adding a new intake channel is a
// deliberate act: add its path below, with a reason.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // server/src

// THE approved external-intake call sites, and why each qualifies.
const ALLOWED_CALLERS = new Map([
  [
    'ingress/pipeline.js',
    'The shared ingress pipeline — website forms, Meta Lead Ads and every future '
    + "adapter. Fires only on outcome 'created_deal' of kind 'lead'.",
  ],
  [
    'mirror/creators.js',
    'The Pipedrive create-only lead bridge. Guarded by atomicCreate\'s alreadyExisted '
    + 'check, so a mirror REPLAY never fires; batch/cutover importers do not use it.',
  ],
]);

// The fan-out itself plus the module it delegates to — these define the event,
// they do not trigger it.
const DEFINITION_FILES = new Set([
  'adminReports/newLeadEvent.js',
  'whatsapp/newLeadAutoReply.js',
]);

function sourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      sourceFiles(full, acc);
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      acc.push(full);
    }
  }
  return acc;
}

const rel = (f) => path.relative(SRC, f).split(path.sep).join('/');

// Anything that reaches the automatic reply, directly or through the fan-out.
const TRIGGER_PATTERN = /\b(fireNewLeadReport|fireNewLeadAutoReply|sendNewLeadAutoReply)\b/;

test('new-lead auto-reply: only approved external intake paths can trigger it', () => {
  const offenders = [];
  for (const file of sourceFiles(SRC)) {
    const name = rel(file);
    if (DEFINITION_FILES.has(name) || ALLOWED_CALLERS.has(name)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (TRIGGER_PATTERN.test(text)) offenders.push(name);
  }

  assert.deepEqual(
    offenders,
    [],
    'These files can trigger the automatic new-lead reply but are not approved '
    + 'external intake paths:\n  ' + offenders.join('\n  ')
    + '\n\nA deal created manually, from WhatsApp/Email, by duplication, import, '
    + 'recovery or an order flow must NEVER auto-reply. If this really is a new '
    + 'external intake channel, add it to ALLOWED_CALLERS with a reason.',
  );
});

test('new-lead auto-reply: every approved caller still exists and still calls it', () => {
  for (const [name, why] of ALLOWED_CALLERS) {
    const file = path.join(SRC, name);
    assert.ok(fs.existsSync(file), `approved caller ${name} no longer exists (${why})`);
    assert.match(
      fs.readFileSync(file, 'utf8'),
      TRIGGER_PATTERN,
      `${name} is allowlisted as an external intake path but no longer triggers the `
      + 'new-lead event — remove it from ALLOWED_CALLERS or restore the call.',
    );
  }
});

// The specific paths the requirement named. Each creates Deals, and none of
// them may reach the auto-reply. Pinned by name so a future refactor that wires
// one of them up fails loudly here rather than in a customer's chat.
test('new-lead auto-reply: the named internal deal-creation paths never trigger it', () => {
  const MUST_NOT_TRIGGER = [
    'routes/deals.js', // manual creation in Admin
    'routes/whatsapp.js', // deal created from the WhatsApp inbox
    'routes/email.js', // deal created from the Email module
    'migration/import/dealImport.js', // migration/import
    'migration/import/cutoverImport.js', // cutover import
    'deals/paymentWon.js', // payment/order flows
  ];
  for (const name of MUST_NOT_TRIGGER) {
    const file = path.join(SRC, name);
    if (!fs.existsSync(file)) continue; // renamed/removed — the sweep above still covers it
    assert.doesNotMatch(
      fs.readFileSync(file, 'utf8'),
      TRIGGER_PATTERN,
      `${name} must never trigger the automatic new-lead reply`,
    );
  }
});
