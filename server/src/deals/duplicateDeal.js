// Duplicate Deal — "create another very similar deal", server-side and
// transactional. The copy is a COMMERCIAL TEMPLATE of the original: everything
// an operator would re-enter to prepare the same deal again is copied
// (classification, contacts, product/tour context, dates, the working Builder,
// notes, planning, confirmation prep); NOTHING of the original's executed
// lifecycle comes along (payments, accounting documents, collection state,
// WON/LOST audit, bookings/registrations, timeline, communications, files,
// tasks). A WON/LOST original always duplicates into a fresh OPEN deal at the
// FIRST pipeline stage — the copy behaves as though it had just been prepared
// from scratch using the original as its template.
//
// Deliberate non-copies beyond the lifecycle list:
//   • orderNo / paymentToken — DB-owned identity, always fresh.
//   • DealMarketing — attribution of the ORIGINAL lead, never of a manual copy.
//   • reservationGroup — provenance; the copy did not come from that reservation.
//   • Tasks — the copy gets its own auto "שיחה ראשונית" like any new deal
//     (the caller fires ensureInitialCallTask post-commit).
//   • Non-primary/archived offers + produced QuoteDocuments — immutable
//     customer-facing audit of the original.
import { prisma } from '../db.js';

// Editable commercial scalars — the template. Lifecycle fields (status, stage,
// won*/lost*, review/collection state, viewed/activity stamps) are explicitly
// NOT here. Exported for the prismaShape contract test (fake-db blind spot).
export const COPY_SCALARS = [
  'groupName',
  'organizationId',
  'organizationUnitId',
  'organizationSubtypeId',
  'activityType',
  'organizationTypeId',
  'productId',
  'productVariantId',
  'locationId',
  'valueMinor',
  'currency',
  'discountMinor',
  'noPaymentWaiver',
  'paymentTermId',
  'paymentMethodId',
  'dealSourceId',
  'source',
  'ownerUserId',
  'expectedCloseDate',
  'notes',
  'tourDate',
  'tourTime',
  'participants',
  'groups',
  'durationHours',
  'communicationLanguage',
  'tourLanguage',
  'customerInfo',
  'quoteEmailIntro',
  'basePriceOverridden',
];

// QuoteLine fields that transfer verbatim onto the copy's working version.
export const LINE_FIELDS = [
  'kind',
  'label',
  'productVariantId',
  'addonId',
  'quantity',
  'unitPriceMinor',
  'vatMode',
  'vatRate',
  'active',
  'note',
  'overridden',
  'sourceKind',
  'sourceCardGroupId',
  'pinnedCardGroupId',
  'ticketTypeId',
  'sortOrder',
];

export async function duplicateDeal(sourceDealId) {
  const source = await prisma.deal.findUnique({
    where: { id: sourceDealId },
    include: {
      contacts: true,
      confirmation: true,
      tourPlan: { include: { assignments: true, activityComponents: true } },
    },
  });
  if (!source) return { error: 'not_found' };

  // The Builder to copy: the working version (the live commercial truth). A
  // migrated deal that never started editing has only a frozen import — copy
  // THAT as the new deal's WORKING version: on a copy it is a starting point,
  // not historical evidence (the original's frozen record stays untouched).
  const sourceVersion =
    (await prisma.quoteVersion.findFirst({
      where: { dealId: sourceDealId, isWorking: true },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    })) ||
    (await prisma.quoteVersion.findFirst({
      where: { dealId: sourceDealId, sourceKind: 'pipedrive_import' },
      orderBy: { createdAt: 'desc' },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    }));

  const firstStage = await prisma.dealStage.findFirst({
    orderBy: { sortOrder: 'asc' },
    select: { id: true },
  });
  if (!firstStage) return { error: 'no_stages' };

  const data = { title: `${source.title} (עותק)`, dealStageId: firstStage.id, status: 'open' };
  // Null values are skipped — every copied field is nullable-with-null-default
  // (or non-null anyway), and Prisma rejects a plain JS null on nullable Json
  // columns (noPaymentWaiver) — it wants DbNull, which "not sent" also means.
  for (const f of COPY_SCALARS) {
    if (source[f] !== null && source[f] !== undefined) data[f] = source[f];
  }

  const created = await prisma.$transaction(async (tx) => {
    const deal = await tx.deal.create({ data, select: { id: true } });

    if (source.contacts.length) {
      await tx.dealContact.createMany({
        data: source.contacts.map((c) => ({
          dealId: deal.id,
          contactId: c.contactId,
          roles: c.roles,
          isPrimary: c.isPrimary,
          receiveConfirmations: c.receiveConfirmations,
          receiveOperationalUpdates: c.receiveOperationalUpdates,
          receivePaymentLinks: c.receivePaymentLinks,
          receiveQuotes: c.receiveQuotes,
        })),
      });
    }

    if (sourceVersion) {
      const offer = await tx.quoteOffer.create({
        data: { dealId: deal.id, offerNo: 1, isPrimary: true, contextMode: 'deal' },
      });
      const version = await tx.quoteVersion.create({
        data: {
          dealId: deal.id,
          offerId: offer.id,
          isWorking: true,
          status: 'draft',
          vatMode: sourceVersion.vatMode,
        },
      });
      if (sourceVersion.lines.length) {
        await tx.quoteLine.createMany({
          data: sourceVersion.lines.map((l) => {
            const row = { quoteVersionId: version.id };
            for (const f of LINE_FIELDS) row[f] = l[f];
            return row;
          }),
        });
      }
    }

    if (source.tourPlan) {
      const plan = await tx.dealTourPlan.create({
        data: {
          dealId: deal.id,
          notes: source.tourPlan.notes,
          componentsCustomized: source.tourPlan.componentsCustomized,
        },
      });
      if (source.tourPlan.assignments.length) {
        await tx.dealTourPlanAssignment.createMany({
          data: source.tourPlan.assignments.map((a) => ({
            planId: plan.id,
            personRefId: a.personRefId,
            externalPersonId: a.externalPersonId,
            displayName: a.displayName,
            role: a.role,
            notes: a.notes,
          })),
        });
      }
      if (source.tourPlan.activityComponents.length) {
        await tx.dealTourPlanActivityComponent.createMany({
          data: source.tourPlan.activityComponents.map((c) => ({
            planId: plan.id,
            activityComponentId: c.activityComponentId,
            workshopLocationId: c.workshopLocationId,
            sortOrder: c.sortOrder,
          })),
        });
      }
    }

    if (source.confirmation) {
      const conf = { dealId: deal.id };
      if (source.confirmation.fillers !== null) conf.fillers = source.confirmation.fillers;
      if (source.confirmation.overrideState !== null) conf.overrideState = source.confirmation.overrideState;
      await tx.dealConfirmation.create({ data: conf });
    }

    return deal;
  });

  return { dealId: created.id };
}
