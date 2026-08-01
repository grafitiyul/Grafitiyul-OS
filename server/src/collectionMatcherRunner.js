import {
  normName, normTaxId, buildCandidates, assignTiers, detectSharedDocument,
} from './collectionMatcher.js';
import { dealDocumentKey } from './icountDocs.js';
import { emitTimelineEvent } from './timeline/events.js';

// Second-stage matching — ORCHESTRATION.
//
// Reads only the LOCAL iCount ledger mirror and GOS. It makes ZERO iCount API
// calls: the census already holds every document in the account, so a second
// pass over the same data costs nothing but database time.
//
// `prisma` is injected, so the run can be driven from the CLI or a test double.
//
// Three phases:
//   buildIndexes()  identity lookups, including the map LEARNED from stage-1
//   planStage2()    decide — Tier A / shared / Tier B / Tier C. Writes nothing.
//   applyStage2()   persist links, allocations and the review queue. Idempotent.

const defaultLog = { log: console.log, warn: console.warn, error: console.error };
const MONEY_DOCTYPES = ['receipt', 'invrec'];

const customerKeyOrg = (id) => `org:${id}`;
const customerKeyContact = (id) => `contact:${id}`;

const pushKey = (map, key, value) => {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  if (!map.get(key).includes(value)) map.get(key).push(value);
};

/**
 * The identity lookups the matcher needs.
 *
 * The most valuable one is `clientIdToCustomers`, LEARNED from stage-1: every
 * document a deal named itself tells us which GOS customer that iCount client
 * id belongs to. It is the only signal in this system that was proven by
 * evidence the business itself wrote down.
 */
export async function buildIndexes(prisma, log = defaultLog) {
  const [orgs, units, contacts, linked] = await Promise.all([
    prisma.organization.findMany({ select: { id: true, name: true, taxId: true } }),
    prisma.organizationUnit.findMany({ select: { id: true, name: true, taxId: true, organizationId: true } }),
    prisma.contact.findMany({
      select: {
        id: true, firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true, taxId: true,
      },
    }),
    // Stage-1 links joined to their ledger row — the learning set.
    prisma.$queryRawUnsafe(`
      select l."clientId", i."dealId", d."organizationId"
        from "IcountDocument" i
        join "IcountLedgerDoc" l on l.doctype = i.doctype and l.docnum = i.docnum
        join "Deal" d on d.id = i."dealId"
       where l."clientId" is not null and i."linkConfidence" in ('note_typed_number','note_number_series','note_url','operator_link')`),
  ]);

  const nameToCustomers = new Map();
  const taxIdToCustomers = new Map();
  for (const o of orgs) {
    pushKey(nameToCustomers, normName(o.name), customerKeyOrg(o.id));
    if (normTaxId(o.taxId).length >= 8) pushKey(taxIdToCustomers, normTaxId(o.taxId), customerKeyOrg(o.id));
  }
  // A unit's documents belong to its parent organisation for matching purposes.
  for (const u of units) {
    if (u.organizationId) pushKey(nameToCustomers, normName(u.name), customerKeyOrg(u.organizationId));
  }
  for (const c of contacts) {
    for (const n of [`${c.firstNameHe || ''} ${c.lastNameHe || ''}`, `${c.firstNameEn || ''} ${c.lastNameEn || ''}`]) {
      const k = normName(n);
      if (k.length >= 4) pushKey(nameToCustomers, k, customerKeyContact(c.id));
    }
    if (normTaxId(c.taxId).length >= 8) pushKey(taxIdToCustomers, normTaxId(c.taxId), customerKeyContact(c.id));
  }

  // Learned client_id → customer. A client id that stage-1 saw against SEVERAL
  // different organisations is ambiguous and is dropped entirely — a learned
  // signal is only worth having while it is unambiguous.
  const byClient = new Map();
  for (const row of linked) {
    const cid = String(row.clientId);
    if (!byClient.has(cid)) byClient.set(cid, new Set());
    if (row.organizationId) byClient.get(cid).add(customerKeyOrg(row.organizationId));
  }
  const clientIdToCustomers = new Map();
  let dropped = 0;
  for (const [cid, set] of byClient) {
    if (set.size === 1) clientIdToCustomers.set(cid, [...set]);
    else if (set.size > 1) dropped += 1;
  }

  log.log(
    `[stage2] indexes: ${nameToCustomers.size} names, ${taxIdToCustomers.size} tax ids, ` +
    `${clientIdToCustomers.size} learned client ids (${dropped} ambiguous dropped)`,
  );
  return { nameToCustomers, taxIdToCustomers, clientIdToCustomers };
}

