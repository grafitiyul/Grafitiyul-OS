// THE owner of "which WhatsApp template answers a new external lead".
//
// One fact, one writer. Every rule about the star lives here so no route,
// screen or future feature can set `isNewLeadDefault` directly and drift:
//
//   • at most ONE template may be starred        (transaction + partial unique index)
//   • starring one CLEARS the previous star       (same transaction — never two)
//   • an INACTIVE template cannot be starred      (rejected, not silently allowed)
//   • deactivating the starred template CLEARS it (a paused template must not
//     keep answering customers — the operator sees the star disappear)
//   • deleting it clears the star by construction (the row is gone)
//   • ZERO starred templates is valid and means no automatic reply is sent
//
// This is deliberately a property of WhatsAppTemplate rather than a second
// template system: the Deal composer, the settings screen and this feature all
// read the same rows, the same bilingual bodies and the same active flag.

const STAR_FIELD = 'isNewLeadDefault';
const ACCOUNT_FIELD = 'newLeadSendAccountId';

// The number a new lead is greeted from when nobody has chosen one.
//
// 'main' (מכירות) rather than a coin-flip between the two configured bridges: a
// first reply to a brand-new lead is a SALES first touch, and picking silently
// between two real business numbers is exactly what the canonical sender
// resolver refuses to do. This constant is the deliberate, documented answer to
// that question for THIS flow only — every other server-initiated send keeps
// its own rule.
export const DEFAULT_NEW_LEAD_ACCOUNT_ID = 'main';

/** The account a template will send from — its own choice, or the default. */
export function newLeadAccountIdOf(template) {
  return template?.[ACCOUNT_FIELD] || DEFAULT_NEW_LEAD_ACCOUNT_ID;
}

/** Raised when the operator tries to star a template that cannot hold the star. */
export class TemplateNotStarrableError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.status = 400;
  }
}

/**
 * The starred template, or null.
 *
 * `isActive` is part of the QUERY, not a check afterwards: a deactivated
 * template must behave exactly like no template at all at send time, even if a
 * star somehow survived on it. Belt and braces — deactivation already clears
 * the star through setActive() below.
 */
export async function getStarredTemplate(db) {
  return db.whatsAppTemplate.findFirst({
    where: { [STAR_FIELD]: true, isActive: true },
    select: {
      id: true,
      nameHe: true,
      bodyHeHtml: true,
      bodyEnHtml: true,
      isActive: true,
      newLeadSendAccountId: true,
      updatedAt: true,
    },
  });
}

/**
 * Star ONE template as the new-lead default, clearing whichever held it.
 *
 * The clear and the set share one transaction, so there is no instant at which
 * two templates are starred and none at which the operator's intent is half
 * applied. Returns the updated row.
 */
export async function setNewLeadDefault(db, templateId) {
  const target = await db.whatsAppTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, isActive: true, [ACCOUNT_FIELD]: true },
  });
  if (!target) throw new TemplateNotStarrableError('not_found');
  // An inactive template is not offered anywhere and must never be the thing
  // that answers a real customer. Rejected loudly rather than auto-activated:
  // silently turning a template back on is a decision only the operator makes.
  if (!target.isActive) throw new TemplateNotStarrableError('template_inactive');

  return db.$transaction(async (tx) => {
    await tx.whatsAppTemplate.updateMany({
      where: { [STAR_FIELD]: true, id: { not: templateId } },
      data: { [STAR_FIELD]: false },
    });
    return tx.whatsAppTemplate.update({
      where: { id: templateId },
      data: {
        [STAR_FIELD]: true,
        // Switching the star KEEPS whatever this template already had, and
        // otherwise lands on the safe default. Never inherits the outgoing
        // template's choice: the account is a property of the template, so
        // carrying it across would silently change the sending number of a
        // template the operator did not configure.
        [ACCOUNT_FIELD]: target[ACCOUNT_FIELD] || DEFAULT_NEW_LEAD_ACCOUNT_ID,
      },
    });
  });
}

/**
 * Choose the number the automatic new-lead reply is sent from.
 *
 * Only meaningful on the STARRED template — that is the only one that sends —
 * so setting it on another row is refused rather than quietly stored, which
 * would leave an invisible setting waiting to surprise someone later.
 *
 * `validAccountIds` is supplied by the caller from the canonical account list;
 * this module does not decide which numbers exist.
 */
export async function setNewLeadSendAccount(db, templateId, accountId, validAccountIds = null) {
  const id = String(accountId || '').trim();
  if (!id) throw new TemplateNotStarrableError('account_required');
  if (validAccountIds && !validAccountIds.includes(id)) {
    throw new TemplateNotStarrableError('unknown_account');
  }
  const target = await db.whatsAppTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, [STAR_FIELD]: true },
  });
  if (!target) throw new TemplateNotStarrableError('not_found');
  if (!target[STAR_FIELD]) throw new TemplateNotStarrableError('template_not_starred');

  return db.whatsAppTemplate.update({
    where: { id: templateId },
    data: { [ACCOUNT_FIELD]: id },
  });
}

/**
 * Remove the star — no template answers new leads. Always valid.
 *
 * `templateId` scopes the clear to ONE template: "unstar A" must not silently
 * clear B's star if the screen was showing stale data. Omit it to clear
 * whatever holds the star.
 */
export async function clearNewLeadDefault(db, templateId = null) {
  const where = templateId
    ? { [STAR_FIELD]: true, id: templateId }
    : { [STAR_FIELD]: true };
  const { count } = await db.whatsAppTemplate.updateMany({ where, data: { [STAR_FIELD]: false } });
  return { ok: true, cleared: count };
}

/**
 * Apply an isActive change through the star rule.
 *
 * Deactivating the starred template drops the star in the SAME update, so the
 * automatic reply stops and the screen shows the truth. Without this a paused
 * template would keep answering customers — the exact "safely blocks or clears"
 * requirement.
 */
export async function setActive(db, templateId, isActive) {
  const data = { isActive: !!isActive };
  if (!isActive) data[STAR_FIELD] = false;
  return db.whatsAppTemplate.update({ where: { id: templateId }, data });
}

/**
 * Which languages a template can actually be sent in.
 *
 * Used by the settings screen to warn BEFORE starring ("this template has no
 * English — foreign leads will not get a reply") and by the send path to skip
 * honestly instead of falling back to the wrong language.
 */
export function templateLanguages(template) {
  return {
    he: !!(template?.bodyHeHtml && String(template.bodyHeHtml).trim()),
    en: !!(template?.bodyEnHtml && String(template.bodyEnHtml).trim()),
  };
}
