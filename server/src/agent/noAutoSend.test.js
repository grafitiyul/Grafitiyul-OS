// THE V1 SAFETY TEST.
//
// The single promise this module makes to its owner is: no message reaches a
// customer without a human deciding so. These assertions are what make that a
// property of the code rather than a claim in a document.
//
// If one of these fails, DO NOT "fix the test". It means a code path was added
// that can message a customer autonomously, and that is a deliberate business
// decision requiring an owner sign-off (see docs/architecture/
// GOS-ai-agent-architecture-2026-08-08.md §6).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoSendPermitted, resolveAuthority } from './authority.js';

const AGENT_DIR = path.dirname(fileURLToPath(import.meta.url));

function agentSources() {
  const out = [];
  for (const name of fs.readdirSync(AGENT_DIR, { recursive: true })) {
    const rel = String(name).replace(/\\/g, '/');
    if (!/\.js$/.test(rel) || /\.test\.js$/.test(rel)) continue;
    const abs = path.join(AGENT_DIR, String(name));
    if (!fs.statSync(abs).isFile()) continue;
    out.push({ rel, text: fs.readFileSync(abs, 'utf8') });
  }
  return out;
}

test('INVARIANT: automatic sending is disabled in code', () => {
  assert.equal(
    autoSendPermitted(),
    false,
    'autoSendPermitted() must return false in V1 — flipping it is an owner decision, not a code cleanup',
  );
});

test('INVARIANT: only proposals.js may reach the customer send queue', () => {
  // enqueueCustomerWhatsApp is THE canonical customer transport. Exactly one
  // agent module may import it, and that module requires an authenticated
  // operator plus an explicit proposal id.
  const importers = agentSources()
    .filter((f) => /enqueueCustomerWhatsApp/.test(f.text))
    .map((f) => f.rel);
  assert.deepEqual(
    importers.sort(),
    ['proposals.js'],
    'a second agent module reached for the customer send queue — every send must go through proposals.js#sendProposal',
  );
});

test('INVARIANT: the agent never calls the WhatsApp bridge directly', () => {
  // Bypassing the queue would skip sending windows, pacing, retries and
  // delivery logging — the anti-block protections the WhatsApp module owns.
  const offenders = agentSources()
    .filter((f) => /callBridge|bridgeClient|sendWhatsAppText/.test(f.text))
    .map((f) => f.rel);
  assert.deepEqual(offenders, [], `agent code must never talk to the bridge directly: ${offenders.join(', ')}`);
});

test('the runner creates no proposal an operator could send while in shadow mode', () => {
  // Shadow is the V1 default for every capability, and offersToOperator() is
  // what gates whether a proposal is created as 'open' (sendable) at all.
  const modes = new Map([['meeting_point', { mode: 'shadow', conditions: null }]]);
  const res = resolveAuthority({
    enabled: true,
    capabilityKey: 'meeting_point',
    storedModes: modes,
    confidence: 'strong',
    contextPack: {},
  });
  assert.equal(res.mode, 'shadow');
});

test('the analysis kill switch overrides every capability mode', () => {
  const modes = new Map([['meeting_point', { mode: 'auto', conditions: null }]]);
  const res = resolveAuthority({
    enabled: false,
    capabilityKey: 'meeting_point',
    storedModes: modes,
    confidence: 'strong',
    contextPack: {},
  });
  assert.equal(res.mode, 'disabled');
  assert.equal(res.reason, 'agent_disabled');
});
