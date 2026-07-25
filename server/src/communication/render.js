// Rendering a message version for one (recipient, language, context) — used
// by preview, test-send and the live delivery worker (one path, no drift).

import { htmlToWhatsApp } from '../../../shared/waMarkup.mjs';
import { sanitizeEmailHtml } from '../email/sanitize.js';
import { extractTokens, resolveVariables, substituteTokens, substituteHtmlTokens } from './variables.js';
import { resolveDocument } from './documents.js';
import { publicOrigin } from './context.js';

export { publicOrigin };

const hasContent = (c) => !!(c && (String(c.body || '').trim() || String(c.subject || '').trim()));

/**
 * Pick the language content with the EXPLICIT fallback policy: requested
 * language when present, else the message's fallback language, else whichever
 * exists. Returns { lang, content } or null when the version has no content.
 */
export function contentForLanguage(versionContent, lang, fallbackLanguage = 'he') {
  const langs = [lang, fallbackLanguage, lang === 'he' ? 'en' : 'he'];
  for (const l of langs) {
    if (hasContent(versionContent?.[l])) return { lang: l, content: versionContent[l] };
  }
  return null;
}

/**
 * Render → {
 *   language, subject, body (email HTML / WhatsApp markup text),
 *   attachments: [resolved docs incl. mode], links: [doc links added],
 *   missingVariables, unknownVariables, missingDocuments
 * }
 * Never throws on missing data — reports it; the caller decides policy.
 *
 * `missingLabels: true` (preview/simulator display ONLY) replaces recognized-
 * but-missing tokens with a readable ⟨label — חסר⟩ marker instead of raw
 * moustache. Live sends never use it — the worker blocks on missing values
 * before anything ships.
 */
export async function renderMessage({ message, versionContent, language, ctx, missingLabels = false }) {
  const picked = contentForLanguage(versionContent, language, message.fallbackLanguage);
  if (!picked) {
    return { error: 'no_content', language, missingVariables: [], unknownVariables: [], attachments: [], links: [] };
  }
  const { lang, content } = picked;
  const origin = publicOrigin();

  // Variable resolution over subject + body together.
  const keys = new Set([...extractTokens(content.subject), ...extractTokens(content.body)]);
  const { values, missing, unknown } = resolveVariables([...keys], ctx, lang);

  // Documents (typed tokens — resolved to the canonical stored artifacts).
  const tokens = Array.isArray(versionContent?.attachments) ? versionContent.attachments : [];
  const attachments = [];
  const links = [];
  const missingDocuments = [];
  for (const token of tokens) {
    const resolved = await resolveDocument(token, ctx, origin);
    const mode = token.mode || 'attach';
    if (!resolved.exists) {
      missingDocuments.push({ ...resolved, mode });
      continue;
    }
    if (mode === 'attach' || mode === 'both') attachments.push({ ...resolved, mode });
    if ((mode === 'link' || mode === 'both') && resolved.url) links.push({ ...resolved, mode });
  }

  const subOpts = missingLabels ? { missingLabels: true } : undefined;

  if (message.channel === 'whatsapp') {
    // HTML → WhatsApp markup (chips become {{key}}), then token substitution.
    let text = substituteTokens(htmlToWhatsApp(content.body || ''), values, subOpts);
    for (const link of links) {
      text = `${text}\n\n${link.kind === 'quote_document' ? `הצעת המחיר: ${link.url}` : link.url}`;
    }
    return {
      language: lang, subject: null, body: text.trim(),
      attachments, links,
      missingVariables: missing, unknownVariables: unknown, missingDocuments,
    };
  }

  // Email: subject is plain text with tokens; body is sanitized rich HTML.
  const subject = substituteTokens(String(content.subject || ''), values, subOpts).trim();
  let bodyHtml = substituteHtmlTokens(String(content.body || ''), values, subOpts);
  for (const link of links) {
    const label = link.kind === 'quote_document' ? 'לצפייה בהצעת המחיר' : 'להורדת המסמך';
    bodyHtml += `<p style="margin:16px 0"><a href="${link.url}" target="_blank" rel="noopener" `
      + `style="display:inline-block;background:#2563eb;color:#ffffff;padding:10px 22px;border-radius:8px;`
      + `text-decoration:none;font-weight:600">${label}</a></p>`;
  }
  bodyHtml = sanitizeEmailHtml(bodyHtml);
  return {
    language: lang, subject, body: bodyHtml,
    attachments, links,
    missingVariables: missing, unknownVariables: unknown, missingDocuments,
  };
}
