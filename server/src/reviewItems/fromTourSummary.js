// A submitted tour summary → its review cards.
//
// ONE entry point, called by the review_item automation action. It creates:
//   * ALWAYS  a tour_summary card (every summary is reviewed);
//   * MAYBE   a logistics_report card, only when a logistics answer needs
//             attention.
//
// The two are separate rows with separate dedupeKeys, so they are handled
// independently — that is structural, not a UI convention.
//
// Everything the manager needs is FROZEN onto the card at creation: guide,
// customer, organisation, product, variant, tour time, and the answers
// themselves. A later edit of the questionnaire, the deal or the tour therefore
// cannot rewrite what a manager already reviewed.

import { prisma } from '../db.js';
import { createReviewItem } from './service.js';
import { TOUR_SUMMARY_KIND, buildSummaryDetails, summaryHeadline } from './kinds/tourSummary.js';
import { LOGISTICS_KIND, buildLogisticsFindings, logisticsHeadline } from './kinds/logisticsReport.js';
import { staffName } from '../../../shared/staffName.mjs';

/** The published structure's questions + the option keys marked affirmative. */
async function loadStructure(versionId, db) {
  const questions = await db.questionnaireQuestion.findMany({
    where: { versionId },
    select: { key: true, config: true, label: true, options: { select: { value: true, label: true } } },
  });
  // The author marks which option is the "yes" side via config.affirmativeOption
  // (an o_* key). Never inferred from Hebrew text.
  const affirmativeOptionValues = new Set(
    questions.map((q) => q?.config?.affirmativeOption).filter(Boolean),
  );
  return { questions, affirmativeOptionValues };
}

/** Frozen tour/customer/team context for the card. */
async function loadContext(tourEventId, actorScope, db) {
  if (!tourEventId) return {};
  const [tour, guide] = await Promise.all([
    db.tourEvent.findUnique({
      where: { id: tourEventId },
      select: {
        id: true, date: true, startTime: true,
        product: { select: { nameHe: true } },
        variant: { select: { nameHe: true, isHome: true } },
        location: { select: { nameHe: true } },
        bookings: {
          where: { status: { not: 'cancelled' } },
          select: {
            deal: {
              select: {
                id: true, orderNo: true, title: true,
                organization: { select: { name: true } },
                contacts: {
                  where: { isPrimary: true },
                  select: { contact: { select: { firstNameHe: true, lastNameHe: true } } },
                },
              },
            },
          },
        },
      },
    }),
    actorScope
      ? db.personRef.findUnique({
        where: { externalPersonId: actorScope },
        select: { id: true, displayName: true, profile: true },
      })
      : null,
  ]);
  if (!tour) return {};

  const deal = tour.bookings[0]?.deal || null;
  const contact = deal?.contacts?.[0]?.contact || null;
  return {
    tourEventId: tour.id,
    tourDate: tour.date,
    tourTime: tour.startTime,
    productName: tour.product?.nameHe || null,
    // Variant only when it is meaningful — a home-location variant adds nothing.
    variantName: tour.variant && !tour.variant.isHome ? tour.variant.nameHe : null,
    cityName: tour.location?.nameHe || null,
    dealId: deal?.id || null,
    dealOrderNo: deal?.orderNo ?? null,
    customerName: contact ? [contact.firstNameHe, contact.lastNameHe].filter(Boolean).join(' ') : (deal?.title || null),
    orgName: deal?.organization?.name || null,
    guidePersonRefId: guide?.id || null,
    guideName: guide ? staffName(guide, 'he') : null,
  };
}

const whenLabel = (ctx) => [ctx.tourDate, ctx.tourTime].filter(Boolean).join(' ');

/**
 * Build both cards for one submitted summary.
 * Returns { summary, logistics } — each { item, created } or null.
 */
export async function reviewItemsForTourSummary(
  { submission, answers, refs, autId = null },
  { db = prisma } = {},
) {
  const { questions, affirmativeOptionValues } = await loadStructure(submission.versionId, db);
  const ctx = await loadContext(refs.tourEventId, submission.actorScope, db);

  const entityRefs = [
    ctx.tourEventId ? { type: 'tour_event', id: ctx.tourEventId, label: whenLabel(ctx) || 'סיור' } : null,
    ctx.dealId ? { type: 'deal', id: ctx.dealId, orderNo: ctx.dealOrderNo, label: ctx.customerName || 'דיל' } : null,
  ].filter(Boolean);

  const party = [ctx.customerName, ctx.orgName].filter(Boolean).join(' · ') || 'ללא לקוח';

  // ── 1. The summary card — always ──
  const details = buildSummaryDetails({ questions, answers });
  const summary = await createReviewItem({
    kind: TOUR_SUMMARY_KIND,
    // Per SUBMISSION: each guide's summary is its own card, and a re-submit
    // never creates a second one.
    dedupeKey: `${TOUR_SUMMARY_KIND}:${submission.id}`,
    title: `סיכום סיור — ${ctx.guideName || 'מדריך'} · ${party}`,
    summary: summaryHeadline(details),
    data: { ...ctx, details },
    entityRefs,
    tourEventId: ctx.tourEventId || null,
    submissionId: submission.id,
    personRefId: ctx.guidePersonRefId || null,
    dealId: ctx.dealId || null,
    autId,
  }, { db });

  // ── 2. The logistics card — only when something needs attention ──
  const findings = buildLogisticsFindings({ questions, answers, affirmativeOptionValues });
  let logistics = null;
  if (findings.length) {
    logistics = await createReviewItem({
      kind: LOGISTICS_KIND,
      dedupeKey: `${LOGISTICS_KIND}:${submission.id}`,
      title: `דו״ח לוגיסטי — ${ctx.guideName || 'מדריך'} · ${whenLabel(ctx) || ''}`.trim(),
      summary: logisticsHeadline(findings),
      data: { ...ctx, findings },
      entityRefs,
      tourEventId: ctx.tourEventId || null,
      submissionId: submission.id,
      personRefId: ctx.guidePersonRefId || null,
      dealId: ctx.dealId || null,
      autId,
    }, { db });
  }

  return { summary, logistics, findingCount: findings.length };
}
