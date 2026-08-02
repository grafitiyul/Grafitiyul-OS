// READ-ONLY production audit — future WON tours that may have been marked
// "paid" in Pipedrive when only a deposit was actually paid.
//
// Population: every WON Deal with a live future Booking (b.status='active')
// on a non-cancelled, non-superseded TourEvent with te.date >= today (IL) —
// the canonical live-tour relationship (classifyCollectionWorkQueue.js), with
// the UI's superseded-twin exclusion made explicit (both counts are reported).
//
// For every deal it gathers ALL payment-relevant evidence: the canonical
// collection summary (src/collection.js — the ONE money resolver), issued
// iCount documents, manual evidence rows, custom payment links (the מקדמה
// flow), Builder amounts (Deal.valueMinor cache + offers + imported frozen
// versions), provenance (DealMarketing.originalIngressSource), and a keyword
// scan of every imported/authored timeline note + deal notes/customerInfo for
// deposit/balance language in Hebrew and English, with excerpts.
//
// It WRITES NOTHING. Output: JSON report + stdout summary.
//
// Run (from server/):
//   DB_URL=<postgres url> node scripts/audit-future-deposits.mjs
// or with Railway-injected env:
//   railway run --service Grafitiyul-OS node server/scripts/audit-future-deposits.mjs

import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { computeCollection } from '../src/collection.js';

