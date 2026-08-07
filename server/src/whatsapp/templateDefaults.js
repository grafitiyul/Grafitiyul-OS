// THE owner of "which template does the composer open with, and from which of
// our numbers".
//
// One fact, one writer — the same shape as whatsapp/newLeadTemplate.js, which
// owns the OTHER star. Every rule about the composer default lives here so no
// route, screen or future feature can set `isAudienceDefault` directly and
// drift:
//
//   • at most ONE default PER AUDIENCE      (transaction + partial unique index)
//   • setting one CLEARS the previous       (same transaction — never two)
//   • an INACTIVE template cannot hold it   (rejected, not silently allowed)
//   • deactivating the default CLEARS it    (a paused template must not keep
//     opening the composer — the operator sees the star disappear)
//   • deleting it clears it by construction (the row is gone)
//   • ZERO defaults is valid and means the composer opens empty
//
// ── Why this is NOT the new-lead star ────────────────────────────────────────
// isNewLeadDefault means "this template is SENT, by itself, to a stranger".
// This one means "this template is the starting point on screen". The first is
// a promise to a customer; the second is a convenience for an operator. Folding
// them into one column would make turning on a convenience turn on an automatic
// message, which is exactly the class of accident this project does not ship.

import { AmbiguousSenderError } from './senderAccount.js';

const STAR_FIELD = 'isAudienceDefault';
const ACCOUNT_FIELD = 'sendAccountId';

// Audiences whose composer supports a default template. Guide-only today, by
// product decision: the customer composer already has a star with a different
// meaning on the same screen, and two stars there would read as one concept.
// Widening this is a deliberate act, not an accident.
export const DEFAULTABLE_AUDIENCES = ['guide'];

// The number a template is sent from when nobody chose one, per audience.
//
// 'office' (שירות לקוחות) for guide messages: writing to a guide about a tour
// that already happened is service, not sales, and the office number is the one
// guides already have a conversation on. Like DEFAULT_NEW_LEAD_ACCOUNT_ID, this
// is the deliberate documented answer for THIS flow only — it is a stable
// bridge-keyed id, never the Hebrew label, so renaming the number in admin
// cannot break it.
export const AUDIENCE_DEFAULT_ACCOUNT = { guide: 'office' };

/** May this audience have a composer default at all? */
export const audienceSupportsDefault = (audience) =>
  DEFAULTABLE_AUDIENCES.includes(String(audience || ''));

/**
 * The account a template will be composed from: its OWN choice first, then the
 * audience default. Never a coin-flip between two real business numbers — a
 * null here is an honest "nothing configured", and the caller decides.
 */
export function templateSendAccountId(template) {
  const own = String(template?.[ACCOUNT_FIELD] || '').trim();
  if (own) return own;
  return AUDIENCE_DEFAULT_ACCOUNT[template?.audience || 'customer'] || null;
}

/**
 * Resolve the account a composer should PRESELECT, and say whether it can
 * actually send. `accounts` is the canonical list (senderAccount.listSelectableAccounts).
 *
 * Returns { accountId, source, available, connected }:
 *   source     'template' | 'audience_default' | 'none'
 *   available  the id exists in the canonical list (a retired number does not)
 *   connected  that account's bridge is currently connected
 *
 * A configured-but-unavailable account resolves to accountId with
 * available:false rather than to a substitute. Silently swapping business
 * numbers is the failure mode this whole module exists to prevent.
 */
export function resolveComposerAccount(template, accounts = []) {
  const own = String(template?.[ACCOUNT_FIELD] || '').trim();
  const fallback = AUDIENCE_DEFAULT_ACCOUNT[template?.audience || 'customer'] || null;
  const accountId = own || fallback || null;
  const row = accountId ? accounts.find((a) => a.id === accountId) || null : null;
  return {
    accountId,
    source: own ? 'template' : accountId ? 'audience_default' : 'none',
    available: !!row,
    connected: !!row?.connected,
  };
}

