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
    select: { id: true, isActive: true },
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
      data: { [STAR_FIELD]: true },
    });
  });
}

/** Remove the star entirely — no template answers new leads. Always valid. */
export async function clearNewLeadDefault(db) {
  await db.whatsAppTemplate.updateMany({
    where: { [STAR_FIELD]: true },
    data: { [STAR_FIELD]: false },
  });
  return { ok: true };
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
