// THE WhatsApp sender-account resolver.
//
// Until now `defaultSendAccount()` guessed: with a single configured bridge it
// returned that bridge (correct, because only one existed), and with several it
// fell through to `main`. The moment a second number is paired that guess
// becomes a silent misdelivery — a customer receives a message from the wrong
// business number and nothing anywhere records that a choice was made.
//
// This module replaces the guess with an explicit decision that can FAIL:
//
//   1. an explicit accountId supplied by the caller             (always wins)
//   2. the operator's own last-selected account                 (interactive sends)
//   3. WHATSAPP_SYSTEM_ACCOUNT                                  (server-initiated sends)
//   4. the only configured bridge, when there is exactly one    (unambiguous)
//   → otherwise THROW. Ambiguity is never resolved by preference order.
//
// Step 4 is deliberately last and deliberately narrow: one bridge means there
// is no choice to make. Two bridges with nothing selected is a real question
// that only a human can answer, so it becomes a loud error rather than a
// message sent from whichever account happened to sort first.

import { bridgeUrlMap } from './bridgeClient.js';

export const SENDER_PREF_KEY = 'whatsapp.senderAccount';

// THE account display order, shared by every surface that lists our numbers
// (connections tabs, inbox tabs, composer picker, communication settings).
//
// sortOrder is the admin-owned intent; `id` is the deterministic tiebreak.
// It used to be `createdAt` on the connections list and `id` on the picker,
// which is how the same two accounts rendered in OPPOSITE orders on two
// screens — and how an operator ended up scanning the default-selected tab's
// QR believing it belonged to the other number. Ordering that differs per
// screen is not cosmetic; here it caused a real mis-pairing.
export const ACCOUNT_ORDER_BY = [{ sortOrder: 'asc' }, { id: 'asc' }];

/**
 * THE selectable-account list every sending surface reads.
 *
 * One shape, one order, one definition of "usable": active in the DB, with the
 * live connection state and whether its bridge is even addressable from this
 * server. Surfaces used to build this ad-hoc (the staff modal, the composer
 * picker, the deal panel), which is how three screens disagreed about which
 * numbers existed and in what order.
 */
export async function listSelectableAccounts(db) {
  const configured = new Set(configuredAccounts());
  const rows = await db.whatsAppAccount.findMany({
    where: { active: true },
    select: { id: true, label: true, status: true, phoneJid: true },
    orderBy: ACCOUNT_ORDER_BY,
  });
  return rows.map((a) => ({
    id: a.id,
    label: a.label,
    connected: a.status === 'connected',
    // No bridge map configured at all (local/dev) must not read as "every
    // number is broken" — it means addressing is unconfigured, not wrong.
    bridgeConfigured: configured.size === 0 || configured.has(a.id),
    phone: a.phoneJid ? String(a.phoneJid).split(':')[0].split('@')[0] : null,
  }));
}

export class AmbiguousSenderError extends Error {
  constructor(candidates) {
    super(
      `whatsapp_sender_ambiguous: ${candidates.length} accounts are configured (${candidates.join(', ')}) `
      + 'and no account was selected. Refusing to guess which number sends this message.',
    );
    this.code = 'whatsapp_sender_ambiguous';
    this.status = 409;
    this.candidates = candidates;
  }
}

export function configuredAccounts() {
  return Object.keys(bridgeUrlMap());
}

/**
 * Resolve the sending account, or throw.
 *
 * `explicit`   — an accountId the caller already decided (a chat's own account,
 *                a frozen delivery snapshot, an operator's picker choice).
 * `preferred`  — the operator's stored preference, for interactive sends.
 * `env`        — injected for testability.
 */
export function resolveSendAccount({ explicit = null, preferred = null, env = process.env } = {}) {
  const configured = configuredAccounts();

  const consider = (value, why) => {
    if (!value) return null;
    const id = String(value).trim();
    if (!id) return null;
    // A preference pointing at an account that no longer exists must not be
    // honoured — that is how a retired number keeps receiving sends.
    if (configured.length && !configured.includes(id)) return null;
    return { accountId: id, reason: why };
  };

  const chosen = consider(explicit, 'explicit')
    || consider(preferred, 'user_preference')
    || consider(env.WHATSAPP_SYSTEM_ACCOUNT, 'system_default')
    || (configured.length === 1 ? { accountId: configured[0], reason: 'only_configured_account' } : null);
  if (chosen) return chosen;

  // Zero configured bridges is NOT ambiguity — there is nothing to choose
  // between. Saying "ambiguous" there would send an operator hunting for a
  // picker that cannot exist; the real problem is that WhatsApp is not set up.
  if (configured.length === 0) {
    const e = new Error('whatsapp_no_accounts_configured: no bridge is configured (WHATSAPP_BRIDGE_URLS is empty)');
    e.code = 'whatsapp_no_accounts_configured';
    e.status = 503;
    throw e;
  }
  throw new AmbiguousSenderError(configured);
}

// NOTE (2026-08-01): the sender preference is NO LONGER a UI concept. Several
// office employees share one GOS login while each works from a different
// WhatsApp number, so a per-USER server-side preference synchronised the wrong
// thing — one employee's choice moved everyone else's. Selection now lives in
// the browser (client/src/admin/whatsapp/senderAccount.js, localStorage) and
// every interactive send names its account explicitly.
//
// What remains below is the SERVER-side fallback only: nothing writes it any
// more, and it is consulted only if a caller omits an explicit account.

/** Read one operator's stored sender preference. Never throws. */
export async function getSenderPreference(db, userId) {
  if (!userId) return null;
  try {
    const row = await db.userUiState.findUnique({
      where: { userId_key: { userId, key: SENDER_PREF_KEY } },
      select: { value: true },
    });
    const id = row?.value?.accountId;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

/**
 * Store the operator's selection. GLOBAL per user, deliberately not per deal or
 * per chat: switching to Office on one deal must carry to the next deal opened,
 * which is what makes the selector feel like a mode rather than a per-message
 * checkbox.
 */
export async function setSenderPreference(db, userId, accountId) {
  if (!userId) return null;
  const configured = configuredAccounts();
  if (configured.length && !configured.includes(String(accountId))) {
    const e = new Error(`unknown_account: ${accountId}`);
    e.code = 'unknown_account';
    e.status = 400;
    throw e;
  }
  const value = { accountId: String(accountId), setAt: new Date().toISOString() };
  await db.userUiState.upsert({
    where: { userId_key: { userId, key: SENDER_PREF_KEY } },
    create: { userId, key: SENDER_PREF_KEY, value },
    update: { value },
  });
  return value;
}

/**
 * The one call interactive routes make: resolve using this operator's
 * preference, and remember the choice when they made one explicitly.
 */
export async function resolveForOperator(db, { userId, explicit = null, remember = false }) {
  const preferred = await getSenderPreference(db, userId);
  const resolved = resolveSendAccount({ explicit, preferred });
  if (remember && explicit && userId && explicit !== preferred) {
    await setSenderPreference(db, userId, explicit).catch(() => {});
  }
  return resolved;
}
