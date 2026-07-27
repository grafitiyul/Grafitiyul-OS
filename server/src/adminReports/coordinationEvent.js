// Coordination-call submission → Admin Report #4 (on time) or #5 (late).
//
// Called from the CANONICAL submit hook (questionnaires/adapters/booking.js
// onSubmitted, firstSubmit only), so both the guide portal and the staff
// dialog are covered by one wiring. Which report fires is decided by real
// timestamps against the canonical deadline — never by a status label.

import { prisma } from '../db.js';
import { fireAdminReport } from './dispatch.js';
import { coordinationDeadlineMs, isOnTime, latenessLabel } from './coordination.js';

export async function reportCoordinationSubmission(
  { bookingId, tourEventId, dealId, submissionId, submittedByName },
  { client = prisma, log = console } = {},
) {
  const [tour, booking, submission] = await Promise.all([
    client.tourEvent.findUnique({
      where: { id: tourEventId },
      select: {
        id: true, date: true, startTime: true, status: true,
        product: { select: { nameHe: true } },
        location: { select: { nameHe: true } },
      },
    }),
    client.booking.findUnique({
      where: { id: bookingId },
      select: { deal: { select: { participants: true } } },
    }),
    client.questionnaireSubmission.findUnique({
      where: { id: submissionId },
      select: { submittedAt: true },
    }),
  ]);
  if (!tour || tour.status === 'cancelled') return { skipped: 'no_live_tour' };

  const deadlineMs = coordinationDeadlineMs(tour);
  const submittedAtMs = submission?.submittedAt ? new Date(submission.submittedAt).getTime() : Date.now();
  const onTime = isOnTime(submittedAtMs, deadlineMs);
  // No tour datetime ⇒ the deadline is undecidable; reporting "late" would be
  // a guess, so nothing is reported.
  if (onTime === null) return { skipped: 'no_deadline' };

  const number = onTime ? 4 : 5;
  const data = {
    coordinationReport: {
      guideName: submittedByName ? String(submittedByName).replace(/^מדריך\s*·\s*/, '') : null,
      productName: tour.product?.nameHe || null,
      cityName: tour.location?.nameHe || null,
      tourDate: tour.date,
      tourTime: tour.startTime,
      participants: booking?.deal?.participants ?? null,
      tourEventId: tour.id,
      // Frozen proof of the decision.
      submittedAt: new Date(submittedAtMs).toISOString(),
      deadlineAt: new Date(deadlineMs).toISOString(),
      latenessLabel: onTime ? null : latenessLabel(submittedAtMs, deadlineMs),
    },
  };
  // One report per coordination call (the canonical unit is the booking's
  // single submission) — a retried submit reuses the same key.
  return fireAdminReport({
    number,
    idempotencyKey: `coordination:${submissionId}`,
    dealId,
    tourEventId,
    data,
  }, log);
}
