// Anthropic adapter — the ONLY file in the agent that knows a vendor SDK exists.
//
// Same discipline as communication/translate.js, which is the proven pattern in
// this repo: server-side key only (ANTHROPIC_API_KEY lives in Railway env and
// never reaches the client), structured outputs via output_config.format, and
// the model's output re-validated MECHANICALLY afterwards — a schema is a
// request, not a guarantee.
//
// Logging policy (strict, inherited from the WhatsApp bridge): never log
// message text, customer names, or draft content. Codes and counts only.

import Anthropic from '@anthropic-ai/sdk';
import { coded } from './index.js';
import { isKnownCapability } from '../capabilities/registry.js';

const DEFAULT_MODEL = 'claude-opus-5';
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 4000;

let _client = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) _client = new Anthropic({ timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });
  return _client;
}

export function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function parseJsonBlock(response) {
  if (response?.stop_reason === 'refusal') throw coded('ai_refused');
  const block = (response?.content || []).find((b) => b.type === 'text');
  if (!block?.text) throw coded('ai_bad_output', 'no text block');
  try {
    return JSON.parse(block.text);
  } catch {
    throw coded('ai_bad_output', 'not valid json');
  }
}

async function call({ system, user, schema, model, effort, providerClient }) {
  const c = providerClient || client();
  if (!c) throw coded('ai_not_configured');
  let response;
  try {
    response = await c.messages.create({
      model: model || DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      // Adaptive thinking with an explicit effort: the operator controls the
      // cost/quality trade-off from the settings screen, and the value is
      // recorded on the run so a quality change is attributable.
      thinking: { type: 'adaptive' },
      output_config: {
        effort: effort || 'medium',
        format: { type: 'json_schema', schema },
      },
      system,
      messages: [{ role: 'user', content: user }],
    });
  } catch (err) {
    if (err?.code) throw err;
    const status = err?.status;
    if (status === 429) throw coded('ai_failed', 'rate_limited');
    if (err?.name === 'APIConnectionTimeoutError') throw coded('ai_timeout');
    throw coded('ai_failed', err?.message);
  }
  return {
    parsed: parseJsonBlock(response),
    usage: {
      inputTokens: response?.usage?.input_tokens ?? null,
      outputTokens: response?.usage?.output_tokens ?? null,
    },
    model: response?.model || model || DEFAULT_MODEL,
  };
}

/**
 * Classify + draft. The schema is enforced by the API; everything below the
 * `call` is us refusing to trust it anyway.
 */
export async function analyze({ system, user, schema, model, effort, providerClient = null }) {
  const { parsed, usage, model: usedModel } = await call({
    system, user, schema, model, effort, providerClient,
  });

  // Mechanical validation. A model that returns an unknown capability key would
  // otherwise silently bypass the authority matrix — the classifier's output is
  // an INPUT to permissions, so it must be closed-set by construction.
  const capabilityKey = isKnownCapability(parsed?.capabilityKey) ? parsed.capabilityKey : 'other';
  const confidence = ['weak', 'moderate', 'strong'].includes(parsed?.confidence)
    ? parsed.confidence
    : 'weak';
  const reply = typeof parsed?.reply === 'string' ? parsed.reply.trim() : '';
  // An unrecognised category is by definition something we did not anticipate —
  // it escalates regardless of what the model claimed.
  const escalate = parsed?.escalate === true
    || capabilityKey === 'other'
    || !reply;

  return {
    result: {
      capabilityKey,
      confidence,
      escalate,
      escalationReason: String(parsed?.escalationReason || '').trim().slice(0, 400) || null,
      reply,
      usedKnowledgeIds: Array.isArray(parsed?.usedKnowledgeIds)
        ? parsed.usedKnowledgeIds.map(String).slice(0, 40) : [],
      usedPlaybookIds: Array.isArray(parsed?.usedPlaybookIds)
        ? parsed.usedPlaybookIds.map(String).slice(0, 40) : [],
    },
    usage,
    model: usedModel,
  };
}

/** Offline batch task: turn raw evidence into PROPOSED insights. */
export async function insights({ system, user, schema, model, effort, providerClient = null }) {
  const { parsed, usage, model: usedModel } = await call({
    system, user, schema, model, effort: effort || 'medium', providerClient,
  });
  const list = Array.isArray(parsed?.insights) ? parsed.insights : [];
  return {
    result: {
      insights: list
        .filter((i) => i && typeof i.title === 'string' && typeof i.proposedChange === 'string')
        .slice(0, 20)
        .map((i) => ({
          category: ['knowledge', 'playbook', 'style'].includes(i.category) ? i.category : 'playbook',
          title: String(i.title).trim().slice(0, 200),
          proposedChange: String(i.proposedChange).trim().slice(0, 2000),
          rationale: String(i.rationale || '').trim().slice(0, 1000) || null,
          evidenceProposalIds: Array.isArray(i.evidenceProposalIds)
            ? i.evidenceProposalIds.map(String).slice(0, 50) : [],
        })),
    },
    usage,
    model: usedModel,
  };
}
