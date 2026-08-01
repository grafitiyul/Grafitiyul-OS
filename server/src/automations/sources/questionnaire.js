// Questionnaire submissions → automation events.
//
// ONE hook, called from submitSubmission AFTER its transaction commits. It is
// subject-agnostic on purpose: both שיחת תיאום (subject = booking) and
// סיכום סיור (subject = tour_event) are covered without touching either
// adapter, and a future questionnaire consumer is covered for free.
//
// Two hard guarantees:
//   * a submission ALWAYS succeeds, whatever automations do — this runs
//     detached, and every failure is swallowed into a run row;
//   * conditions are evaluated against the FROZEN answers by stable key, so a
//     later reword of the question or the answer changes nothing.

import { prisma } from '../../db.js';
import { automationsForTrigger } from '../registry.js';
import { runAutomation } from '../runtime.js';

/**
 * Business refs for the Communication Center context, resolved from the
 * submission's subject.
 *
 * Deal resolution for a tour_event subject is deliberately conservative: a tour
 * with exactly ONE active booking has an unambiguous customer, and anything else
 * (a group/open tour with several bookings, or none) resolves to null rather
 * than picking one. Guessing here would put the wrong customer's name and
 * balance into a manager's message; a null is visible in the run row and in the
 * message's own missing-variable handling.
 */
export async function resolveSubjectRefs(submission, { db = prisma } = {}) {
  const base = { submissionId: submission.id, dealId: null, tourEventId: null, bookingId: null, ambiguousDeal: false };

  if (submission.subjectType === 'tour_event') {
    base.tourEventId = submission.subjectId;
    const bookings = await db.booking.findMany({
      where: { tourEventId: submission.subjectId, status: { not: 'cancelled' } },
      select: { id: true, dealId: true },
    });
    if (bookings.length === 1) {
      base.dealId = bookings[0].dealId;
      base.bookingId = bookings[0].id;
    } else if (bookings.length > 1) {
      base.ambiguousDeal = true;
    }
    return base;
  }

  if (submission.subjectType === 'booking') {
    const b = await db.booking.findUnique({
      where: { id: submission.subjectId },
      select: { id: true, dealId: true, tourEventId: true },
    });
    if (b) {
      base.bookingId = b.id;
      base.dealId = b.dealId;
      base.tourEventId = b.tourEventId;
    }
    return base;
  }

  return base; // unbound submission — no business context
}

/** The answer map a condition is evaluated against: questionKey → frozen value. */
export function answersOf(submission) {
  return Object.fromEntries((submission.answers || []).map((a) => [a.questionKey, a.value]));
}

/**
 * Fire every automation registered on this submission's template.
 *
 * `firstSubmit` distinguishes the original submission from a later edit: an
 * automation defaults to firstSubmitOnly, because editing an answer is not a new
 * business event and must not re-notify anyone.
 */
export async function runQuestionnaireAutomations(
  submission,
  { firstSubmit = true, db = prisma, log = console } = {},
) {
  const templateKey = submission.template?.key;
  if (!templateKey) return { ran: 0 };

  const defs = automationsForTrigger({
    kind: 'questionnaire_submitted',
    templateKey,
    purpose: submission.purpose,
  });
  if (!defs.length) return { ran: 0 };

  const refs = await resolveSubjectRefs(submission, { db });
  const answers = answersOf(submission);
  let ran = 0;

  for (const def of defs) {
    // Every automation is isolated: one failing definition must never stop the
    // next one from running.
    try {
      const res = await runAutomation(def, {
        submission,
        answers,
        refs,
        firstSubmit,
      }, { db, log });
      if (res?.recorded) ran++;
    } catch (err) {
      log.error?.(`[automations] ${def.id} threw outside the runtime: ${err?.message || err}`);
    }
  }
  return { ran };
}

/**
 * Fire-and-forget entry point for the submit path. Never awaited by the caller,
 * never able to fail a submission.
 */
export function fireQuestionnaireAutomations(submission, opts = {}) {
  setImmediate(() => {
    runQuestionnaireAutomations(submission, opts).catch((err) => {
      (opts.log || console).error?.(`[automations] questionnaire source failed: ${err?.message || err}`);
    });
  });
}
