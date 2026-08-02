// THE sending-window policy resolver — "זמני שליחה".
//
// This module answers ONE question: which window governs this message?
// It does NOT evaluate windows. communication/windows.js remains the single
// DST-correct evaluator, and every sender calls it through here so there is
// exactly one implementation of "when may this go out".
//
// ── Why this exists ──────────────────────────────────────────────────────────
// Windows were built for the Communication Center and keyed per message. Three
// other senders (scheduled WhatsApp, scheduled email, admin reports) ignored
// them entirely, which meant an overnight provider outage could dump a backlog
// at 03:00. Re-keying by (audience × channel) makes one policy cover every
// sender without duplicating a single line of scheduling logic.
//
// ── Precedence ───────────────────────────────────────────────────────────────
//   1. An explicit PER-MESSAGE window (Communication Center) always wins. An
//      operator who deliberately chose a window for one message must not have
//      it silently overridden by a global default.
//   2. Otherwise the (audienceKind × channel) policy applies.
//   3. No policy row, or a disabled one ⇒ no window: send at the computed time.
//      Global block exceptions still apply in every case — safety wins, and
//      that rule lives in windows.js where it always has.

import { prisma } from '../db.js';
import { evaluateAt, nextAllowedAt } from './windows.js';

export const AUDIENCE_KINDS = ['customer', 'guide', 'manager'];
export const POLICY_CHANNELS = ['whatsapp', 'email'];

export const AUDIENCE_KIND_LABELS_HE = {
  customer: 'לקוחות',
  guide: 'צוות ומדריכים',
  manager: 'מנהלים',
};

/**
 * Communication Center audience type → who is actually on the receiving end.
 * Staff and group destinations are internal, so they follow the manager policy;
 * assigned guides follow the guide policy even though both are "not customers".
 */
export function audienceKindFromCommunication(audienceType) {
  switch (audienceType) {
    case 'assigned_guides': return 'guide';
    case 'explicit_staff':
    case 'wa_group': return 'manager';
    default: return 'customer'; // primary_contact | field_contact | explicit_contact
  }
}

/**
 * Scheduled WhatsApp rows: a staff send carries a personRefId (the Team-tab
 * bulk send), everything else is a CRM message to a customer.
 */
export function audienceKindFromScheduledMessage(row) {
  return row?.personRefId ? 'guide' : 'customer';
}

/**
 * Admin reports: a guide-audience report addresses one guide, a
 * customer-audience one addresses a customer, everything else is internal.
 *
 * Customer reports never reach this resolver at send time — they are handed to
 * the WhatsApp queue, which resolves the SAME 'customer' policy from the row
 * itself. Both paths therefore agree by construction rather than by agreement.
 */
export function audienceKindFromReport(report) {
  if (report?.audience === 'guides') return 'guide';
  if (report?.audience === 'customer') return 'customer';
  return 'manager';
}

/**
 * Resolve the window policy for one send.
 *
 * `messageOverride` is the Communication Center's per-message choice:
 *   { windowEnabled, sendingWindowId } — when windowEnabled is true it wins.
 *
 * Returns the exact policy shape windows.js consumes:
 *   { windowEnabled, window: {id,name,rules} | null, exceptions: [...] }
 * plus `source` so the queue UI can explain WHICH policy decided.
 */
export async function resolveSendPolicy(
  { audienceKind, channel, messageOverride = null },
  { db = prisma } = {},
) {
  // Exceptions are global to the system (a Yom Kippur block applies to
  // everything), so they are loaded once regardless of which policy wins.
  const exceptions = await db.communicationWindowException.findMany({ where: { active: true } });

  // 1. Explicit per-message choice.
  if (messageOverride?.windowEnabled && messageOverride.sendingWindowId) {
    const window = await db.communicationSendingWindow.findUnique({
      where: { id: messageOverride.sendingWindowId },
    });
    return {
      windowEnabled: true,
      window: window ? { id: window.id, name: window.name, rules: window.rules || [] } : null,
      exceptions,
      source: 'message',
      sourceHe: 'חלון שנבחר במסר עצמו',
    };
  }

  // 2. The audience × channel matrix.
  if (audienceKind && channel) {
    const policy = await db.sendingWindowPolicy.findUnique({
      where: { audienceKind_channel: { audienceKind, channel } },
      include: { window: true },
    });
    if (policy?.enabled) {
      return {
        windowEnabled: true,
        window: policy.window
          ? { id: policy.window.id, name: policy.window.name, rules: policy.window.rules || [] }
          : null,
        exceptions,
        source: 'policy',
        sourceHe: `זמני שליחה — ${AUDIENCE_KIND_LABELS_HE[audienceKind] || audienceKind} · ${channel === 'email' ? 'אימייל' : 'WhatsApp'}`,
      };
    }
  }

  // 3. No window. Global blocks still apply (windows.js enforces that).
  return { windowEnabled: false, window: null, exceptions, source: 'none', sourceHe: null };
}

/**
 * The one call every sender makes right before sending.
 *
 * Returns { allowed, reason, nextAt, policySource }:
 *   allowed   — send now
 *   nextAt    — when it WILL be allowed (null = not within the scan horizon)
 *   reason    — Hebrew, shown verbatim in the queue as the wait reason
 *
 * A message is never dropped for being outside a window; it waits. That is the
 * whole point: an overnight backlog releases at the next legitimate opening
 * instead of at 03:00 or not at all.
 */
export async function checkSendAllowed(
  { audienceKind, channel, messageOverride = null, atMs = Date.now() },
  { db = prisma } = {},
) {
  const policy = await resolveSendPolicy({ audienceKind, channel, messageOverride }, { db });
  const verdict = evaluateAt(policy, atMs);
  if (verdict.allowed) {
    return { allowed: true, reason: null, nextAt: null, policySource: policy.source };
  }
  const next = nextAllowedAt(policy, atMs);
  return {
    allowed: false,
    reason: verdict.reason,
    nextAt: next,
    policySource: policy.source,
  };
}

/** The full 3×2 matrix for the settings screen, including unconfigured cells. */
export async function policyMatrix({ db = prisma } = {}) {
  const rows = await db.sendingWindowPolicy.findMany({ include: { window: true } });
  const byKey = new Map(rows.map((r) => [`${r.audienceKind}:${r.channel}`, r]));
  const out = [];
  for (const audienceKind of AUDIENCE_KINDS) {
    for (const channel of POLICY_CHANNELS) {
      const row = byKey.get(`${audienceKind}:${channel}`);
      out.push({
        audienceKind,
        audienceLabelHe: AUDIENCE_KIND_LABELS_HE[audienceKind],
        channel,
        enabled: !!row?.enabled,
        windowId: row?.windowId || null,
        windowName: row?.window?.name || null,
        updatedByName: row?.updatedByName || null,
        updatedAt: row?.updatedAt || null,
      });
    }
  }
  return out;
}
