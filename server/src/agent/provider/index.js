// THE AI provider boundary.
//
// The rest of GOS asks for TASKS — analyzeConversation, proposeInsights — and
// never for a vendor SDK. Business logic must not know that Anthropic exists,
// so that swapping or adding a provider is one adapter file rather than a sweep
// through the application.
//
// Contract every adapter must honour:
//   • never throws a raw SDK error — always a coded Error
//       ai_not_configured | ai_timeout | ai_refused | ai_bad_output | ai_failed
//   • always returns { result, usage: { inputTokens, outputTokens }, model }
//   • never logs message text (same policy as the WhatsApp bridge)
//   • never receives secrets in its payload, and never returns them

import * as anthropic from './anthropic.js';

const ADAPTERS = { anthropic };

export function coded(code, detail) {
  const e = new Error(code);
  e.code = code;
  if (detail) e.detail = String(detail).slice(0, 400);
  return e;
}

function adapterFor(provider) {
  const a = ADAPTERS[provider || 'anthropic'];
  if (!a) throw coded('ai_not_configured', `unknown provider: ${provider}`);
  return a;
}

export function providerConfigured(provider = 'anthropic') {
  try {
    return adapterFor(provider).isConfigured();
  } catch {
    return false;
  }
}

/**
 * Classify one conversation turn and draft a reply.
 * @returns {{ result: object, usage: object, model: string, latencyMs: number }}
 */
export async function analyzeConversation(args, { provider = 'anthropic' } = {}) {
  const started = Date.now();
  const out = await adapterFor(provider).analyze(args);
  return { ...out, latencyMs: Date.now() - started };
}

/**
 * Derive PROPOSED insights from evidence. Deliberately a separate task: it runs
 * offline in batch, on a different cadence, and its output is never applied.
 */
export async function proposeInsights(args, { provider = 'anthropic' } = {}) {
  const started = Date.now();
  const out = await adapterFor(provider).insights(args);
  return { ...out, latencyMs: Date.now() - started };
}