/** Raised when a template cannot hold the default / the account. */
export class TemplateDefaultError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.status = 400;
  }
}

/** The active default for one audience, or null. */
export async function getAudienceDefault(db, audience) {
  if (!audienceSupportsDefault(audience)) return null;
  return db.whatsAppTemplate.findFirst({
    // isActive is part of the QUERY, not a check afterwards: a deactivated
    // template must behave exactly like no default at all, even if a flag
    // somehow survived on it.
    where: { [STAR_FIELD]: true, isActive: true, audience },
    select: {
      id: true, nameHe: true, audience: true,
      bodyHeHtml: true, bodyEnHtml: true, isActive: true,
      [ACCOUNT_FIELD]: true, updatedAt: true,
    },
  });
}

/**
 * Make ONE template the composer default for its audience, clearing whichever
 * held it. The clear and the set share a transaction, so there is no instant at
 * which two are flagged and none at which the operator's intent is half applied.
 */
export async function setAudienceDefault(db, templateId) {
  const target = await db.whatsAppTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, isActive: true, audience: true },
  });
  if (!target) throw new TemplateDefaultError('not_found');
  if (!audienceSupportsDefault(target.audience)) throw new TemplateDefaultError('wrong_audience');
  // Rejected loudly rather than auto-activated: silently turning a template
  // back on is a decision only the operator makes.
  if (!target.isActive) throw new TemplateDefaultError('template_inactive');

  return db.$transaction(async (tx) => {
    await tx.whatsAppTemplate.updateMany({
      // Scoped to the SAME audience — setting the guide default must never
      // touch a customer template, and vice versa.
      where: { [STAR_FIELD]: true, audience: target.audience, id: { not: templateId } },
      data: { [STAR_FIELD]: false },
    });
    return tx.whatsAppTemplate.update({ where: { id: templateId }, data: { [STAR_FIELD]: true } });
  });
}

/**
 * Clear the default — the composer opens empty. Always valid.
 * `templateId` scopes the clear to ONE template: "unstar A" must not clear B's
 * flag if the screen was showing stale data.
 */
export async function clearAudienceDefault(db, templateId) {
  const { count } = await db.whatsAppTemplate.updateMany({
    where: { [STAR_FIELD]: true, id: templateId },
    data: { [STAR_FIELD]: false },
  });
  return { ok: true, cleared: count };
}

/**
 * Choose the number this template is normally sent from.
 *
 * Unlike the new-lead account (which only the starred template may hold,
 * because only it sends by itself), ANY template may carry this: every template
 * can be sent manually, so every template has a sensible "from".
 *
 * `validAccountIds` comes from the canonical account list — this module does
 * not decide which numbers exist. An empty string CLEARS the choice, which
 * resolves back to the audience default.
 */
export async function setTemplateSendAccount(db, templateId, accountId, validAccountIds = null) {
  const id = String(accountId ?? '').trim();
  if (id && validAccountIds && !validAccountIds.includes(id)) {
    throw new TemplateDefaultError('unknown_account');
  }
  const target = await db.whatsAppTemplate.findUnique({ where: { id: templateId }, select: { id: true } });
  if (!target) throw new TemplateDefaultError('not_found');
  return db.whatsAppTemplate.update({
    where: { id: templateId },
    data: { [ACCOUNT_FIELD]: id || null },
  });
}

/**
 * The isActive patch, through the default rule: deactivating the default drops
 * it in the SAME update, so a paused template stops opening the composer and
 * the screen shows the truth.
 */
export function activePatch(isActive) {
  const data = { isActive: !!isActive };
  if (!isActive) data[STAR_FIELD] = false;
  return data;
}

// Re-exported so a caller that resolves an account can distinguish "nothing is
// configured" from "two numbers and nobody chose" without importing two modules.
export { AmbiguousSenderError };
