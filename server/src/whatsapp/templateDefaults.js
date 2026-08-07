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

const STAR_FIELD = 'isAudienceDefault';

// Audiences whose composer supports a default template. Guide-only today, by
// product decision: the customer composer already has a star with a different
// meaning on the same screen, and two stars there would read as one concept.
// Widening this is a deliberate act, not an accident.
export const DEFAULTABLE_AUDIENCES = ['guide'];

// REMOVED: AUDIENCE_DEFAULT_ACCOUNT / templateSendAccountId /
// resolveComposerAccount / setTemplateSendAccount.
//
// A per-template sending number lived here for one release and was removed on
// the owner's decision: "which of our numbers do we write to guides from" is a
// property of the FLOW, not of each wording. It now lives once, on
// GuideMessageSettings (whatsapp/guideMessageSettings.js). This module is left
// with exactly one job — WHICH template the composer opens with.

/** May this audience have a composer default at all? */
export const audienceSupportsDefault = (audience) =>
  DEFAULTABLE_AUDIENCES.includes(String(audience || ''));

/** Raised when a template cannot hold the composer default. */
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
      bodyHeHtml: true, bodyEnHtml: true, isActive: true, updatedAt: true,
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
 * The isActive patch, through the default rule: deactivating the default drops
 * it in the SAME update, so a paused template stops opening the composer and
 * the screen shows the truth.
 */
export function activePatch(isActive) {
  const data = { isActive: !!isActive };
  if (!isActive) data[STAR_FIELD] = false;
  return data;
}
