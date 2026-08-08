// THE canonical multi-deal payment allocation service.
//
// One real payment may settle several deals. GOS models that with ONE row per
// (payment × deal) in whichever table already owns that payment —
// `IcountDocument` for provider documents, `DealCollectionEvidence` for manual
// / gateway money — never a second copy of the money and never a parallel
// "payments" concept. The rows of one payment are tied together by
// `allocationGroupId`, and each row's `allocationMinor` is what THAT deal
// counts.
//
// ── Why this module exists ───────────────────────────────────────────────────
// The mechanism predates it: the migration's consolidated receipts already used
// `allocationMinor`, and collection.js already understood them. What did not
// exist was a way for an OPERATOR to create one, an audit trail for changing
// one, or the same behaviour for manual evidence. All three live here, once,
// so a bank transfer split across three deals and an iCount receipt split
// across three deals obey identical rules.
//
// ── The rules, in order of importance ────────────────────────────────────────
//  1. ALLOCATION IS NOT PAYMENT. `amountMinor` on every row of a group is the
//     REAL money; only `allocationMinor` differs. Company totals dedupe by the
//     group and count the real money once (collection.js). Over-allocating can
//     therefore never invent revenue.
//  2. OVER-ALLOCATION IS ALLOWED (owner ruling, 2026-08-08). GOS does not block
//     an operator mid-reconciliation. It records the discrepancy, shows it, and
//     raises a review card that auto-resolves when the numbers meet.
//  3. THE PROVIDER DOCUMENT IS NEVER TOUCHED. Re-allocating is an INTERNAL
//     correction: no doc/create, no cancellation, no edit at iCount. When a
//     change would really require altering the accounting document, the caller
//     is told so and stops.
//  4. IDEMPOTENT. Every row is addressed by (group, deal); applying the same
//     plan twice converges instead of duplicating.
//  5. N DEALS. Nothing here — schema, math or API — knows the number two.

import {
  reconcileAllocations,
  isMultiDeal,
  ALLOCATION_TOLERANCE_MINOR,
} from '../../../shared/paymentAllocation.mjs';
import { emitTimelineEvent, systemOrigin, userOrigin } from '../timeline/events.js';
import { createReviewItem, handleReviewItem } from '../reviewItems/service.js';
import { PAYMENT_ALLOCATION_REVIEW_KIND } from '../reviewItems/kinds/paymentAllocationReview.js';

export { reconcileAllocations, ALLOCATION_TOLERANCE_MINOR };

export const SOURCE_KINDS = Object.freeze({
  DOCUMENT: 'icount_document',
  EVIDENCE: 'collection_evidence',
});