/** WON deals that still have NO money evidence, indexed by customer. */
export async function buildDealIndex(prisma, log = defaultLog) {
  const deals = await prisma.deal.findMany({
    where: { status: 'won' },
    select: {
      id: true, orderNo: true, valueMinor: true, currency: true,
      createdAt: true, wonAt: true, tourDate: true, organizationId: true,
      contacts: { select: { contactId: true } },
      icountDocuments: { select: { doctype: true, status: true } },
      collectionEvidence: { where: { status: 'active' }, select: { id: true } },
    },
  });

  const dealsByCustomer = new Map();
  let eligible = 0;
  for (const d of deals) {
    // A deal that already has money evidence is NOT a target: stage-1's explicit
    // references are correct and must never be second-guessed or duplicated.
    const hasMoney =
      d.icountDocuments.some((x) => x.status === 'issued' && MONEY_DOCTYPES.includes(x.doctype)) ||
      d.collectionEvidence.length > 0;
    if (hasMoney) continue;
    eligible += 1;
    const lean = {
      id: d.id, orderNo: d.orderNo, valueMinor: Number(d.valueMinor || 0), currency: d.currency,
      createdAt: d.createdAt, wonAt: d.wonAt, tourDate: d.tourDate,
    };
    if (d.organizationId) pushKey(dealsByCustomer, customerKeyOrg(d.organizationId), lean);
    for (const dc of d.contacts) pushKey(dealsByCustomer, customerKeyContact(dc.contactId), lean);
  }
  log.log(`[stage2] ${eligible} WON deals still without money evidence, across ${dealsByCustomer.size} customer keys`);
  return { dealsByCustomer, eligible };
}

/** Unlinked, non-cancelled, money-recording documents — the target population. */
export async function loadUnlinkedDocuments(prisma, log = defaultLog) {
  const rows = await prisma.$queryRawUnsafe(`
    select l.doctype, l.docnum, l."clientId", l."clientName", l."clientVatId", l.currency,
           l."totalMinor", l."paidMinor", l."issuedAt", l."docUrl"
      from "IcountLedgerDoc" l
     where l.doctype in ('receipt','invrec')
       and not l."isCancelled" and not l."isCancellation"
       and not exists (select 1 from "IcountDocument" i where i.doctype = l.doctype and i.docnum = l.docnum)`);
  log.log(`[stage2] ${rows.length} unlinked money documents to consider`);
  return rows.map((r) => ({
    ...r,
    totalMinor: Number(r.totalMinor),
    paidMinor: r.paidMinor == null ? null : Number(r.paidMinor),
  }));
}

/** Decide everything. Pure with respect to the database — writes nothing. */
export async function planStage2(prisma, { log = defaultLog } = {}) {
  const idx = await buildIndexes(prisma, log);
  const { dealsByCustomer, eligible } = await buildDealIndex(prisma, log);
  const documents = await loadUnlinkedDocuments(prisma, log);

  const docCandidates = new Map();
  const dealCandidates = new Map();
  const shared = [];
  let noIdentity = 0;

  for (const doc of documents) {
    const cands = buildCandidates(doc, idx, { dealsByCustomer });
    if (!cands.length) {
      noIdentity += 1;
      continue;
    }
    const docKey = `${doc.doctype}:${doc.docnum}`;
    const docMoney = Math.abs(doc.paidMinor ?? doc.totalMinor);

    // The owner's cutover ruling, applied only to the arithmetic signature of a
    // consolidated document: the candidate deals' own values SUM to it.
    const sharedHit = detectSharedDocument(docMoney, cands);
    if (sharedHit) {
      shared.push({ doc, docKey, ...sharedHit });
      continue; // handled by the shared path, never queued or auto-linked twice
    }

    docCandidates.set(docKey, cands);
    for (const c of cands) {
      if (!dealCandidates.has(c.dealId)) dealCandidates.set(c.dealId, []);
      dealCandidates.get(c.dealId).push(c);
    }
  }

  const { tierA, tierB: tierBAll } = assignTiers({ docCandidates, dealCandidates });

  // A queue nobody can finish is a queue nobody starts. Each deal keeps only its
  // strongest few candidates and each document only its strongest few deals —
  // the rest stay reachable through `competingDeals`/`competingDocs` on the items
  // that ARE queued, so nothing is hidden, only unstacked.
  const { kept: tierB, droppedPerDeal, droppedPerDoc } = capReviewQueue(tierBAll);

  log.log(
    `[stage2] plan: ${tierA.length} tier-A auto-links, ${shared.length} shared documents ` +
    `(${shared.reduce((s, x) => s + x.deals.length, 0)} deal links), ` +
    `${tierB.length} review items queued from ${tierBAll.length} candidates ` +
    `(${droppedPerDeal} beyond the per-deal cap, ${droppedPerDoc} beyond the per-document cap — still listed as competitors), ` +
    `${noIdentity} documents with no identity match (tier C)`,
  );
  return { tierA, tierB, tierBTotal: tierBAll.length, shared, noIdentity, documents, eligible };
}

