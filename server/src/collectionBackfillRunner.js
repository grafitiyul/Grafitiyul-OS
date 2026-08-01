import { runCensus, fetchLedgerDoc, createPacer, CENSUS_DOCTYPES } from './icountCensus.js';
import { referencesForDeal, decideDeal } from './collectionBackfill.js';
import { dealDocumentKey } from './icountDocs.js';
import { emitTimelineEvent } from './timeline/events.js';

// Historical collection reconstruction — the ORCHESTRATION.
//
// `prisma` is injected rather than imported so the whole run can be driven
// against any client instance (the CLI, a maintenance endpoint, a test double).
//
// Three phases, each independently re-runnable:
//   census()  — refresh the local iCount ledger mirror   (provider reads)
//   plan()    — decide every WON deal                     (no writes at all)
//   apply()   — persist the decisions                     (idempotent)
//
// Nothing in this file can create, email or modify an iCount document: the only
// provider functions reachable from here are doc/search and doc/info.

export const CENSUS_JOB_KEY = 'collection-census';

export const bigintSafe = (_k, v) => (typeof v === 'bigint' ? Number(v) : v);

const defaultLog = { log: console.log, warn: console.warn, error: console.error };

// ── 1. Census ────────────────────────────────────────────────────────────────
// Resumable: the per-doctype cursor lives on a MaintenanceJob row, so an
// interrupted run restarts from the day after its last completed window instead
// of re-reading the whole account.
export async function census(prisma, { delayMs, log = defaultLog } = {}) {
  const job = await prisma.maintenanceJob.upsert({
    where: { key: CENSUS_JOB_KEY },
    update: { status: 'running', startedAt: new Date(), attempts: { increment: 1 }, error: null },
    create: { key: CENSUS_JOB_KEY, status: 'running', startedAt: new Date(), attempts: 1 },
  });
  const cursors = (job.summary && job.summary.cursors) || {};
  log.log(`[backfill] census resuming from cursors: ${JSON.stringify(cursors)}`);

  let lastPersist = 0;
  try {
    const result = await runCensus(prisma, {
      cursors,
      delayMs,
      log,
      onProgress: async ({ doctype, cursor, documents, requests }) => {
        cursors[doctype] = cursor;
        // Persisted periodically, not per window — the point is surviving a
        // crash, not doubling the write load.
        if (Date.now() - lastPersist > 15_000) {
          lastPersist = Date.now();
          await prisma.maintenanceJob.update({ where: { key: CENSUS_JOB_KEY }, data: { summary: { cursors } } });
          log.log(`[census] ${doctype} … ${cursor} (${documents} docs, ${requests} req)`);
        }
      },
    });
    await prisma.maintenanceJob.update({
      where: { key: CENSUS_JOB_KEY },
      data: {
        status: result.stopped ? 'failed' : 'done',
        finishedAt: new Date(),
        error: result.stopReason || null,
        summary: { cursors, result: JSON.parse(JSON.stringify(result, bigintSafe)) },
      },
    });
    return result;
  } catch (err) {
    await prisma.maintenanceJob.update({
      where: { key: CENSUS_JOB_KEY },
      data: { status: 'failed', finishedAt: new Date(), error: String(err?.message || err), summary: { cursors } },
    });
    throw err;
  }
}

