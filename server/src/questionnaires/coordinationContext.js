// Load the coordination context for ONE booking, and freeze it at submit.
//
// ── The scoping rule ─────────────────────────────────────────────────────────
// Everything here starts from a BOOKING id and never widens. The tour is read
// through that booking, the customer through that booking's deal, the seat
// count through that booking's own registrations. An open tour with four
// unrelated customers therefore produces four different context blocks from the
// same TourEvent — the cardinality is structural, not a filter someone has to
// remember to apply.
//
// ── Read at render, freeze at submit ─────────────────────────────────────────
// A live form always shows current data: a guide calling the customer must see
// the phone number as it is now, not as it was when the link was minted. At
// SUBMIT the rendered block is frozen onto the submission, because from that
// moment it is evidence of what the guide actually saw. The two are different
// jobs and this module does both, in that order.

import { prisma } from '../db.js';
import { CAPACITY_STATUSES } from '../tours/registrationStatus.js';
import { renderContextBlock, defaultContextConfig } from './contextCatalog.js';

// Exactly the graph the catalog resolves over — no more. A field that is not in
// the catalog cannot be reached from here, which is what makes the allowlist
// real rather than advisory.
const CONTEXT_SELECT = {
  id: true, seats: true, notes: true, status: true,
  ticketRegistrations: {
    where: { status: { in: CAPACITY_STATUSES } },
    select: { quantity: true },
  },
  deal: {
    select: {
      id: true, orderNo: true, title: true, tourLanguage: true, communicationLanguage: true,
      customerInfo: true, notes: true,
      organization: { select: { name: true } },
      contacts: {
        select: {
          roles: true, isPrimary: true,
          contact: {
            select: {
              firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true,
              phones: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1, select: { value: true } },
            },
          },
        },
      },
    },
  },
  tourEvent: {
    select: {
      id: true, date: true, startTime: true, tourLanguage: true, notes: true,
      product: { select: { nameHe: true, nameEn: true } },
      productVariant: { select: { location: { select: { nameHe: true, nameEn: true } } } },
      location: { select: { nameHe: true, nameEn: true } },
      assignments: {
        select: { displayName: true, personRef: { select: { displayName: true, profile: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  },
};

/** The booking graph the catalog resolves over, or null. */
export async function loadCoordinationScope(bookingId, { db = prisma } = {}) {
  const booking = await db.booking.findUnique({ where: { id: bookingId }, select: CONTEXT_SELECT });
  if (!booking) return null;
  return { booking, deal: booking.deal, tour: booking.tourEvent };
}

/**
 * The operator's field configuration for the coordination form.
 * Stored on the purpose config so it survives questionnaire version changes —
 * this is operational configuration, not questionnaire content.
 */
export async function contextConfigFor(purpose, { db = prisma } = {}) {
  const row = await db.questionnairePurposeConfig.findUnique({
    where: { purpose },
    select: { contextFields: true },
  });
  const cfg = row?.contextFields;
  return Array.isArray(cfg) && cfg.length ? cfg : defaultContextConfig();
}

/** The rendered read-only block for a live form. */
export async function coordinationContextBlock(bookingId, lang = 'he', { db = prisma } = {}) {
  const scope = await loadCoordinationScope(bookingId, { db });
  if (!scope) return [];
  const config = await contextConfigFor('coordination', { db });
  return renderContextBlock(config, scope, lang);
}

/**
 * Freeze the block onto a submitted submission.
 *
 * Called from the submit path AFTER the answers are stored. Best-effort by
 * design: a context snapshot must never be the reason a guide's answers fail to
 * save. A missing snapshot is visibly missing; a lost submission is not
 * recoverable.
 */
export async function freezeCoordinationContext(submission, { db = prisma } = {}) {
  if (submission?.subjectType !== 'booking' || submission?.purpose !== 'coordination') return null;
  try {
    const block = await coordinationContextBlock(submission.subjectId, submission.language || 'he', { db });
    const snapshot = {
      ...(submission.subjectSnapshot || {}),
      // Namespaced so it can never collide with the adapter's own snapshot keys.
      contextBlock: block,
      contextFrozenAt: new Date().toISOString(),
    };
    await db.questionnaireSubmission.update({
      where: { id: submission.id },
      data: { subjectSnapshot: snapshot },
    });
    return block;
  } catch {
    return null;
  }
}

/** The frozen block of a submitted form, or null when it was never frozen. */
export function frozenContextBlock(submission) {
  const block = submission?.subjectSnapshot?.contextBlock;
  return Array.isArray(block) ? block : null;
}