const MAX_CANDIDATES_PER_DEAL = 3;
const MAX_DEALS_PER_DOCUMENT = 5;

export function capReviewQueue(items) {
  const byScore = [...items].sort((a, b) => b.score - a.score);
  const perDeal = new Map();
  const perDoc = new Map();
  const kept = [];
  let droppedPerDeal = 0;
  let droppedPerDoc = 0;
  for (const it of byScore) {
    const dKey = it.dealId;
    const docKey = `${it.doctype}:${it.docnum}`;
    if ((perDeal.get(dKey) || 0) >= MAX_CANDIDATES_PER_DEAL) {
      droppedPerDeal += 1;
      continue;
    }
    if ((perDoc.get(docKey) || 0) >= MAX_DEALS_PER_DOCUMENT) {
      droppedPerDoc += 1;
      continue;
    }
    perDeal.set(dKey, (perDeal.get(dKey) || 0) + 1);
    perDoc.set(docKey, (perDoc.get(docKey) || 0) + 1);
    kept.push(it);
  }
  return { kept, droppedPerDeal, droppedPerDoc };
}

// ── Persistence ──────────────────────────────────────────────────────────────

// One place that turns a ledger row + a decision into an IcountDocument link.
// Every stage-2 write goes through it, so provenance is uniform and the
// idempotency key is always the canonical one.
async function linkDocument(prisma, { deal, ledgerDoc, linkConfidence, linkReason, sharedHistorical = false, allocationMinor = null }) {
  const key = dealDocumentKey(deal.dealId ?? deal.id, ledgerDoc.doctype, ledgerDoc.docnum);
  const existing = await prisma.icountDocument.findUnique({ where: { idempotencyKey: key } });
  if (existing) return { row: existing, created: false };
  const row = await prisma.icountDocument.create({
    data: {
      dealId: deal.dealId ?? deal.id,
      source: 'backfill',
      doctype: ledgerDoc.doctype,
      docnum: ledgerDoc.docnum,
      // Magnitude only — direction lives in the doctype (see collection.js).
      amountMinor: BigInt(Math.abs(Number(ledgerDoc.totalMinor))),
      paidMinor: ledgerDoc.paidMinor != null ? BigInt(Math.abs(Number(ledgerDoc.paidMinor))) : null,
      currency: ledgerDoc.currency || 'ILS',
      clientName: ledgerDoc.clientName || 'לקוח',
      clientVatId: ledgerDoc.clientVatId || null,
      docUrl: ledgerDoc.docUrl || null,
      status: 'issued',
      issuedAt: ledgerDoc.issuedAt,
      linkConfidence,
      linkReason,
      sharedHistorical,
      allocationMinor: allocationMinor != null ? BigInt(allocationMinor) : null,
      verifiedAt: new Date(),
      idempotencyKey: key,
    },
  });
  return { row, created: true };
}

// The deal's history entry, dated to the DOCUMENT — never to now. The Deals list
// orders by lastMeaningfulActivityAt, and an undated import would reorder the
// whole CRM (see collectionBackfillRunner).
async function emitLinkEvent(prisma, dealId, rows, extra) {
  await emitTimelineEvent(prisma, {
    subjectType: 'deal',
    subjectId: dealId,
    kind: 'accounting',
    createdAt: rows.reduce((n, r) => (r.issuedAt && (!n || r.issuedAt > n) ? r.issuedAt : n), null) || undefined,
    data: {
      event: 'collection_stage2_link',
      documents: rows.map((r) => ({
        doctype: r.doctype, docnum: r.docnum,
        amountIls: Number(r.amountMinor) / 100,
        allocationIls: r.allocationMinor != null ? Number(r.allocationMinor) / 100 : null,
        sharedHistorical: r.sharedHistorical,
      })),
      ...extra,
    },
    origin: { actorType: 'import', actorLabel: 'התאמת גבייה — שלב ב׳' },
  });
}