const dbUrl = process.env.DB_URL || process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('No DB_URL / DATABASE_PUBLIC_URL / DATABASE_URL provided.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const bigintSafe = (k, v) => (typeof v === 'bigint' ? Number(v) : v);
const ils = (minor) => (minor == null ? null : Number(minor) / 100);

function todayIL() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Deposit/partial/balance language — Hebrew + English, broad on purpose; the
// classification pass reads the excerpt in context, so recall beats precision.
const KEYWORDS = [
  'מקדמה', 'מקדמת', 'יתרה', 'יתרת', 'שולם חלק', 'תשלום ראשון', 'ישלם בהמשך',
  'לתשלום ביום', 'ביום הסיור', 'לפני הסיור', 'תשלום שני', 'השלמת תשלום',
  'שולם במלואו', 'שולם הכל', 'תשלום מלא', 'שולם מלא', 'מפרעה', 'על חשבון',
  'advance', 'deposit', 'balance', 'remainder', 'remaining', 'paid in full',
  'partial', 'down payment', 'rest of the payment', 'rest will be paid',
];

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function scanText(text) {
  const hits = [];
  const lower = text.toLowerCase();
  for (const kw of KEYWORDS) {
    let idx = 0;
    const needle = kw.toLowerCase();
    while ((idx = lower.indexOf(needle, idx)) !== -1) {
      const start = Math.max(0, idx - 120);
      const end = Math.min(text.length, idx + needle.length + 120);
      hits.push({ keyword: kw, excerpt: text.slice(start, end).replace(/\s+/g, ' ').trim() });
      idx += needle.length;
      if (hits.length > 40) return hits; // per-text cap
    }
  }
  return hits;
}

async function main() {
  const today = todayIL();
  console.log(`[audit] today (IL) = ${today}`);

  // Population — canonical live-future relationship; superseded twins excluded
  // (UI semantics). The queue-semantics count (twins included) is reported too.
  const futureRows = await prisma.$queryRawUnsafe(
    `select b."dealId" as id, min(te.date) as "nextTourDate", count(distinct te.id)::int as "futureTours"
       from "Booking" b
       join "TourEvent" te on te.id = b."tourEventId"
      where b.status = 'active'
        and te.status <> 'cancelled'
        and te."supersededByTourEventId" is null
        and te.date >= $1
      group by b."dealId"`,
    today,
  );
  const withTwins = await prisma.$queryRawUnsafe(
    `select count(distinct b."dealId")::int as n
       from "Booking" b
       join "TourEvent" te on te.id = b."tourEventId"
      where b.status = 'active' and te.status <> 'cancelled' and te.date >= $1`,
    today,
  );
  const nextTourByDeal = new Map(futureRows.map((r) => [r.id, r]));

  const deals = await prisma.deal.findMany({
    where: { id: { in: futureRows.map((r) => r.id) }, status: 'won' },
    select: {
      id: true,
      orderNo: true,
      title: true,
      status: true,
      valueMinor: true,
      discountMinor: true,
      currency: true,
      activityType: true,
      organizationId: true,
      organization: { select: { name: true } },
      tourDate: true,
      participants: true,
      notes: true,
      customerInfo: true,
      wonAt: true,
      collectionReview: true,
      collectionReviewStatus: true,
      collectionReviewStatusSource: true,
      noPaymentWaiver: true,
      contacts: {
        select: {
          isPrimary: true,
          contact: { select: { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true, contactNo: true } },
        },
      },
      marketing: { select: { originalIngressSource: true, leadSourceKey: true, sourceCreatedAt: true } },
      quoteOffers: { select: { offerNo: true, isPrimary: true, valueMinor: true } },
      quoteVersions: { select: { id: true, sourceKind: true, isWorking: true, status: true } },
    },
  });
  console.log(
    `[audit] population: ${deals.length} WON deals with a live future tour (superseded excluded); ` +
      `${withTwins[0].n} with queue semantics (twins included)`,
  );

  const ids = deals.map((d) => d.id);

  const [docs, evidence, customLinks, legacyDealRecords] = await Promise.all([
    prisma.icountDocument.findMany({
      where: { dealId: { in: ids } },
      select: {
        dealId: true, doctype: true, docnum: true, status: true, amountMinor: true,
        paidMinor: true, allocationMinor: true, sharedHistorical: true, issuedAt: true,
        linkConfidence: true, linkReason: true,
      },
      orderBy: { issuedAt: 'asc' },
    }),
    prisma.dealCollectionEvidence.findMany({
      where: { dealId: { in: ids } },
      select: { dealId: true, kind: true, direction: true, amountMinor: true, paidAt: true, status: true, origin: true, note: true },
    }).catch((e) => { console.log('[audit] evidence select fallback:', e.message.split('\n')[0]); return []; }),
    prisma.dealCustomPaymentLink.findMany({
      where: { dealId: { in: ids } },
      select: { dealId: true, amountMinor: true, notes: true, createdAt: true, status: true },
    }).catch(() => []),
    prisma.legacyRecord.findMany({
      where: { entityType: 'Deal', entityId: { in: ids }, sourceType: 'deal' },
      select: { entityId: true, sourceSystem: true, sourceId: true },
    }).catch(() => []),
  ]);

  const notes = await prisma.timelineEntry.findMany({
    where: { subjectType: 'deal', subjectId: { in: ids }, deletedAt: null, body: { not: null } },
    select: { subjectId: true, body: true, createdAt: true, actorType: true, actorLabel: true, kind: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`[audit] scanned ${notes.length} timeline entries, ${docs.length} iCount docs`);

  const byDeal = (rows, key = 'dealId') => {
    const m = new Map();
    for (const r of rows) {
      const k = r[key];
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  };
  const docsBy = byDeal(docs);
  const evidenceBy = byDeal(evidence);
  const linksBy = byDeal(customLinks);
  const notesBy = byDeal(notes, 'subjectId');
  const legacyBy = byDeal(legacyDealRecords, 'entityId');

  const report = [];
  for (const d of deals) {
    const dealDocs = (docsBy.get(d.id) || []).filter((x) => x.status === 'issued');
    const dealEvidence = (evidenceBy.get(d.id) || []).filter((x) => x.status === 'active');
    // The canonical money math — never re-derived here.
    const summary = computeCollection(
      { totalMinor: null, valueMinor: d.valueMinor, currency: d.currency, collectionReview: d.collectionReview },
      dealDocs,
      dealEvidence,
    );

    const noteHits = [];
    for (const n of notesBy.get(d.id) || []) {
      const text = stripHtml(n.body);
      const hits = scanText(text);
      for (const h of hits) {
        noteHits.push({ ...h, createdAt: n.createdAt, actorLabel: n.actorLabel, kind: n.kind });
      }
    }
    for (const [label, raw] of [['deal.notes', d.notes], ['deal.customerInfo', d.customerInfo]]) {
      if (!raw) continue;
      for (const h of scanText(stripHtml(raw))) noteHits.push({ ...h, sourceField: label });
    }

    const primaryContact =
      d.contacts.find((c) => c.isPrimary)?.contact || d.contacts[0]?.contact || null;
    const contactName = primaryContact
      ? `${primaryContact.firstNameHe || primaryContact.firstNameEn || ''} ${primaryContact.lastNameHe || primaryContact.lastNameEn || ''}`.trim()
      : null;

    report.push({
      orderNo: d.orderNo,
      dealId: d.id,
      title: d.title,
      customer: contactName,
      organization: d.organization?.name || null,
      customerKind: d.organizationId || d.activityType === 'business' ? 'business' : 'private',
      activityType: d.activityType,
      nextTourDate: nextTourByDeal.get(d.id)?.nextTourDate || d.tourDate,
      futureTours: nextTourByDeal.get(d.id)?.futureTours || 0,
      participants: d.participants,
      wonAt: d.wonAt,
      legacy: (legacyBy.get(d.id) || []).map((r) => `${r.sourceSystem}:${r.sourceId}`),
      ingressSource: d.marketing?.originalIngressSource || null,
      valueILS: ils(d.valueMinor),
      offers: d.quoteOffers.map((o) => ({ offerNo: o.offerNo, isPrimary: o.isPrimary, valueILS: ils(o.valueMinor) })),
      importedFrozenVersions: d.quoteVersions.filter((v) => v.sourceKind).map((v) => v.sourceKind),
      collection: {
        status: summary.status,
        totalILS: ils(summary.totalMinor ?? d.valueMinor),
        paidILS: ils(summary.paidMinor),
        creditedILS: ils(summary.creditedMinor),
        netILS: ils(summary.netMinor),
        balanceILS: ils(summary.balanceMinor),
      },
      collectionReviewStatus: d.collectionReviewStatus,
      collectionReviewStatusSource: d.collectionReviewStatusSource,
      collectionReviewFlag: d.collectionReview,
      noPaymentWaiver: d.noPaymentWaiver ? true : null,
      documents: dealDocs.map((x) => ({
        doctype: x.doctype, docnum: x.docnum, amountILS: ils(x.amountMinor), paidILS: ils(x.paidMinor),
        allocationILS: ils(x.allocationMinor), sharedHistorical: x.sharedHistorical || undefined,
        issuedAt: x.issuedAt, linkConfidence: x.linkConfidence, linkReason: x.linkReason,
      })),
      manualEvidence: dealEvidence.map((x) => ({
        kind: x.kind, direction: x.direction, amountILS: ils(x.amountMinor), paidAt: x.paidAt, origin: x.origin, note: x.note,
      })),
      customPaymentLinks: (linksBy.get(d.id) || []).map((x) => ({
        amountILS: ils(x.amountMinor), notes: x.notes, status: x.status, createdAt: x.createdAt,
      })),
      keywordHits: noteHits,
      timelineNoteCount: (notesBy.get(d.id) || []).length,
    });
  }

  report.sort((a, b) => String(a.nextTourDate).localeCompare(String(b.nextTourDate)));

  const outDir = path.join(process.cwd(), 'scripts', 'output', 'future-deposit-audit');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `audit-${today}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), today, populationQueueSemantics: withTwins[0].n, deals: report }, bigintSafe, 2));
  console.log(`[audit] wrote ${outFile}`);

  // stdout summary
  for (const r of report) {
    console.log(
      `#${r.orderNo} · ${r.nextTourDate} · ${r.customer || r.title} · ${r.customerKind}/${r.activityType} · ` +
        `total ₪${r.collection.totalILS} paid ₪${r.collection.netILS} → ${r.collection.status} · ` +
        `docs ${r.documents.length} · hits ${r.keywordHits.length} · legacy ${r.legacy.join(',') || '—'}`,
    );
  }
  console.log(`[audit] done — ${report.length} deals`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
