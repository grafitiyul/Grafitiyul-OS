// ── ARCHITECTURAL INVARIANT: Deal.title is INTERNAL-ONLY ─────────────────────
//
// Deal.title is internal CRM wording ("ליד חדש - …", pipeline labels). It must
// never appear on a customer-facing surface. The ONE approved exception is the
// explicit {{deal_title}} communication variable — a deliberate operator
// choice, labeled as the internal deal name.
//
// This guard scans the SOURCE of every customer-facing renderer and fails the
// suite when a `deal.title` / `deal?.title` reference appears outside the
// allowlist. It exists because the Gallery incident (2026-08-03) was exactly
// this: a "harmless" display fallback that shipped internal wording to a
// customer page. Canonical resolution instead: organization → contact →
// product → the generic wording in src/displayFallbacks.js.
//
// Adding a NEW customer-facing module? Add its path to CUSTOMER_FACING below.
// Hitting a failure here? Resolve from canonical sources — do not extend the
// allowlist without an explicit owner decision.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url)); // server/src
const REPO = path.resolve(SRC, '..', '..');

// Customer-facing renderers: files/dirs whose output reaches customers —
// public capability-URL pages, outbound messages/emails, payment/document
// content. Staff-authenticated surfaces (admin, guide portal) are NOT listed.
const CUSTOMER_FACING = [
  // Tour gallery — public /g/:token page (the original incident).
  'server/src/tours/gallery',
  'server/src/routes/publicGallery.js',
  // Confirmation email — customer-facing מייל אישור composition.
  'server/src/confirmation',
  // Communication Center — templates render into customer WhatsApp/email.
  'server/src/communication/variables.js',
  'server/src/communication/context.js',
  'server/src/communication/format.js',
  // Coordination — context block + follow-up messages.
  'server/src/questionnaires/contextCatalog.js',
  'server/src/questionnaires/coordinationContext.js',
  'server/src/questionnaires/coordinationFollowup.js',
  // Payment + iCount documents — page descriptions and invoice lines.
  'server/src/dealPayment.js',
  'server/src/icountDocs.js',
  'server/src/routes/pay.js',
  'server/src/routes/payment.js',
  // Customer capability links (public link context for messages).
  'server/src/publicLinks.js',
  // Tour-change impact — the affected-customers list Part 4 ("עדכן לקוחות")
  // will feed into customer notifications; guarded BEFORE it goes customer-facing.
  'server/src/tours/changeImpact.js',
  // סוכן AI — the agent DRAFTS customer-facing WhatsApp text. Its Context Pack
  // must never carry Deal.title, or the internal deal name leaks into a message.
  // A source scan is the weaker half of the guarantee here (agent/runner.js
  // reads the title deliberately, to feed the runtime guard that DETECTS a
  // leak); the strong half is agent/contextPack.noTitle.test.js, which asserts
  // on the built pack itself rather than on how the code is spelled.
  'server/src/agent',
  // Agent reservations — public /r/:token form + document composition.
  'server/src/reservations',
  // Quote — customer-facing quote documents.
  'server/src/quote',
  // Client-side public customer pages.
  'client/src/gallery',
];

// Approved occurrences. Each entry must keep matching EXACTLY ONE line; if the
// code moves or multiplies, the guard fails and forces a conscious decision.
const ALLOWLIST = [
  {
    file: 'server/src/communication/variables.js',
    // The explicit {{deal_title}} variable — the resolver line sits directly
    // under its `key: 'deal_title'` declaration.
    allow: (line, prevLines) =>
      line.includes('ctx.deal?.title') && prevLines.some((p) => p.includes("key: 'deal_title'")),
    reason: 'explicit operator-chosen {{deal_title}} variable',
  },
  {
    file: 'server/src/icountDocs.js',
    // Admin-facing "document linked elsewhere" warning payload in the הפק
    // מסמך modal — never rendered to a customer.
    allow: (line) => line.includes('linkedElsewhere'),
    reason: 'admin-only linkedElsewhere warning payload',
  },
];

const TITLE_REF = /\bdeal\??\.title\b|\bdeal\s*\?\.\s*title\b/;

function* sourceFiles(entry) {
  const abs = path.join(REPO, entry);
  const stat = fs.statSync(abs, { throwIfNoEntry: false });
  if (!stat) return; // a listed path may not exist yet in every checkout
  if (stat.isFile()) {
    yield { abs, rel: entry };
    return;
  }
  for (const name of fs.readdirSync(abs, { recursive: true })) {
    const rel = String(name).replace(/\\/g, '/');
    const file = path.join(abs, String(name));
    if (!fs.statSync(file).isFile()) continue;
    if (!/\.(js|jsx|mjs)$/.test(rel)) continue;
    if (/\.test\.(js|jsx|mjs)$/.test(rel)) continue; // tests may quote the pattern
    yield { abs: file, rel: `${entry}/${rel}` };
  }
}

test('INVARIANT: no customer-facing renderer references Deal.title (allowlist: {{deal_title}} only)', () => {
  const violations = [];
  const allowUsed = new Map(ALLOWLIST.map((a) => [a, 0]));

  for (const entry of CUSTOMER_FACING) {
    for (const { abs, rel } of sourceFiles(entry)) {
      const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!TITLE_REF.test(line)) return;
        const rule = ALLOWLIST.find(
          (a) => rel.startsWith(a.file) && a.allow(line, lines.slice(Math.max(0, i - 4), i)),
        );
        if (rule) {
          allowUsed.set(rule, allowUsed.get(rule) + 1);
          return;
        }
        violations.push(`${rel}:${i + 1} → ${line.trim()}`);
      });
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Deal.title is INTERNAL-ONLY. Customer-facing code must resolve organization → contact → product → displayFallbacks.js generics.\n${violations.join('\n')}`,
  );

  // Every allowlist entry must still match exactly once — a vanished or
  // duplicated match means the code changed shape and needs re-review.
  for (const [rule, count] of allowUsed) {
    assert.equal(
      count,
      1,
      `allowlist entry "${rule.reason}" matched ${count} times (expected exactly 1) — re-review ${rule.file}`,
    );
  }
});

// The registry-level contract, independent of source formatting: resolving the
// variables of a lead-titled deal must not leak the title through anything
// except the explicit {{deal_title}} key.
test('INVARIANT: only {{deal_title}} resolves to Deal.title for a lead-titled deal', async () => {
  const { VARIABLES } = await import('./communication/variables.js');
  const ctx = {
    deal: { title: 'ליד חדש - לילי', groupName: null, product: null, orderNo: 27001 },
    contact: null, org: null, tour: null, links: {}, payment: null,
  };
  for (const v of VARIABLES) {
    let value = null;
    try { value = v.resolve(ctx, 'he', {}); } catch { value = null; }
    if (v.key === 'deal_title') {
      assert.equal(value, 'ליד חדש - לילי', 'the explicit variable still works');
    } else {
      assert.ok(
        !String(value ?? '').includes('ליד חדש'),
        `variable "${v.key}" leaked Deal.title: ${value}`,
      );
    }
  }
});