const ILS = (minor) => `₪${(Math.abs(Number(minor)) / 100).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;

function codedError(code, detail) {
  const err = new Error(detail ? `${code}: ${detail}` : code);
  err.code = code;
  if (detail) err.detail = detail;
  return err;
}

const big = (v) => (v === null || v === undefined ? null : BigInt(Math.round(Number(v))));
const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Stable group identity for a provider document: its provider identity. */
export const documentGroupId = (doctype, docnum) => `doc:${doctype}:${docnum}`;
/** Group identity for money that has no provider document behind it. */
export const evidenceGroupId = (seed) => `pay:${seed}`;

// The per-deal row key. UNIQUE per table, which is what makes a retried apply
// converge on the same rows rather than minting a second allocation.
const rowKey = (groupId, dealId) => `alloc:${groupId}:${dealId}`;

// ─────────────────────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────────────────────

const DEAL_SELECT = {
  id: true,
  orderNo: true,
  title: true,
  status: true,
  valueMinor: true,
  currency: true,
  organizationId: true,
  organization: { select: { id: true, name: true } },
  contacts: {
    where: { isPrimary: true },
    take: 1,
    select: {
      contactId: true,
      contact: { select: { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true } },
    },
  },
};

const contactName = (deal) => {
  const c = deal?.contacts?.[0]?.contact;
  if (!c) return null;
  return (
    `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim()
    || `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim()
    || null
  );
};

/**
 * Load one payment group: the real money, every deal it is allocated to, and
 * the reconciliation state. Works for either physical table — the caller does
 * not need to know which one holds the payment.
 */
export async function loadAllocationGroup(prisma, groupId) {
  const [docs, evidence] = await Promise.all([
    prisma.icountDocument.findMany({ where: { allocationGroupId: groupId } }),
    prisma.dealCollectionEvidence.findMany({ where: { allocationGroupId: groupId } }),
  ]);
  const rows = docs.length ? docs : evidence;
  if (!rows.length) return null;
  const sourceKind = docs.length ? SOURCE_KINDS.DOCUMENT : SOURCE_KINDS.EVIDENCE;

  // Every row of a group carries the SAME real amount — that is the invariant.
  // Reading the max rather than the first makes a partially-written group (a
  // crash mid-apply) report the real money instead of a share.
  const realMinor = rows.reduce((m, r) => Math.max(m, Math.abs(Number(r.amountMinor))), 0);
  const active = rows.filter((r) => (sourceKind === SOURCE_KINDS.DOCUMENT ? r.status !== 'cancelled' : r.status === 'active'));

  // A deal later retired by a merge keeps its allocation: it really happened,
  // and hiding the row would make the group's shares stop adding up.
  // merge-lineage-query: id-scoped read of already-allocated deals.
  const deals = await prisma.deal.findMany({
    where: { id: { in: [...new Set(active.map((r) => r.dealId))] } },
    select: DEAL_SELECT,
  });
  const dealById = new Map(deals.map((d) => [d.id, d]));

  const allocations = active.map((r) => {
    const deal = dealById.get(r.dealId) || null;
    return {
      rowId: r.id,
      dealId: r.dealId,
      orderNo: deal?.orderNo ?? null,
      dealTitle: deal?.title ?? null,
      dealStatus: deal?.status ?? null,
      dealTotalMinor: deal ? Number(deal.valueMinor) : null,
      contactName: contactName(deal),
      organizationId: deal?.organizationId ?? null,
      organizationName: deal?.organization?.name ?? null,
      // NULL allocationMinor on a MULTI-row group would be a bug; on a
      // single-row group it is the ordinary "this deal gets all of it".
      amountMinor: r.allocationMinor != null ? Math.abs(Number(r.allocationMinor)) : realMinor,
      explicit: r.allocationMinor != null,
      allocationSource: r.allocationSource || null,
      allocationNote: r.allocationNote || null,
      allocatedByName: r.allocatedByName || null,
      allocatedAt: r.allocatedAt || null,
    };
  });

  const head = rows[0];
  return {
    groupId,
    sourceKind,
    currency: head.currency || 'ILS',
    doctype: head.doctype || null,
    docnum: head.docnum || null,
    docUrl: head.docUrl || null,
    issuedAt: head.issuedAt || head.paidAt || head.createdAt || null,
    paymentProvider: head.paymentProvider || null,
    paymentTransactionId: head.paymentTransactionId || null,
    paymentApprovalCode: head.paymentApprovalCode || null,
    allocations,
    ...reconcileAllocations(realMinor, allocations),
  };
}

/**
 * The allocation context for ONE deal's collection panel: for every payment row
 * that is split, what this deal counts and where the rest of the money went.
 * Read-only projection — the numbers themselves stay computeCollection's.
 */
export async function allocationsForDeal(prisma, dealId) {
  const [docs, evidence] = await Promise.all([
    prisma.icountDocument.findMany({
      where: { dealId, allocationGroupId: { not: null } },
      select: { allocationGroupId: true },
    }),
    prisma.dealCollectionEvidence.findMany({
      where: { dealId, allocationGroupId: { not: null } },
      select: { allocationGroupId: true },
    }),
  ]);
  const groupIds = [...new Set([...docs, ...evidence].map((r) => r.allocationGroupId))];
  const groups = await Promise.all(groupIds.map((g) => loadAllocationGroup(prisma, g)));
  return groups
    .filter(Boolean)
    .filter((g) => g.allocations.length > 1 || g.state !== 'balanced')
    .map((g) => ({
      ...g,
      thisDealMinor: g.allocations.find((a) => a.dealId === dealId)?.amountMinor ?? 0,
      otherAllocations: g.allocations.filter((a) => a.dealId !== dealId),
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Writing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate an allocation plan. Deliberately does NOT reject an over-allocation
 * (owner ruling): the only hard errors are structurally impossible plans.
 *
 * @param plan [{ dealId, amountMinor }]
 */
export function validatePlan(plan) {
  const rows = (plan || []).map((a) => ({
    dealId: String(a?.dealId || ''),
    amountMinor: Math.round(Number(a?.amountMinor ?? 0)),
  }));
  if (!rows.length) throw codedError('allocation_empty');
  if (rows.some((a) => !a.dealId)) throw codedError('allocation_deal_missing');
  if (rows.some((a) => !Number.isFinite(a.amountMinor) || a.amountMinor < 0)) {
    throw codedError('allocation_amount_invalid');
  }
  const seen = new Set();
  for (const a of rows) {
    if (seen.has(a.dealId)) throw codedError('allocation_deal_duplicate', a.dealId);
    seen.add(a.dealId);
  }
  return rows;
}

/**
 * Do the deals in this plan belong to different customers? Never a block —
 * the API requires an explicit `confirmCrossCustomer` acknowledgement instead,
 * because one company legitimately pays for several people's bookings.
 */
export async function crossCustomerCheck(prisma, dealIds) {
  // The PICKER excludes retired deals; this read must describe whatever it is
  // handed rather than drop a row and report "same customer" by omission.
  // merge-lineage-query: id-scoped read of the exact deals the operator picked.
  const deals = await prisma.deal.findMany({
    where: { id: { in: dealIds } },
    select: {
      id: true, orderNo: true, title: true, organizationId: true,
      organization: { select: { name: true } },
      contacts: { where: { isPrimary: true }, take: 1, select: { contactId: true } },
    },
  });
  const orgs = new Set(deals.map((d) => d.organizationId).filter(Boolean));
  const contacts = new Set(deals.map((d) => d.contacts[0]?.contactId).filter(Boolean));
  // Same organization is the strongest "same customer" signal there is; only
  // when there is no shared organization do the contacts have to agree.
  const sameOrg = orgs.size === 1 && deals.every((d) => d.organizationId);
  const sameContact = contacts.size <= 1;
  const cross = !sameOrg && !sameContact;
  return {
    cross,
    deals: deals.map((d) => ({
      dealId: d.id,
      orderNo: d.orderNo,
      organizationName: d.organization?.name || null,
      contactId: d.contacts[0]?.contactId || null,
    })),
  };
}

// Fields every row of a document group repeats, so a sibling row is a faithful
// copy of the SAME document rather than a lookalike. Deliberately explicit:
// silently spreading the source row would also copy its idempotencyKey.
function documentSiblingData(source, { dealId, groupId, allocationMinor, actor, note }) {
  return {
    dealId,
    provider: source.provider,
    source: source.source,
    doctype: source.doctype,
    docnum: source.docnum,
    providerDocId: source.providerDocId,
    status: source.status,
    amountMinor: source.amountMinor,
    currency: source.currency,
    clientName: source.clientName,
    clientVatId: source.clientVatId,
    docUrl: source.docUrl,
    basedOnDoctype: source.basedOnDoctype,
    basedOnDocnum: source.basedOnDocnum,
    basedOnDocs: source.basedOnDocs ?? undefined,
    issuedAt: source.issuedAt,
    paidMinor: source.paidMinor,
    paymentProvider: source.paymentProvider,
    paymentTransactionId: source.paymentTransactionId,
    paymentApprovalCode: source.paymentApprovalCode,
    paymentMeta: source.paymentMeta ?? undefined,
    idempotencyKey: rowKey(groupId, dealId),
    issuedBy: source.issuedBy,
    linkConfidence: 'allocation',
    linkReason: note || 'שויך כחלק מתשלום שמכסה כמה עסקאות',
    allocationGroupId: groupId,
    allocationMinor: big(allocationMinor),
    allocationSource: actor.type === 'system' ? 'system' : 'operator',
    allocationNote: note || null,
    allocatedBy: actor.id || null,
    allocatedByName: actor.name || null,
    allocatedAt: new Date(),
  };
}

function evidenceSiblingData(source, { dealId, groupId, allocationMinor, actor, note }) {
  return {
    dealId,
    kind: source.kind,
    direction: source.direction,
    amountMinor: source.amountMinor,
    currency: source.currency,
    paidAt: source.paidAt,
    method: source.method,
    reference: source.reference,
    note: source.note,
    fileId: null, // a DealFile belongs to ONE deal — never re-pointed
    status: 'active',
    origin: source.origin,
    createdBy: actor.id || null,
    createdByName: actor.name || null,
    paymentProvider: source.paymentProvider,
    paymentTransactionId: source.paymentTransactionId,
    paymentApprovalCode: source.paymentApprovalCode,
    paymentMeta: source.paymentMeta ?? undefined,
    allocationGroupId: groupId,
    allocationMinor: big(allocationMinor),
    allocationSource: actor.type === 'system' ? 'system' : 'operator',
    allocationNote: note || null,
    allocatedBy: actor.id || null,
    allocatedByName: actor.name || null,
    allocatedAt: new Date(),
  };
}

/**
 * Apply an allocation plan to an existing payment — the ONE write path, used
 * for the first split, for adding a deal later, and for correcting amounts.
 *
 * Every row is upserted by (group, deal): deals in the plan are created or
 * updated, deals no longer in the plan are REMOVED from the group. Removal
 * deletes only sibling rows this service created; the payment's ORIGIN row
 * (the deal the document was issued against) is never deleted — dropping it
 * would orphan the accounting document from the order it was issued for.
 *
 * @param tx      a Prisma client or transaction client
 * @param groupId the payment group
 * @param plan    [{ dealId, amountMinor }] — the COMPLETE desired state
 * @param actor   { type:'user'|'system', id, name }
 * @param reason  free text stored on every audit row
 */
export async function applyAllocations(tx, { groupId, plan, actor, reason = null, originDealId = null }) {
  const rows = validatePlan(plan);
  const table = await resolveGroupTable(tx, groupId);
  if (!table) throw codedError('allocation_group_not_found', groupId);
  const { kind, existing } = table;
  const isDoc = kind === SOURCE_KINDS.DOCUMENT;
  const client = isDoc ? tx.icountDocument : tx.dealCollectionEvidence;

  const source = existing[0];
  const realMinor = existing.reduce((m, r) => Math.max(m, Math.abs(Number(r.amountMinor))), 0);
  const originId = originDealId || source.dealId;
  const byDeal = new Map(existing.map((r) => [r.dealId, r]));
  const wanted = new Map(rows.map((r) => [r.dealId, r.amountMinor]));

  // A deal retired by a merge is not an allocation target: its money is already
  // read through the survivor's lineage, so crediting it would settle the same
  // balance twice. Deals already IN the group are exempt — a merge that happens
  // after an allocation must not make the existing split unsaveable.
  const incoming = rows.map((r) => r.dealId).filter((id) => !byDeal.has(id));
  if (incoming.length) {
    // merge-lineage-query: this IS the retired-deal check — it deliberately
    // looks for exactly the rows activeDealWhere would hide.
    const retired = await tx.deal.findMany({
      where: { id: { in: incoming }, mergedIntoDealId: { not: null } },
      select: { id: true, orderNo: true, mergedIntoDealId: true },
    });
    if (retired.length) {
      throw codedError('allocation_deal_retired', retired.map((d) => `#${d.orderNo}`).join(', '));
    }
  }

  const audits = [];
  // NULL allocationMinor means "this payment was never split" — so the audit
  // reads `allocated: — → ₪1,000` rather than a fictional "was ₪1,500", which
  // is what a row that had no share at all would otherwise claim.
  const before = new Map(
    existing.map((r) => [r.dealId, r.allocationMinor != null ? Number(r.allocationMinor) : null]),
  );

  // 1. Upsert every deal in the plan.
  for (const { dealId, amountMinor } of rows) {
    const current = byDeal.get(dealId);
    if (current) {
      if (Number(current.allocationMinor ?? -1) === amountMinor) continue; // no-op
      await client.update({
        where: { id: current.id },
        data: {
          allocationMinor: big(amountMinor),
          allocationGroupId: groupId,
          allocationSource: actor.type === 'system' ? 'system' : 'operator',
          allocationNote: reason || current.allocationNote || null,
          allocatedBy: actor.id || null,
          allocatedByName: actor.name || null,
          allocatedAt: new Date(),
          ...(isDoc ? { sharedHistorical: rows.length > 1 } : {}),
        },
      });
      const prev = before.get(dealId) ?? null;
      audits.push({ dealId, action: prev === null ? 'allocated' : 'reallocated', previous: prev, next: amountMinor });
    } else {
      const data = isDoc
        ? documentSiblingData(source, { dealId, groupId, allocationMinor: amountMinor, actor, note: reason })
        : evidenceSiblingData(source, { dealId, groupId, allocationMinor: amountMinor, actor, note: reason });
      if (isDoc) data.sharedHistorical = rows.length > 1;
      try {
        await client.create({ data });
      } catch (err) {
        // A concurrent apply already created this exact row (unique on
        // (group, deal)) — converge on it instead of failing the operator.
        if (err?.code !== 'P2002') throw err;
        const winner = await client.findFirst({ where: { allocationGroupId: groupId, dealId } });
        if (!winner) throw err;
        await client.update({ where: { id: winner.id }, data: { allocationMinor: big(amountMinor) } });
      }
      audits.push({ dealId, action: 'allocated', previous: null, next: amountMinor });
    }
  }

  // 2. Remove deals dropped from the plan (never the origin row).
  for (const row of existing) {
    if (wanted.has(row.dealId)) continue;
    if (row.dealId === originId) {
      throw codedError('allocation_origin_required', row.dealId);
    }
    await client.delete({ where: { id: row.id } });
    audits.push({ dealId: row.dealId, action: 'removed', previous: before.get(row.dealId) ?? null, next: null });
  }

  // 3. A group that is back to ONE deal is no longer a split: clear the
  //    per-deal share so the row means "this deal's money" again, exactly as it
  //    did before anyone allocated it.
  if (rows.length === 1) {
    const only = await client.findFirst({ where: { allocationGroupId: groupId, dealId: rows[0].dealId } });
    if (only && Math.abs(Number(rows[0].amountMinor) - realMinor) <= ALLOCATION_TOLERANCE_MINOR) {
      await client.update({
        where: { id: only.id },
        data: { allocationMinor: null, ...(isDoc ? { sharedHistorical: false } : {}) },
      });
    }
  }

  const state = reconcileAllocations(realMinor, rows.map((r) => ({ dealId: r.dealId, amountMinor: r.amountMinor })));

  // 4. Audit — one row per DEAL that changed, never one per apply, so the
  //    history reads as "what happened to this deal's share".
  // An audit entry about a deal that was later retired must still carry its
  // order number — that is the whole point of an audit.
  // merge-lineage-query: id-scoped label lookup for the audit rows.
  const orderNos = await tx.deal.findMany({
    where: { id: { in: audits.map((a) => a.dealId) } },
    select: { id: true, orderNo: true },
  });
  const orderNoById = new Map(orderNos.map((d) => [d.id, d.orderNo]));
  for (const a of audits) {
    await tx.paymentAllocationEvent.create({
      data: {
        sourceKind: kind,
        allocationGroupId: groupId,
        doctype: source.doctype || null,
        docnum: source.docnum || null,
        sourceAmountMinor: big(realMinor),
        action: a.action,
        dealId: a.dealId,
        orderNo: orderNoById.get(a.dealId) ?? null,
        previousMinor: big(a.previous),
        nextMinor: big(a.next),
        currency: source.currency || 'ILS',
        allocatedTotalMinor: big(state.allocatedMinor),
        unallocatedMinor: big(state.unallocatedMinor),
        overAllocatedMinor: big(state.overAllocatedMinor),
        reason: reason || null,
        actorType: actor.type || 'user',
        actorId: actor.id || null,
        actorName: actor.name || null,
      },
    });
  }

  return { groupId, sourceKind: kind, realMinor, audits, ...state };
}

