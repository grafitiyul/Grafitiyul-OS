// Subject adapter: TourEvent (the operational tour). First staff-side
// consumer — the Tour Summary questionnaire binds here (blueprint §14.2).

import { prisma } from '../../db.js';
import { emitTimelineEvent, systemOrigin } from '../../timeline/events.js';
import { getPurpose } from '../registry.js';
import { summaryCompletionState, completeTour } from '../../tours/completion.js';

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

  // Tour-operational anchor: WHEN did this tour close? (explicit business
  // completion / cancellation — lifecyclePolicy derives structure freeze and
  // answer lock from this one timestamp.)
  async closedAt(subjectId) {
    const t = await prisma.tourEvent.findUnique({
      where: { id: subjectId },
      select: { status: true, completedAt: true, cancelledAt: true, updatedAt: true },
    });
    if (!t) return null;
    if (t.status === 'completed') return t.completedAt || t.updatedAt;
    if (t.status === 'cancelled') return t.cancelledAt || t.updatedAt;
    return null;
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

  // Every MEANINGFUL press (first submit / update-with-changes) becomes ONE
  // immutable history entry — TimelineEntry kind='change', the same
  // mechanism + expandable renderer the Deal changelog uses. No-op updates
  // and autosaves never reach history.
  async onSubmitted(subjectId, submission, tx, { firstSubmit = true, changes = [] } = {}) {
    if (!firstSubmit && changes.length === 0) return;
    const by = submission.submittedByName || null;
    const title = firstSubmit
      ? `📋 טופס "${formLabel(submission.purpose)}" הוגש${by ? ` על ידי ${by}` : ''}`
      : `📋 טופס "${formLabel(submission.purpose)}" עודכן${by ? ` על ידי ${by}` : ''}`;
    await emitTimelineEvent(tx, {
      subjectType: 'tour_event',
      subjectId,
      kind: 'change',
      body: title,
      data: {
        title,
        changes,
        submissionId: submission.id,
        purpose: submission.purpose,
        source: 'questionnaire',
        event: firstSubmit ? 'submitted' : 'updated',
      },
      origin: { actorType: 'system', actorLabel: by || 'מערכת', createdBy: null, createdByName: by },
    });
    // Completion trigger #1: this submit may have been the LAST required
    // guide's summary — if so the tour completes right now, atomically with
    // the submit (same tx).
    if (firstSubmit && submission.purpose === 'tour_summary') {
      const state = await summaryCompletionState(tx, subjectId);
      if (state.allSubmitted) {
        await completeTour(tx, subjectId, {
          reason: 'summaries',
          actorName: by,
        });
      }
    }
  },
};
