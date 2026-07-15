// Deal search provider.
//
// Shape of every provider in this module: run the bounded lookups that Prisma
// cannot express in parallel, fold their ids into ONE findMany, then score the
// resulting rows in JS. That is what keeps this free of N+1 — the number of
// queries is fixed (6), regardless of how many deals match.

import {
  lookupPhoneContacts,
  lookupEmailContacts,
  lookupTimeline,
  lookupLegacy,
  lookupDealNoPartial,
  legacyCardHit,
  groupByKey,
  CANDIDATE_CAP,
} from '../lookups.js';
import { dealGroupRank, scoreOf, bestReason } from '../ranking.js';
import { contactNameOr } from '../nameWhere.js';
import { contains, startsWith, equals, snippet, fullNameHe, fullNameEn } from '../text.js';

const INT4_MAX = 2147483647;

const INCLUDE = {
  dealStage: { select: { id: true, label: true } },
  organization: { select: { id: true, name: true } },
  organizationUnit: { select: { id: true, name: true } },
  product: { select: { id: true, nameHe: true, nameEn: true } },
  productVariant: {
    select: { id: true, location: { select: { nameHe: true, nameEn: true } } },
  },
  dealSource: { select: { label: true } },
  contacts: {
    select: {
      isPrimary: true,
      contactId: true,
      contact: {
        select: {
          id: true,
          firstNameHe: true,
          lastNameHe: true,
          firstNameEn: true,
          lastNameEn: true,
        },
      },
    },
  },
  // Deal↔TourEvent goes ONLY through Booking (schema forbids a direct
  // tourEventId). Superseded tours are hidden everywhere else, so exclude them
  // from ranking too.
  bookings: {
    where: { status: 'active' },
    select: {
      tourEvent: {
        select: { id: true, date: true, status: true, supersededByTourEventId: true },
      },
    },
  },
};

function ci(q) {
  return { contains: q, mode: 'insensitive' };
}

function buildOr(q, { orderNo, phoneIds, emailIds, timelineIds, legacyIds, dealNoIds }) {
  const or = [
    { title: ci(q) },
    { notes: ci(q) },
    { customerInfo: ci(q) },
    { source: ci(q) },
    { lostReason: ci(q) },
    { status: ci(q) },
    { tourDate: { contains: q } },
    { dealStage: { is: { OR: [{ label: ci(q) }, { labelEn: ci(q) }, { key: ci(q) }] } } },
    { organization: { is: { name: ci(q) } } },
    { organizationUnit: { is: { name: ci(q) } } },
    { product: { is: { OR: [{ nameHe: ci(q) }, { nameEn: ci(q) }] } } },
    { productVariant: { is: { location: { is: { OR: [{ nameHe: ci(q) }, { nameEn: ci(q) }] } } } } },
    { dealSource: { is: { label: ci(q) } } },
    { contacts: { some: { contact: { OR: contactNameOr(q) } } } },
  ];
  if (orderNo !== null) or.push({ orderNo });
  const contactIds = [...new Set([...phoneIds, ...emailIds])];
  if (contactIds.length) or.push({ contacts: { some: { contactId: { in: contactIds } } } });
  const ids = [...new Set([...timelineIds, ...legacyIds, ...dealNoIds])];
  if (ids.length) or.push({ id: { in: ids } });
  return or;
}

function contactReasons(deal, q, phoneMap, emailMap) {
  const out = [];
  for (const dc of deal.contacts || []) {
    const c = dc.contact;
    const phone = phoneMap.get(dc.contactId);
    if (phone) out.push({ key: phone.exact ? 'phone_exact' : 'phone_partial', text: phone.value });
    const email = emailMap.get(dc.contactId);
    if (email) out.push({ key: email.exact ? 'email_exact' : 'email_partial', text: email.value });
    if (!c) continue;
    for (const name of [fullNameHe(c), fullNameEn(c)]) {
      if (!name) continue;
      if (equals(name, q)) out.push({ key: 'name_exact', text: name });
      else if (startsWith(name, q)) out.push({ key: 'name_prefix', text: name });
      else if (contains(name, q)) out.push({ key: 'name_partial', text: name });
    }
  }
  return out;
}

function entityReasons(deal, q) {
  const out = [];
  const org = deal.organization?.name;
  if (equals(org, q)) out.push({ key: 'name_exact', text: org });
  else if (contains(org, q)) out.push({ key: 'org_name_partial', text: org });

  if (contains(deal.organizationUnit?.name, q)) {
    out.push({ key: 'unit_name_partial', text: deal.organizationUnit.name });
  }
  const product = deal.product?.nameHe || deal.product?.nameEn;
  if (contains(deal.product?.nameHe, q) || contains(deal.product?.nameEn, q)) {
    out.push({ key: 'product_partial', text: product });
  }
  const loc = deal.productVariant?.location;
  if (contains(loc?.nameHe, q) || contains(loc?.nameEn, q)) {
    out.push({ key: 'variant_partial', text: [product, loc?.nameHe].filter(Boolean).join(' — ') });
  }
  if (contains(deal.source, q)) out.push({ key: 'source_partial', text: deal.source });
  if (contains(deal.dealSource?.label, q)) {
    out.push({ key: 'source_partial', text: deal.dealSource.label });
  }
  if (contains(deal.status, q) || contains(deal.dealStage?.label, q)) {
    out.push({ key: 'status_partial', text: deal.dealStage?.label || deal.status });
  }
  if (contains(deal.tourDate, q)) out.push({ key: 'tour_date_partial', text: deal.tourDate });
  return out;
}