// ── 2. The deal population and its evidence texts ────────────────────────────
async function loadDeals(prisma, log) {
  const deals = await prisma.deal.findMany({
    where: { status: 'won' },
    select: {
      id: true,
      orderNo: true,
      title: true,
      valueMinor: true,
      currency: true,
      notes: true,
      customerInfo: true,
      tourDate: true,
      wonAt: true,
      collectionReview: true,
      organization: { select: { name: true, taxId: true } },
      organizationUnit: { select: { name: true, taxId: true } },
      contacts: {
        select: {
          contact: {
            select: { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true, taxId: true },
          },
        },
      },
    },
  });

  // Timeline bodies — the richest evidence source (imported Pipedrive notes land
  // here). Read in id-ordered pages rather than as one 144k-row result set.
  const byDeal = new Map(deals.map((d) => [d.id, []]));
  let cursor = null;
  let scanned = 0;
  for (;;) {
    const page = await prisma.timelineEntry.findMany({
      where: { subjectType: 'deal', deletedAt: null, body: { not: null } },
      select: { id: true, subjectId: true, body: true },
      orderBy: { id: 'asc' },
      take: 5000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!page.length) break;
    cursor = page[page.length - 1].id;
    scanned += page.length;
    for (const e of page) {
      const bucket = byDeal.get(e.subjectId);
      if (bucket) bucket.push({ text: e.body, source: `timeline:${e.id}` });
    }
  }
  log.log(`[backfill] scanned ${scanned} timeline entries for ${deals.length} WON deals`);

  for (const d of deals) {
    const texts = byDeal.get(d.id);
    if (d.notes) texts.unshift({ text: d.notes, source: 'deal.notes' });
    if (d.customerInfo) texts.unshift({ text: d.customerInfo, source: 'deal.customerInfo' });
  }
  return { deals, textsByDeal: byDeal };
}

async function loadLedger(prisma, log) {
  const rows = await prisma.icountLedgerDoc.findMany();
  const byKey = new Map();
  const byNum = new Map();
  for (const r of rows) {
    byKey.set(`${r.doctype}:${r.docnum}`, r);
    if (!byNum.has(r.docnum)) byNum.set(r.docnum, []);
    byNum.get(r.docnum).push(r);
  }
  log.log(`[backfill] ledger: ${rows.length} iCount documents indexed`);
  return { byKey, byNum };
}

// Candidate documents for one parsed reference. A stated type that iCount does
// not have under that number falls back to the number across all types — which
// still has to resolve uniquely.
function candidatesFor(ref, ledger) {
  if (ref.doctype !== 'unknown' && ref.doctype !== 'conflict') {
    const exact = ledger.byKey.get(`${ref.doctype}:${ref.docnum}`);
    if (exact) return [exact];
  }
  return ledger.byNum.get(ref.docnum) || [];
}

// "Which deals claim this document?" — a whole-population question, which is
// why it cannot be answered deal by deal.
function buildClaims(deals, refsByDeal, ledger) {
  const claims = new Map();
  for (const deal of deals) {
    for (const ref of refsByDeal.get(deal.id).references) {
      const cands = candidatesFor(ref, ledger);
      if (cands.length !== 1) continue;
      const key = `${cands[0].doctype}:${cands[0].docnum}`;
      if (!claims.has(key)) claims.set(key, []);
      if (!claims.get(key).includes(deal.id)) claims.get(key).push(deal.id);
    }
  }
  return claims;
}

// ── 3. Plan ──────────────────────────────────────────────────────────────────
export async function plan(
  prisma,
  { limit = 0, priorityFirst = false, resolveMissing = false, delayMs, log = defaultLog } = {},
) {
  const { deals, textsByDeal } = await loadDeals(prisma, log);
  const ledger = await loadLedger(prisma, log);

  const refsByDeal = new Map();
  for (const deal of deals) refsByDeal.set(deal.id, referencesForDeal(textsByDeal.get(deal.id)));

  // References the census never saw (a gap window, or a document outside the
  // censused range) are resolved individually — once each — and folded into the
  // ledger, so the next run costs nothing for them.
  let individualRequests = 0;
  let individuallyResolved = 0;
  if (resolveMissing) {
    const missing = new Map();
    for (const deal of deals) {
      for (const ref of refsByDeal.get(deal.id).references) {
        if (candidatesFor(ref, ledger).length) continue;
        if (!missing.has(ref.docnum)) missing.set(ref.docnum, new Set());
        if (ref.doctype && ref.doctype !== 'unknown' && ref.doctype !== 'conflict') {
          missing.get(ref.docnum).add(ref.doctype);
        }
      }
    }
    if (missing.size) {
      log.log(`[backfill] resolving ${missing.size} unindexed document numbers individually…`);
      const pacer = createPacer({ delayMs, log });
      for (const [docnum, stated] of missing) {
        // Stated type first; a wrong guess costs one cheap doc_not_found and
        // writes nothing.
        const order = [...stated, ...CENSUS_DOCTYPES.filter((t) => !stated.has(t))];
        let hit = null;
        for (const doctype of order) {
          try {
            hit = await fetchLedgerDoc(prisma, doctype, docnum, { pacer, log });
          } catch (err) {
            if (err?.code === 'census_stopped') break;
            continue;
          }
          if (hit) break;
        }
        if (hit) {
          ledger.byKey.set(`${hit.doctype}:${hit.docnum}`, hit);
          if (!ledger.byNum.has(hit.docnum)) ledger.byNum.set(hit.docnum, []);
          ledger.byNum.get(hit.docnum).push(hit);
          individuallyResolved += 1;
        }
        if (pacer.state.stopped) {
          log.error('[backfill] provider back-off ceiling reached — stopping individual resolution');
          break;
        }
      }
      individualRequests = pacer.state.requests;
      log.log(`[backfill] individually resolved ${individuallyResolved}/${missing.size} (${individualRequests} requests)`);
    }
  }

  // Claims are computed AFTER individual resolution: a newly resolved document
  // can be shared too.
  const claims = buildClaims(deals, refsByDeal, ledger);

  // Documents already attached — what makes the whole run idempotent.
  const existing = await prisma.icountDocument.findMany({ select: { dealId: true, doctype: true, docnum: true } });
  const linkedByDeal = new Map();
  for (const e of existing) {
    if (!linkedByDeal.has(e.dealId)) linkedByDeal.set(e.dealId, new Set());
    linkedByDeal.get(e.dealId).add(`${e.doctype}:${e.docnum}`);
  }

  // Active/future operational deals first — the ones an operator is looking at
  // today. Ordering never changes a DECISION, only the order they are made in.
  const today = new Date().toISOString().slice(0, 10);
  const ordered = priorityFirst ? [...deals].sort((a, b) => priorityRank(a, today) - priorityRank(b, today)) : deals;

  const decisions = [];
  for (const deal of limit ? ordered.slice(0, limit) : ordered) {
    decisions.push(
      decideDeal({
        deal,
        references: refsByDeal.get(deal.id),
        ledger,
        claims,
        alreadyLinked: linkedByDeal.get(deal.id) || new Set(),
      }),
    );
  }
  return { deals, decisions, ledger, claims, individualRequests, individuallyResolved };
}

function priorityRank(deal, today) {
  if (deal.tourDate && deal.tourDate >= today) return 0; // future tour
  if (deal.tourDate && deal.tourDate >= addDaysStr(today, -60)) return 1; // recently toured
  return 2;
}
function addDaysStr(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── 4. Apply ─────────────────────────────────────────────────────────────────
export async function apply(prisma, decisions, { log = defaultLog } = {}) {
  const stats = { attached: 0, reused: 0, flagged: 0, cleared: 0, dealsTouched: 0 };

  for (const d of decisions) {
    const wrote = [];
    for (const a of d.attach) {
      const key = dealDocumentKey(d.dealId, a.doctype, a.docnum);
      const already = await prisma.icountDocument.findUnique({ where: { idempotencyKey: key } });
      if (already) {
        stats.reused += 1;
        continue;
      }
      const l = a.ledger;
      wrote.push(
        await prisma.icountDocument.create({
          data: {
            dealId: d.dealId,
            source: 'backfill',
            doctype: a.doctype,
            docnum: a.docnum,
            // A MAGNITUDE — iCount reports credit notes negative and the
            // direction lives in the doctype (see collection.js).
            amountMinor: BigInt(Math.abs(Number(l.totalMinor))),
            paidMinor: l.paidMinor != null ? BigInt(Math.abs(Number(l.paidMinor))) : null,
            currency: l.currency || 'ILS',
            clientName: l.clientName || 'לקוח',
            clientVatId: l.clientVatId || null,
            docUrl: a.docUrl,
            status: l.isCancelled || l.isCancellation ? 'cancelled' : 'issued',
            issuedAt: l.issuedAt,
            linkConfidence: a.linkConfidence,
            linkReason: a.linkReason,
            verifiedAt: l.syncedAt,
            idempotencyKey: key,
            raw: l.raw ?? undefined,
          },
        }),
      );
      stats.attached += 1;
    }

    // The review flag. A flag an operator ALREADY CLEARED is never re-raised —
    // a tool that re-asks an answered question stops being trusted.
    const current = await prisma.deal.findUnique({ where: { id: d.dealId }, select: { collectionReview: true } });
    const wasCleared = !!current?.collectionReview?.clearedAt;
    if (d.review && !wasCleared) {
      await prisma.deal.update({ where: { id: d.dealId }, data: { collectionReview: d.review } });
      stats.flagged += 1;
    } else if (!d.review && current?.collectionReview?.flaggedBy === 'collection_backfill' && !wasCleared) {
      // The evidence now resolves cleanly — withdraw the machine's own flag.
      await prisma.deal.update({ where: { id: d.dealId }, data: { collectionReview: null } });
      stats.cleared += 1;
    }

    if (wrote.length) {
      stats.dealsTouched += 1;
      // ONE timeline entry per deal, not one per document: the deal's history
      // should read "collection was reconstructed", not spam.
      await emitTimelineEvent(prisma, {
        subjectType: 'deal',
        subjectId: d.dealId,
        kind: 'accounting',
        data: {
          event: 'collection_backfill',
          documents: wrote.map((w) => ({
            doctype: w.doctype,
            docnum: w.docnum,
            amountIls: Number(w.amountMinor) / 100,
            status: w.status,
          })),
          review: d.review ? { code: d.review.code, reason: d.review.reason } : null,
        },
        origin: { actorType: 'import', actorLabel: 'שחזור גבייה היסטורית' },
      });
    }
  }
  log.log(`[backfill] applied: ${JSON.stringify(stats)}`);
  return stats;
}

// ── 5. Report ────────────────────────────────────────────────────────────────
export function report(decisions) {
  const byOutcome = {};
  const byProblem = {};
  let referencesConsidered = 0;
  let dealsWithEvidence = 0;
  const docsAttached = new Set();
  for (const d of decisions) {
    byOutcome[d.outcome] = (byOutcome[d.outcome] || 0) + 1;
    for (const p of d.problems) byProblem[p.code] = (byProblem[p.code] || 0) + 1;
    if (d.attach.length || d.problems.length) dealsWithEvidence += 1;
    referencesConsidered += d.attach.length + d.skipped.length + d.problems.length;
    for (const a of d.attach) docsAttached.add(`${a.doctype}:${a.docnum}`);
  }
  return {
    dealsScanned: decisions.length,
    dealsWithEvidence,
    referencesConsidered,
    uniqueDocumentsAttached: docsAttached.size,
    byOutcome,
    byProblem,
  };
}