async function resolveGroupTable(tx, groupId) {
  const docs = await tx.icountDocument.findMany({ where: { allocationGroupId: groupId } });
  if (docs.length) return { kind: SOURCE_KINDS.DOCUMENT, existing: docs };
  const ev = await tx.dealCollectionEvidence.findMany({ where: { allocationGroupId: groupId } });
  if (ev.length) return { kind: SOURCE_KINDS.EVIDENCE, existing: ev };
  return null;
}

/**
 * Adopt a payment that has no group yet (every historical single-deal row) so
 * it can be allocated. Idempotent: a row that already has a group keeps it.
 */
export async function ensureGroup(tx, { sourceKind, rowId }) {
  const client = sourceKind === SOURCE_KINDS.DOCUMENT ? tx.icountDocument : tx.dealCollectionEvidence;
  const row = await client.findUnique({ where: { id: rowId } });
  if (!row) throw codedError('payment_row_not_found', rowId);
  if (row.allocationGroupId) return { groupId: row.allocationGroupId, row };
  const groupId = sourceKind === SOURCE_KINDS.DOCUMENT && row.docnum
    ? documentGroupId(row.doctype, row.docnum)
    : evidenceGroupId(row.id);
  const updated = await client.update({ where: { id: row.id }, data: { allocationGroupId: groupId } });
  return { groupId, row: updated };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation review + timeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Keep EXACTLY ONE review card per payment, matching its current state.
 *
 * Balanced → the card is handled (auto-resolve). Unbalanced → the card exists
 * and its text says which way. Deliberately keyed on the group alone, so an
 * over-allocation that later becomes an under-allocation updates one card
 * rather than leaving two.
 */
export async function syncAllocationReview(prisma, groupId, { db = prisma } = {}) {
  const group = await loadAllocationGroup(db, groupId);
  if (!group) return { changed: false };
  const dedupeKey = `payment_allocation:${groupId}`;
  const existing = await db.reviewItem.findUnique({ where: { dedupeKey } });

  if (group.balanced || group.state === 'empty') {
    if (existing && existing.status === 'open') {
      await handleReviewItem(existing.id, { userName: 'מערכת' }, { db });
      return { changed: true, resolved: true };
    }
    return { changed: false };
  }

  const docRef = group.docnum ? ` ${group.docnum}` : '';
  const over = group.state === 'over';
  const title = over
    ? `שויך יותר מהתשלום — ${ILS(group.overAllocatedMinor)} עודף${docRef}`
    : `נותרו ${ILS(group.unallocatedMinor)} שלא שויכו${docRef}`;
  const summary = over
    ? `התשלום בפועל ${ILS(group.realMinor)}, אך שויכו לעסקאות ${ILS(group.allocatedMinor)}. `
      + `ההפרש ${ILS(group.overAllocatedMinor)} אינו כסף שהתקבל — יש לתקן את השיוך.`
    : `מתוך תשלום של ${ILS(group.realMinor)} שויכו ${ILS(group.allocatedMinor)}. `
      + `${ILS(group.unallocatedMinor)} עדיין לא שויכו לאף עסקה.`;

  const data = {
    allocationGroupId: groupId,
    code: over ? 'over_allocated' : 'unallocated',
    realMinor: group.realMinor,
    allocatedMinor: group.allocatedMinor,
    unallocatedMinor: group.unallocatedMinor,
    overAllocatedMinor: group.overAllocatedMinor,
    currency: group.currency,
    doctype: group.doctype,
    docnum: group.docnum,
    deals: group.allocations.map((a) => ({ dealId: a.dealId, orderNo: a.orderNo, amountMinor: a.amountMinor })),
  };
  const entityRefs = group.allocations.map((a) => ({
    type: 'deal', id: a.dealId, label: a.contactName || a.dealTitle || null, orderNo: a.orderNo,
  }));

  if (existing) {
    // One card, kept current — including re-opening it if the discrepancy
    // came back after someone marked it handled.
    await db.reviewItem.update({
      where: { id: existing.id },
      data: {
        title, summary, data, entityRefs,
        status: 'open', handledAt: null, handledBy: null, handledByName: null,
      },
    });
    return { changed: true, updated: true };
  }
  await createReviewItem(
    {
      kind: PAYMENT_ALLOCATION_REVIEW_KIND,
      dedupeKey,
      title,
      summary,
      data,
      entityRefs,
      dealId: group.allocations[0]?.dealId || null,
    },
    { db },
  );
  return { changed: true, created: true };
}

/**
 * The truthful per-deal timeline line. Each deal is told what REALLY arrived
 * and what part of it is its own — never "₪3,000 received" three times.
 */
export async function emitAllocationTimeline(tx, group, { actor, reason = null }) {
  if (!isMultiDeal(group.allocations)) return;
  const origin = actor?.type === 'system' ? systemOrigin() : await userOrigin(actor?.id || null);
  for (const a of group.allocations) {
    await emitTimelineEvent(tx, {
      subjectType: 'deal',
      subjectId: a.dealId,
      kind: 'accounting',
      data: {
        event: 'payment_allocated',
        allocationGroupId: group.groupId,
        doctype: group.doctype,
        docnum: group.docnum,
        docUrl: group.docUrl,
        // The REAL money, said once and identically on every deal.
        paymentTotalIls: group.realMinor / 100,
        // This deal's share — the only number that differs between the rows.
        allocatedToThisDealIls: a.amountMinor / 100,
        currency: group.currency,
        otherAllocations: group.allocations
          .filter((o) => o.dealId !== a.dealId)
          .map((o) => ({ orderNo: o.orderNo, amountIls: o.amountMinor / 100 })),
        unallocatedIls: group.unallocatedMinor / 100,
        overAllocatedIls: group.overAllocatedMinor / 100,
        reason,
      },
      origin,
    });
  }
}
