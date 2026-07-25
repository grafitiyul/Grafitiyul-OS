// The shared DRY-RUN service — one pipeline behind preview, the simulator and
// test-send, built from exactly the modules the live engine/worker use
// (applicability, recipients, timing, windows, render). Nothing here writes:
// given a context (real loadTriggerContext output or a synthetic context of
// the same shape) it reports precisely what a real delivery would do and why.

import { prisma } from '../db.js';
import { evaluateApplicability } from './conditions.js';
import { resolveRecipients, resolveLanguage } from './recipients.js';
import { computeIntendedAt } from './timing.js';
import { loadWindowPolicy, evaluateAt, nextAllowedAt } from './windows.js';
import { renderMessage } from './render.js';
import { extractTokens, resolveVariables } from './variables.js';

/**
 * prepareMessageRun → {
 *   applicability, recipients, group, recipientError, sender, language,
 *   variables: [{key, value, missing}], rendered, timing, verdict
 * }
 * verdict.action: 'send' | 'wait_window' | 'wait_dependency' | 'skip' — with a
 * human Hebrew reason, matching the worker's actual policy.
 */
export async function prepareMessageRun({
  message, event, versionContent, ctx, language = null, now = Date.now(),
  // Injection seam for pure tests only — production always uses the canonical
  // DB-backed window-policy loader.
  policyLoader = loadWindowPolicy,
}) {
  const applicability = evaluateApplicability(event, ctx);
  const { recipients, group, error: recipientError } = await resolveRecipients(message, ctx);
  const recipient = recipients.find((r) => !r.missing) || recipients[0] || null;
  const lang = language === 'he' || language === 'en'
    ? language
    : resolveLanguage(message, recipient);

  const intendedMs = computeIntendedAt(event, ctx, now);
  const policy = await policyLoader(prisma, message);
  const gateAt = intendedMs != null ? Math.max(intendedMs, now) : now;
  const gate = intendedMs != null ? evaluateAt(policy, gateAt) : { allowed: false, reason: 'אין עוגן זמן — לסיור אין עדיין מועד' };
  const effectiveMs = intendedMs != null
    ? (gate.allowed ? gateAt : nextAllowedAt(policy, gateAt))
    : null;

  const rendered = await renderMessage({ message, versionContent, language: lang, ctx, missingLabels: true });

  // Per-variable resolution table (the simulator's "every variable and its
  // value" view) — same resolver, same context.
  const keys = new Set([
    ...extractTokens(versionContent?.he?.subject), ...extractTokens(versionContent?.he?.body),
    ...extractTokens(versionContent?.en?.subject), ...extractTokens(versionContent?.en?.body),
  ]);
  const { values, missing, unknown } = resolveVariables([...keys], ctx, lang);
  const variables = [...keys].map((key) => ({
    key,
    value: values[key] ?? null,
    missing: missing.includes(key),
    unknown: unknown.includes(key),
  }));

  // Verdict — mirrors deliveryWorker policy order: config/applicability →
  // recipient → dependencies (missing vars/docs/content) → window → send.
  let verdict;
  if (!applicability.applicable) {
    verdict = { action: 'skip', reason: 'האירוע לא חל על ההקשר הזה — תנאי הזמינות לא מתקיימים' };
  } else if (!recipients.length) {
    verdict = { action: 'skip', reason: recipientError || 'לא נמצא נמען עבור ההגדרה' };
  } else if (recipients.every((r) => r.missing)) {
    verdict = {
      action: 'skip',
      reason: message.channel === 'whatsapp' ? 'לנמען אין מספר טלפון' : 'לנמען אין כתובת אימייל',
    };
  } else if (rendered.error === 'no_content') {
    verdict = { action: 'wait_dependency', reason: 'אין תוכן בשפה המבוקשת' };
  } else if (intendedMs == null) {
    verdict = { action: 'wait_dependency', reason: 'ממתין לעוגן זמן (לסיור אין עדיין מועד)' };
  } else if (rendered.missingVariables.length || rendered.missingDocuments.length || rendered.unknownVariables.length) {
    verdict = {
      action: 'wait_dependency',
      reason: [
        ...rendered.missingVariables.map((k) => `משתנה חסר: ${k}`),
        ...rendered.missingDocuments.map((d) => d.reason || `מסמך חסר: ${d.kind}`),
        ...rendered.unknownVariables.map((k) => `משתנה לא מוכר: ${k}`),
      ].join(' · '),
    };
  } else if (!gate.allowed) {
    verdict = { action: 'wait_window', reason: gate.reason };
  } else {
    verdict = { action: 'send', reason: null };
  }

  return {
    applicability,
    recipients: recipients.map((r) => ({
      key: r.key, name: r.name, phone: r.phone || null, email: r.email || null,
      language: r.language, missing: !!r.missing,
    })),
    group,
    recipientError: recipientError || null,
    sender: message.channel === 'whatsapp'
      ? { waAccountId: message.waAccountId || null, destinationType: message.waDestinationType || 'private' }
      : { emailFrom: 'החשבון המחובר של הארגון' },
    language: lang,
    variables,
    rendered: {
      subject: rendered.subject || null,
      body: rendered.body || null,
      language: rendered.language || lang,
      attachments: rendered.attachments || [],
      links: rendered.links || [],
      missingVariables: rendered.missingVariables || [],
      unknownVariables: rendered.unknownVariables || [],
      missingDocuments: rendered.missingDocuments || [],
      error: rendered.error || null,
    },
    timing: {
      intendedAt: intendedMs != null ? new Date(intendedMs).toISOString() : null,
      effectiveAt: effectiveMs != null ? new Date(effectiveMs).toISOString() : null,
      windowReason: gate.allowed ? null : gate.reason,
    },
    verdict,
  };
}
