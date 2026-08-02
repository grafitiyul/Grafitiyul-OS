// Staff form-scoped questionnaire links — THE replacement for guide-portal
// deep links in operational messages.
//
// ── What went wrong, so it is not repeated ───────────────────────────────────
// Messages #12-#16 linked guides to `/p/<portalToken>/tour/<id>`. That URL IS
// the guide's whole-portal token with a path appended: delete the path and you
// have the entire portal — every tour, profile, payments, training, schedule.
// Forwarding one coordination reminder handed all of it over. Authorization is
// by token possession, so hiding portal navigation in the UI would have fixed
// nothing.
//
// ── The model ────────────────────────────────────────────────────────────────
// A staff link is a capability for EXACTLY ONE questionnaire instance:
//
//   (purpose, subjectType, subjectId, actorScope)
//
// It carries no identity beyond that. It cannot list tours, cannot open the
// portal, cannot reach another booking's coordination form, and — because
// actorScope is part of its identity — cannot open another guide's summary.
//
// Two surfaces, deliberately non-interchangeable:
//   audience='public' → the customer form route (rejects staff purposes)
//   audience='staff'  → this route (rejects everything else)
// A token minted for one can never be replayed on the other.
//
// ── Stability ────────────────────────────────────────────────────────────────
// A unique index on the business identity means ensureStaffFormLink is
// idempotent: the first reminder mints the link, every retry and every later
// reminder REUSES it. A guide who bookmarked the link keeps working, and we
// never accumulate a pile of live tokens for the same form.

import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { QError } from './service.js';
import { getPurpose } from './registry.js';
import { publicOrigin } from '../communication/context.js';

/** 32 bytes of entropy, URL-safe. Same generator class as the portal token. */
function newStaffToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * The link for ONE staff form instance, created once and reused forever after.
 *
 * `actorScope` is required for perActor purposes (tour_summary) and must be
 * absent for the rest — passing it where it does not belong would silently
 * create a second link for the same form.
 */
export async function ensureStaffFormLink(
  { purpose, subjectType, subjectId, actorScope = null, language = null },
  { db = prisma } = {},
) {
  const def = getPurpose(purpose);
  if (!def) throw new QError(400, 'invalid_purpose');
  if (def.audience !== 'staff') throw new QError(400, 'purpose_not_staff');
  if (!subjectType || !subjectId) throw new QError(400, 'subject_required');
  // perActor forms are per GUIDE; anything else must not be actor-scoped.
  const scope = def.perActor ? String(actorScope || '') : null;
  if (def.perActor && !scope) throw new QError(400, 'actor_scope_required');

  const template = await db.questionnaireTemplate.findFirst({
    where: { purpose, status: 'active', currentVersionId: { not: null } },
    select: { id: true },
  });
  if (!template) throw new QError(409, 'no_active_template');

  const identity = { purpose, subjectType, subjectId, actorScope: scope, audience: 'staff' };
  const existing = await db.questionnaireLink.findFirst({ where: identity });
  if (existing) {
    // A revoked link is re-armed rather than duplicated, so the URL an operator
    // may already have circulated keeps working after a cancellation is undone.
    if (!existing.isActive) {
      return db.questionnaireLink.update({ where: { id: existing.id }, data: { isActive: true } });
    }
    return existing;
  }

  try {
    return await db.questionnaireLink.create({
      data: {
        ...identity,
        templateId: template.id,
        token: newStaffToken(),
        language,
        label: `${purpose}:${subjectId}${scope ? `:${scope}` : ''}`,
      },
    });
  } catch (err) {
    // Two reminders racing for the same form — the index decided; reuse it.
    if (err?.code === 'P2002') return db.questionnaireLink.findFirst({ where: identity });
    throw err;
  }
}

/**
 * Resolve a staff token to its ONE form, or 404.
 *
 * Every rejection is a generic 404 on purpose: a probing caller must not learn
 * whether a token exists, is expired, is revoked, or belongs to a different
 * surface.
 */
export async function resolveStaffFormLink(token, { db = prisma } = {}) {
  const link = await db.questionnaireLink.findUnique({
    where: { token: String(token || '') },
    include: { template: true },
  });
  if (!link || !link.isActive) throw new QError(404, 'not_found');
  // A public customer token must never be replayed on the staff route.
  if (link.audience !== 'staff') throw new QError(404, 'not_found');
  if (link.expiresAt && link.expiresAt < new Date()) throw new QError(404, 'not_found');
  if (link.template.status !== 'active' || !link.template.currentVersionId) {
    throw new QError(404, 'not_found');
  }
  // The purpose must STILL be staff-audience. If a purpose ever turns public,
  // its old staff links die rather than becoming a customer-visible surface.
  if (getPurpose(link.purpose)?.audience !== 'staff') throw new QError(404, 'not_found');
  return link;
}

/** The URL a message carries. Null when no link could be minted. */
export function staffFormUrl(link, origin = publicOrigin()) {
  if (!origin || !link?.token) return null;
  return `${origin}/f/${encodeURIComponent(link.token)}`;
}

/**
 * Mint + format in one call — what report renderers use.
 * Never throws into a notification: a link that cannot be built yields null and
 * the message says so, rather than failing the whole report.
 */
export async function staffFormLinkUrl(args, { db = prisma, log = console } = {}) {
  try {
    const link = await ensureStaffFormLink(args, { db });
    return staffFormUrl(link);
  } catch (err) {
    log.warn?.(`[staff-form-link] could not build link: ${err?.code || err?.message || err}`);
    return null;
  }
}

/** Revoke every staff link for a subject — used by cancellation policy. */
export async function revokeStaffFormLinks({ subjectType, subjectId }, { db = prisma } = {}) {
  const res = await db.questionnaireLink.updateMany({
    where: { subjectType, subjectId, audience: 'staff', isActive: true },
    data: { isActive: false },
  });
  return res.count;
}
