// Subject adapter: TourEvent (the operational tour). First staff-side
// consumer — the Tour Summary questionnaire binds here (blueprint §14.2).

import { prisma } from '../../db.js';
import { emitTimelineEvent, systemOrigin } from '../../timeline/events.js';

export const tourEventAdapter = {
  async exists(subjectId) {
    const t = await prisma.tourEvent.findUnique({ where: { id: subjectId }, select: { id: true } });
    return !!t;
  },

  async displayContext(subjectId, lang) {
    const t = await prisma.tourEvent.findUnique({
      where: { id: subjectId },
      select: {
        id: true, kind: true, status: true, date: true, startTime: true,
        tourLanguage: true,
        product: { select: { nameHe: true, nameEn: true } },
        location: { select: { nameHe: true, nameEn: true } },
      },
    });
    if (!t) return null;
    const productName = (lang === 'en' && t.product?.nameEn) || t.product?.nameHe || null;
    const locationName = (lang === 'en' && t.location?.nameEn) || t.location?.nameHe || null;
    return {
      subjectType: 'tour_event',
      title: [productName || 'סיור', t.date, t.startTime].filter(Boolean).join(' · '),
      subtitle: locationName,
      date: t.date,
      startTime: t.startTime,
      kind: t.kind,
      status: t.status,
    };
  },

  async prefill() {
    return {};
  },

  async resolveLanguage(subjectId) {
    const t = await prisma.tourEvent.findUnique({
      where: { id: subjectId },
      select: { tourLanguage: true },
    });
    return t?.tourLanguage || null;
  },

  // Staff-side subject: any authenticated admin may open it.
  authorize(_subjectId, auth) {
    return !!auth?.userId;
  },

  async onStarted(subjectId, submission, tx) {
    await emitTimelineEvent(tx, {
      subjectType: 'tour_event',
      subjectId,
      kind: 'questionnaire_started',
      data: { submissionId: submission.id, purpose: submission.purpose },
      origin: systemOrigin(),
    });
  },

  async onSubmitted(subjectId, submission, tx) {
    await emitTimelineEvent(tx, {
      subjectType: 'tour_event',
      subjectId,
      kind: 'questionnaire_submitted',
      data: {
        submissionId: submission.id,
        purpose: submission.purpose,
        submittedByName: submission.submittedByName || null,
      },
      origin: systemOrigin(),
    });
  },
};
