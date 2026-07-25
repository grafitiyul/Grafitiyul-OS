// AI-assisted Hebrew → English translation for communication messages.
//
// Server-side only (ANTHROPIC_API_KEY lives in Railway env — never the
// client). Output is ALWAYS a draft: the route marks enState='ai_draft' and
// nothing auto-publishes. Token preservation is verified mechanically after
// the call — a translation that loses or invents {{variables}} or chip spans
// is rejected here rather than surfaced as broken content.

import Anthropic from '@anthropic-ai/sdk';
import { extractTokens, variableByKey } from './variables.js';
import { normalizeTokensToChips } from '../../../shared/variableTokens.mjs';

const MODEL = 'claude-opus-4-8';

let _client = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) _client = new Anthropic();
  return _client;
}

export function translationConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const TONE_HINTS = {
  service: 'warm, service-oriented customer communication',
  sales: 'friendly commercial/sales communication',
  operational: 'clear, practical operational instructions',
  formal: 'formal business communication',
  internal: 'internal team communication, direct and brief',
};

const SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'Translated subject line (empty string when no subject was provided)' },
    body: { type: 'string', description: 'Translated body, same format as the input (HTML stays HTML with identical tags/attributes; plain text stays plain text)' },
  },
  required: ['subject', 'body'],
  additionalProperties: false,
};

function coded(code, detail) {
  const e = new Error(code);
  e.code = code;
  if (detail) e.detail = detail;
  return e;
}

/**
 * Translate { subject?, body } Hebrew content to natural English.
 * `channel` is 'whatsapp' | 'email'; `tone` an optional TONE_HINTS key.
 * `providerClient` is injectable for tests — production uses the env-keyed
 * SDK client. Throws coded errors: translation_not_configured |
 * translation_failed | translation_tokens_changed (with drift detail).
 * The returned body is normalized so recognized variables come back as
 * canonical chip nodes even if the model emitted raw {{tokens}}.
 */
export async function translateContent({ subject = '', body = '', channel, tone = null, providerClient = null }) {
  const c = providerClient || client();
  if (!c) throw coded('translation_not_configured');

  const toneHint = TONE_HINTS[tone] || TONE_HINTS.service;
  const system = [
    'You translate Hebrew customer/team communications into natural, fluent English for an Israeli tour company (Grafitiyul — graffiti and street-art tours).',
    'Rules:',
    '- Translate meaning and tone naturally; NEVER literally word-for-word.',
    `- Register: ${toneHint}.`,
    '- Preserve EVERY {{variable_token}} exactly as-is, in the position that makes sense in the English sentence. Never translate, rename, remove, or invent tokens.',
    '- If the body is HTML: keep the exact same tags and attributes (including <span data-type="dynamic-field" data-field-key="..."> chips — copy them byte-identical, do not translate their inner label text). Only translate human-readable text.',
    '- Preserve links, paragraph structure, line breaks, lists and formatting.',
    '- Keep emojis.',
    '- Do not add content that is not in the source.',
  ].join('\n');

  let result;
  try {
    const response = await c.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: `Channel: ${channel === 'whatsapp' ? 'WhatsApp message' : 'Email'}.\n\nSubject (Hebrew, may be empty):\n${subject || '(none)'}\n\nBody (Hebrew):\n${body}`,
      }],
    });
    if (response.stop_reason === 'refusal') throw coded('translation_failed', 'refused');
    const block = response.content.find((b) => b.type === 'text');
    result = JSON.parse(block?.text || '{}');
  } catch (err) {
    if (err?.code) throw err;
    throw coded('translation_failed', String(err?.message || err).slice(0, 200));
  }

  // Mechanical token-preservation check — variables must survive exactly.
  const before = new Set([...extractTokens(subject), ...extractTokens(body)]);
  const after = new Set([...extractTokens(result.subject), ...extractTokens(result.body)]);
  const lost = [...before].filter((k) => !after.has(k));
  const invented = [...after].filter((k) => !before.has(k));
  if (lost.length || invented.length) {
    throw coded('translation_tokens_changed', { lost, invented });
  }

  // Canonicalize: recognized raw {{tokens}} in the translated body become chip
  // nodes (the ONE storage representation); unknown tokens stay visible as-is.
  const normalizedBody = normalizeTokensToChips(
    result.body || '',
    (key) => variableByKey(key)?.labelHe || null,
  );
  return { subject: result.subject || '', body: normalizedBody };
}
