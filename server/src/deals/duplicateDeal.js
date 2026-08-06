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
//   • Non-primary/archived offers + PRODUCED QuoteDocuments — immutable
//     customer-facing audit of the original. The primary offer's DRAFT is a
//     different thing: it is the working quote, and its persistent presentation
//     overrides ARE commercial preparation, so they travel (see sourceDraft).
//   • noPaymentWaiver — a WON/payment decision about the ORIGINAL's money,
//     never commercial preparation. The copy's valueMinor is corrected back to
//     the full Builder gross (waived value added back) so its total matches
//     its own waiver-free Builder.
import { prisma } from '../db.js';
import { computeWaivedMinor } from './waiver.js';
// The ONE token minter — a copied draft gets its OWN public URL, never the
// original's.
import { newPublicToken } from '../quote/quoteDocument.js';

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
  'discountPercent',
  'discountFixedMinor',
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

// The ONE reusable-notes allowlist — copied timeline entries are EXACTLY the
// notes a human operator typed on the deal (customer context, preparation,
// commercial comments). Everything else on the timeline is history of the
// original and never travels: changelog (kind='change'), system/pinned
// lifecycle notes (actorType='system'), automation notes ('automation'),
// integration notes ('api'), migrated Pipedrive notes ('import'), and
// soft-deleted notes. This is an explicit type/source allowlist — never text
// guessing. Exported for the behavior + shape tests.
export const REUSABLE_NOTE_WHERE = {
  kind: 'note',
  actorType: 'user',
  isSystem: false,
  deletedAt: null,
};

// TimelineEntry fields that transfer onto the copy's note rows (plus the fresh
// subjectId and a provenance marker in data). createdAt is preserved so the
// copied notes keep their honest chronology inside the new deal's feed.
export const NOTE_COPY_FIELDS = [
  'kind',
  'body',
  'isPinned',
  'pinSortOrder',
  'isSystem',
  'actorType',
  'createdBy',
  'createdByName',
  'createdAt',
];

export async function duplicateDeal(sourceDealId, client = prisma) {
  const source = await client.deal.findUnique({
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
    (await client.quoteVersion.findFirst({
      where: { dealId: sourceDealId, isWorking: true },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    })) ||
    (await client.quoteVersion.findFirst({
      where: { dealId: sourceDealId, sourceKind: 'pipedrive_import' },
      orderBy: { createdAt: 'desc' },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    }));

  // The source's WORKING quote draft, for its persistent presentation overrides.
  //
  // What makes this safe is that the persistence decision is STRUCTURAL, not a
  // guess about the text. A section edit saved with "החל שינוי זה גם על גרסאות
  // עתידיות" is written to the draft's `overrideState`; an edit saved without it
  // never reaches the database at all (it rides one produce call as
  // `temporaryOverrideState` and is gone). So copying this row copies exactly
  // the overrides the operator marked as lasting, and cannot copy a one-version
  // edit even in principle — no text comparison is involved anywhere.
  //
  // Only the DRAFT is read. Produced versions are immutable customer documents
  // belonging to the original deal; none of their numbers, tokens or frozen
  // snapshots may follow a copy.
  const sourceDraft = sourceVersion
    ? await client.quoteDocument.findFirst({
        where: { dealId: sourceDealId, status: 'draft' },
        orderBy: { createdAt: 'desc' },
        select: { language: true, overrideState: true, displayProductName: true },
      })
    : null;

  // Reusable operator-authored notes (see REUSABLE_NOTE_WHERE). Read before
  // the write transaction — pure reads of the source deal.
  const reusableNotes = await client.timelineEntry.findMany({
    where: { subjectType: 'deal', subjectId: sourceDealId, ...REUSABLE_NOTE_WHERE },
    orderBy: { createdAt: 'asc' },
  });

  const firstStage = await client.dealStage.findFirst({
    orderBy: { sortOrder: 'asc' },
    select: { id: true },
  });
  if (!firstStage) return { error: 'no_stages' };

  const data = { title: `${source.title} (עותק)`, dealStageId: firstStage.id, status: 'open' };
  // Null values are skipped — every copied field is nullable-with-null-default
  // (or non-null anyway), and Prisma rejects a plain JS null on nullable Json
  // columns — it wants DbNull, which "not sent" also means.
  for (const f of COPY_SCALARS) {
    if (source[f] !== null && source[f] !== undefined) data[f] = source[f];
  }

  // The original's no-payment waiver does NOT copy (it is a payment decision
  // about the original's money), so the copy's payable total must be the full
  // Builder gross again: add the waived value (computed from the source's own
  // waiver against the copied lines) back onto valueMinor.
  if (source.noPaymentWaiver && sourceVersion) {
    const groupLines = sourceVersion.lines
      .filter((l) => l.sourceKind === 'group_ticket' && l.active)
      .map((l) => ({
        cardGroupId: l.sourceCardGroupId || null,
        ticketTypeId: l.ticketTypeId || null,
        quantity: l.quantity || 0,
        unitPriceMinor: Number(l.unitPriceMinor) || 0,
      }));
    const waivedMinor = computeWaivedMinor(source.noPaymentWaiver, groupLines);
    if (waivedMinor > 0) data.valueMinor = BigInt(source.valueMinor) + BigInt(waivedMinor);
  }

  const created = await client.$transaction(async (tx) => {
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
          // Deal-discount INTENT rides with its resolved line (in LINE_FIELDS
          // via the copied sourceKind='deal_discount' row) — the copy's summary
          // row must round-trip the same mode+value.
          dealDiscountPercent: sourceVersion.dealDiscountPercent,
          dealDiscountFixedMinor: sourceVersion.dealDiscountFixedMinor,
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

      // The copy's own working quote draft, seeded with the source's PERSISTENT
      // presentation overrides. Without this a duplicate silently lost every
      // "keep for the next version" edit and re-rendered the template defaults —
      // the whole point of duplicating a deal is that its commercial shape comes
      // with it.
      //
      // Independent row, independent id, its OWN fresh publicToken: editing the
      // copy can never reach back into the source, and the copy's URL is not the
      // original's. No versionNo, no producedAt, no renderModelSnapshot — the
      // copy starts at "never issued", which is the truth about it.
      if (sourceDraft && (sourceDraft.overrideState || sourceDraft.displayProductName)) {
        await tx.quoteDocument.create({
          data: {
            dealId: deal.id,
            quoteVersionId: version.id,
            offerId: offer.id,
            status: 'draft',
            language: sourceDraft.language || 'he',
            publicToken: newPublicToken(),
            ...(sourceDraft.overrideState ? { overrideState: sourceDraft.overrideState } : {}),
            ...(sourceDraft.displayProductName
              ? { displayProductName: sourceDraft.displayProductName }
              : {}),
          },
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

    if (reusableNotes.length) {
      await tx.timelineEntry.createMany({
        data: reusableNotes.map((n) => {
          const row = { subjectType: 'deal', subjectId: deal.id };
          for (const f of NOTE_COPY_FIELDS) row[f] = n[f];
          // Provenance marker on top of the note's own data (e.g. origin:
          // 'inquiry' survives) — the copy never pretends the note was written
          // here. Comments are conversation history and do NOT travel.
          row.data = { ...(n.data && typeof n.data === 'object' ? n.data : {}), copiedFromDealId: sourceDealId };
          return row;
        }),
      });
    }

    return deal;
  });

  return { dealId: created.id };
}