function reasonsForDeal(deal, ctx) {
  const { q, orderNo, phoneMap, emailMap, timelineByDeal, legacyByDeal, dealNoIds } = ctx;
  const out = [];

  if (orderNo !== null && deal.orderNo === orderNo) {
    out.push({ key: 'deal_number_exact', text: `#${deal.orderNo}` });
  } else if (dealNoIds.has(deal.id)) {
    out.push({ key: 'deal_number_partial', text: `#${deal.orderNo}` });
  }

  if (equals(deal.title, q)) out.push({ key: 'name_exact', text: deal.title });
  else if (startsWith(deal.title, q)) out.push({ key: 'title_prefix', text: deal.title });
  else if (contains(deal.title, q)) out.push({ key: 'title_partial', text: deal.title });

  out.push(...contactReasons(deal, q, phoneMap, emailMap));
  out.push(...entityReasons(deal, q));

  for (const field of [deal.notes, deal.customerInfo]) {
    if (contains(field, q)) out.push({ key: 'note_partial', text: snippet(field, q) });
  }
  const tl = timelineByDeal.get(deal.id);
  if (tl?.length) out.push({ key: 'timeline_partial', text: snippet(tl[0].body, q) });

  const card = legacyCardHit(legacyByDeal.get(deal.id), q);
  if (card) out.push({ key: 'legacy_partial', text: `${card.label}: ${card.value}`.trim() });

  return out;
}

function tourInfo(deal, todayIso) {
  const events = (deal.bookings || [])
    .map((b) => b.tourEvent)
    .filter((t) => t && !t.supersededByTourEventId);
  const dates = events.map((t) => t.date).filter(Boolean);
  const future = dates.filter((d) => d >= todayIso).sort();
  const past = dates.filter((d) => d < todayIso).sort();
  return {
    dates,
    displayDate: future[0] || past[past.length - 1] || null,
    isFuture: !!future.length,
  };
}

function toDto(deal, reasons, groupRank, todayIso) {
  const primary =
    (deal.contacts || []).find((c) => c.isPrimary) || (deal.contacts || [])[0] || null;
  const c = primary?.contact;
  const tour = tourInfo(deal, todayIso);
  const product = deal.product?.nameHe || deal.product?.nameEn || null;
  const variant = deal.productVariant?.location?.nameHe || null;
  return {
    type: 'deal',
    id: deal.id,
    orderNo: deal.orderNo,
    path: `/admin/crm/deals/${deal.orderNo ?? deal.id}`,
    title: deal.title,
    contactName: c ? fullNameHe(c) || fullNameEn(c) : null,
    organizationName: deal.organization?.name || null,
    unitName: deal.organizationUnit?.name || null,
    status: deal.status,
    stageLabel: deal.dealStage?.label || null,
    product,
    variant: variant ? `${product ?? ''} — ${variant}`.trim() : product,
    tourDate: tour.displayDate,
    tourIsFuture: tour.isFuture,
    groupRank,
    reasons,
  };
}

export async function searchDeals(q, pq, limit, todayIso, db) {
  const trimmed = q.trim();
  const orderNo =
    /^\d+$/.test(trimmed) && Number(trimmed) <= INT4_MAX ? Number(trimmed) : null;

  const [phoneMap, emailMap, timelineRows, legacyRows, dealNoIdList] = await Promise.all([
    lookupPhoneContacts(pq, db),
    lookupEmailContacts(q, db),
    lookupTimeline(q, 'deal', db),
    lookupLegacy(q, 'Deal', db),
    lookupDealNoPartial(q, db),
  ]);

  const timelineByDeal = groupByKey(timelineRows, 'subjectId');
  const legacyByDeal = new Map(legacyRows.map((r) => [r.entityId, r.cardData]));
  const dealNoIds = new Set(dealNoIdList);

  const where = {
    OR: buildOr(q, {
      orderNo,
      phoneIds: [...phoneMap.keys()],
      emailIds: [...emailMap.keys()],
      timelineIds: [...timelineByDeal.keys()],
      legacyIds: [...legacyByDeal.keys()],
      dealNoIds: dealNoIdList,
    }),
  };

  const rows = await db.deal.findMany({
    where,
    include: INCLUDE,
    orderBy: { updatedAt: 'desc' },
    take: CANDIDATE_CAP,
  });

  const ctx = { q, orderNo, phoneMap, emailMap, timelineByDeal, legacyByDeal, dealNoIds };
  const hits = [];
  for (const deal of rows) {
    const reasons = reasonsForDeal(deal, ctx);
    if (!reasons.length) continue;
    const tour = tourInfo(deal, todayIso);
    const groupRank = dealGroupRank(deal, tour.dates, todayIso);
    hits.push({
      score: scoreOf(reasons),
      groupRank,
      updatedAt: deal.updatedAt?.getTime?.() ?? 0,
      best: bestReason(reasons),
      dto: () => toDto(deal, reasons, groupRank, todayIso),
    });
  }
  return { hits, truncated: rows.length >= CANDIDATE_CAP };
}