export async function applyStage2(prisma, plan, { log = defaultLog } = {}) {
  const stats = { tierALinked: 0, sharedDocuments: 0, sharedLinks: 0, queued: 0, requeued: 0, skipped: 0 };
  const ledgerByKey = new Map(plan.documents.map((d) => [`${d.doctype}:${d.docnum}`, d]));

  // ── Tier A: mutually unique exact matches ─────────────────────────────────
  for (const c of plan.tierA) {
    const ledgerDoc = ledgerByKey.get(`${c.doctype}:${c.docnum}`);
    if (!ledgerDoc) continue;
    const { row, created } = await linkDocument(prisma, {
      deal: { id: c.dealId },
      ledgerDoc,
      linkConfidence: `stage2_${c.basis}`,
      linkReason:
        `שויך אוטומטית בהתאמת שלב ב׳: זהות לקוח (${basisLabel(c.basis)}) + סכום זהה לסכום העסקה ` +
        `+ תאריך תואם, כשגם המסמך וגם העסקה הם המועמד היחיד זה של זה.`,
    });
    if (!created) {
      stats.skipped += 1;
      continue;
    }
    stats.tierALinked += 1;
    await emitLinkEvent(prisma, c.dealId, [row], { tier: 'A', basis: c.basis, score: c.score });
  }

  // ── Shared historical documents (owner ruling) ────────────────────────────
  for (const s of plan.shared) {
    const ledgerDoc = ledgerByKey.get(s.docKey);
    if (!ledgerDoc) continue;
    let linkedAny = false;
    for (const d of s.deals) {
      const { row, created } = await linkDocument(prisma, {
        deal: { id: d.dealId },
        ledgerDoc,
        linkConfidence: 'stage2_shared_historical',
        linkReason:
          `מסמך היסטורי משותף: מסמך אחד בסך ₪${(s.documentMinor / 100).toLocaleString('he-IL')} שסוגר ` +
          `${s.deals.length} עסקאות של אותו לקוח (סכום העסקאות זהה לסכום המסמך). ` +
          `לפי מדיניות המעבר ההיסטורי המסמך משויך לכל העסקאות; בדוחות ברמת החברה הוא נספר פעם אחת בלבד.`,
        sharedHistorical: true,
        // Settles THIS deal by ITS OWN payable total.
        allocationMinor: d.allocationMinor,
      });
      if (!created) continue;
      linkedAny = true;
      stats.sharedLinks += 1;
      await emitLinkEvent(prisma, d.dealId, [row], {
        tier: 'shared',
        sharedWithDeals: s.deals.filter((x) => x.dealId !== d.dealId).map((x) => x.orderNo),
        documentTotalIls: s.documentMinor / 100,
        policy: 'historical_cutover',
      });
    }
    if (linkedAny) stats.sharedDocuments += 1;
  }

  // ── Tier B: the review queue ──────────────────────────────────────────────
  for (const b of plan.tierB) {
    const existing = await prisma.collectionMatchCandidate.findUnique({
      where: { dealId_doctype_docnum: { dealId: b.dealId, doctype: b.doctype, docnum: b.docnum } },
    });
    // An item a human already answered is NEVER reopened.
    if (existing && existing.status !== 'open') {
      stats.skipped += 1;
      continue;
    }
    if (existing) {
      await prisma.collectionMatchCandidate.update({
        where: { id: existing.id },
        data: { score: b.score, basis: b.reasons, question: b.question, competingDeals: b.competingDeals, competingDocs: b.competingDocs },
      });
      stats.requeued += 1;
      continue;
    }
    await prisma.collectionMatchCandidate.create({
      data: {
        dealId: b.dealId,
        doctype: b.doctype,
        docnum: b.docnum,
        tier: 'B',
        score: b.score,
        basis: b.reasons,
        question: b.question,
        competingDeals: b.competingDeals,
        competingDocs: b.competingDocs,
      },
    });
    stats.queued += 1;
  }

  log.log(`[stage2] applied: ${JSON.stringify(stats)}`);
  return stats;
}

function basisLabel(basis) {
  return {
    icount_client_id: 'מזהה לקוח באייקאונט שנלמד משיוכים קודמים',
    tax_id: 'ח.פ זהה',
    exact_name: 'שם לקוח זהה',
  }[basis] || basis;
}
