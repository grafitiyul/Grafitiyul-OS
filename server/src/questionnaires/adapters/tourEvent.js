// Subject adapter: TourEvent (the operational tour). First staff-side
// consumer — the Tour Summary questionnaire binds here (blueprint §14.2).

import { prisma } from '../../db.js';
import { emitTimelineEvent, systemOrigin } from '../../timeline/events.js';
import { getPurpose } from '../registry.js';
import { tourQuestionnairesLocked } from '../../tours/lifecycle.js';

// Human-readable feed body — unknown kinds render through the generic
// NoteCard, so the body carries the whole story.
const formLabel = (purpose) => getPurpose(purpose)?.labelHe || purpose;

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

  // perActor scope (tour_summary): the scope is a guide's externalPersonId
  // and must be an actual assignee of THIS tour.
  async validateActorScope(subjectId, actorScope) {
    const a = await prisma.tourAssignment.findFirst({
      where: { tourEventId: subjectId, externalPersonId: actorScope },
      select: { id: true },
    });
    return !!a;
  },

  // Tour-operational freeze trigger: locked once the tour is closed
  // (terminal status, or ended past the grace window).
  async isLocked(subjectId) {
    const t = await prisma.tourEvent.findUnique({
      where: { id: subjectId },
      select: {
        status: true, date: true, startTime: true,
        productVariant: { select: { durationHours: true } },
      },
    });
    return tourQuestionnairesLocked(t);
  },

  // Staff-side subject: any authenticated admin may open it.
  authorize(_subjectId, auth) {
    return !!auth?.userId;
  },

  async onStarted(subjectId, submission, tx) {
    await emitTimelineEvent(tx, {
      subjectType: 'tour_event',
      subjectId,
      kind: 'questionnaire',
      body: `📋 טופס "${formLabel(submission.purpose)}" — המילוי החל`,
      data: { submissionId: submission.id, purpose: submission.purpose, event: 'started' },
      origin: systemOrigin(),
    });
  },

  async onSubmitted(subjectId, submission, tx) {
    const by = submission.submittedByName ? ` על ידי ${submission.submittedByName}` : '';
    await emitTimelineEvent(tx, {
      subjectType: 'tour_event',
      subjectId,
      kind: 'questionnaire',
      body: `📋 טופס "${formLabel(submission.purpose)}" הוגש${by}`,
      data: { submissionId: submission.id, purpose: submission.purpose, event: 'submitted' },
      origin: systemOrigin(),
    });
  },
};
