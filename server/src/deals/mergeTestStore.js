// The in-memory Prisma stand-in for the Deal Merge suite.
//
// Faithful on the things the merge design actually rests on, and deliberately
// nowhere else:
//
//   • Booking_one_active_per_deal_key — the partial unique that forces
//     cancel-before-adopt ordering. Without it, "both deals live" would appear
//     to work while producing two active bookings in production.
//   • Seats live on TicketRegistration, not on Booking.
//   • DealMerge.opId and DealMerge.retiredDealId are UNIQUE. Idempotency proven
//     against a fake that does not enforce uniqueness is not proven at all.
//   • DealContact has a unique on (dealId, contactId).
//
// NOT a general-purpose Prisma mock. It implements exactly the calls this
// feature's path makes; a missing method is a loud crash, which is the honest
// outcome. See dealMerge.prismaShape.test.js for the guard that the FIELD NAMES
// are real, which no fake can prove.

export const CAP = ['active', 'held', 'confirmed'];

export const BASE_DEAL = {
  status: 'open',
  currency: 'ILS',
  valueMinor: 0n,
  participants: null,
  activityType: null,
  organizationId: null,
  organizationUnitId: null,
  organizationSubtypeId: null,
  organizationTypeId: null,
  productId: null,
  productVariantId: null,
  locationId: null,
  tourDate: null,
  tourTime: null,
  tourLanguage: null,
  communicationLanguage: null,
  paymentTermId: null,
  paymentMethodId: null,
  dealSourceId: null,
  source: null,
  ownerUserId: null,
  expectedCloseDate: null,
  groupName: null,
  groups: null,
  durationHours: null,
  notes: null,
  customerInfo: null,
  collectionReview: null,
  mergedIntoDealId: null,
  mergedAt: null,
  mergeOpId: null,
  dealStageId: 'stage1',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  lastMeaningfulActivityAt: new Date('2026-01-01'),
};

export function makeMergeStore(init = {}) {
  const s = {
    deals: {},
    tours: { ...(init.tours || {}) },
    bookings: init.bookings ? [...init.bookings] : [],
    registrations: init.registrations ? [...init.registrations] : [],
    dealContacts: init.dealContacts ? [...init.dealContacts] : [],
    quoteVersions: init.quoteVersions ? [...init.quoteVersions] : [],
    quoteLines: init.quoteLines ? [...init.quoteLines] : [],
    quoteOffers: init.quoteOffers ? [...init.quoteOffers] : [],
    tasks: init.tasks ? [...init.tasks] : [],
    documents: init.documents ? [...init.documents] : [],
    evidence: init.evidence ? [...init.evidence] : [],
    merges: [],
    timeline: [],
    reviewItems: [],
    orgs: init.orgs || {},
    seq: 0,
  };
  for (const [id, d] of Object.entries(init.deals || {})) {
    s.deals[id] = { ...BASE_DEAL, id, ...d };
  }
  const id = (p) => `${p}${++s.seq}`;
  const withTour = (b) => (b ? { ...b, tourEvent: s.tours[b.tourEventId] || null } : null);
  const P2002 = () => Object.assign(new Error('unique constraint'), { code: 'P2002' });

  const dealMatches = (d, where = {}) => {
    if (where.id !== undefined) {
      if (where.id?.in) { if (!where.id.in.includes(d.id)) return false; }
      else if (where.id?.notIn) { if (where.id.notIn.includes(d.id)) return false; }
      else if (d.id !== where.id) return false;
    }
    if (where.mergedIntoDealId !== undefined) {
      const c = where.mergedIntoDealId;
      if (c === null) { if (d.mergedIntoDealId != null) return false; }
      else if (c?.in) { if (!c.in.includes(d.mergedIntoDealId)) return false; }
      else if (c?.not === null) { if (d.mergedIntoDealId == null) return false; }
    }
    if (where.status !== undefined && d.status !== where.status) return false;
    return true;
  };

  const client = {
    _s: s,
    $transaction: async (fn) => fn(client),
    $executeRaw: async () => 1,
    $executeRawUnsafe: async () => 1,

    deal: {
      findUnique: async ({ where, select }) => {
        let d = null;
        if (where.id) d = s.deals[where.id] || null;
        else if (where.orderNo != null) d = Object.values(s.deals).find((x) => x.orderNo === where.orderNo) || null;
        else if (where.mergeOpId) d = Object.values(s.deals).find((x) => x.mergeOpId === where.mergeOpId) || null;
        if (!d) return null;
        // Relation selects used by loadSide's label query and the detector.
        if (select?.organization || select?.product || select?.dealStage) {
          return {
            organization: d.organizationId ? s.orgs[d.organizationId] || { id: d.organizationId, name: 'ארגון' } : null,
            organizationUnit: null,
            product: d.productId ? { nameHe: 'מוצר', nameEn: 'Product' } : null,
            productVariant: d.productVariantId ? { location: { nameHe: 'תל אביב' } } : null,
            dealStage: { label: 'שלב' },
            dealSource: null,
          };
        }
        if (select?.mergedInto) {
          const sv = d.mergedIntoDealId ? s.deals[d.mergedIntoDealId] : null;
          return { ...d, mergedInto: sv ? { id: sv.id, orderNo: sv.orderNo } : null };
        }
        return { ...d };
      },
      findMany: async ({ where = {}, select }) => {
        const rows = Object.values(s.deals).filter((d) => dealMatches(d, where));
        if (!select) return rows.map((d) => ({ ...d }));
        return rows.map((d) => {
          const out = {};
          for (const k of Object.keys(select)) {
            if (k === 'mergedInto') {
              const sv = d.mergedIntoDealId ? s.deals[d.mergedIntoDealId] : null;
              out.mergedInto = sv ? { id: sv.id, orderNo: sv.orderNo } : null;
            } else if (k === 'mergeAsRetired') {
              out.mergeAsRetired = s.merges.find((m) => m.retiredDealId === d.id) || null;
            } else out[k] = d[k];
          }
          return out;
        });
      },
      update: async ({ where, data }) => {
        const d = s.deals[where.id];
        if (data.mergeOpId) {
          const clash = Object.values(s.deals).find((x) => x.id !== where.id && x.mergeOpId === data.mergeOpId);
          if (clash) throw P2002();
        }
        Object.assign(d, data);
        return { ...d };
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const d of Object.values(s.deals)) {
          if (where.id && d.id !== where.id) continue;
          if (where.status?.not && d.status === where.status.not) continue;
          Object.assign(d, data);
          count += 1;
        }
        return { count };
      },
    },

    dealMerge: {
      findUnique: async ({ where }) =>
        s.merges.find((m) => (where.opId ? m.opId === where.opId : m.retiredDealId === where.retiredDealId)) || null,
      create: async ({ data }) => {
        // BOTH uniques enforced — this is where idempotency is actually proven.
        if (s.merges.some((m) => m.opId === data.opId)) throw P2002();
        if (s.merges.some((m) => m.retiredDealId === data.retiredDealId)) throw P2002();
        const row = { id: id('mrg'), mergedAt: new Date(), ...data };
        s.merges.push(row);
        return row;
      },
    },

    dealContact: {
      findMany: async ({ where }) => s.dealContacts.filter((c) => c.dealId === where.dealId).map((c) => ({
        ...c,
        contact: { id: c.contactId, firstNameHe: `שם${c.contactId}`, lastNameHe: '', firstNameEn: null, lastNameEn: null, phones: [], emails: [] },
      })),
      create: async ({ data }) => {
        if (s.dealContacts.some((c) => c.dealId === data.dealId && c.contactId === data.contactId)) throw P2002();
        const row = { id: id('dc'), roles: [], isPrimary: false, ...data };
        s.dealContacts.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const c = s.dealContacts.find((x) => x.id === where.id);
        Object.assign(c, data);
        return c;
      },
    },

    quoteVersion: {
      findFirst: async ({ where, select }) => {
        const v = s.quoteVersions.find(
          (x) => x.dealId === where.dealId && (where.isWorking === undefined || x.isWorking === where.isWorking),
        );
        if (!v) return null;
        return select?.lines
          ? { ...v, lines: s.quoteLines.filter((l) => l.quoteVersionId === v.id).sort((a, b) => a.sortOrder - b.sortOrder) }
          : { ...v };
      },
      create: async ({ data }) => {
        const v = { id: id('qv'), ...data };
        s.quoteVersions.push(v);
        return v;
      },
      update: async ({ where, data }) => {
        const v = s.quoteVersions.find((x) => x.id === where.id);
        Object.assign(v, data);
        return v;
      },
    },
    quoteOffer: {
      findFirst: async ({ where }) => s.quoteOffers.find((o) => o.dealId === where.dealId && o.isPrimary) || null,
      create: async ({ data }) => {
        const o = { id: id('qo'), ...data };
        s.quoteOffers.push(o);
        return o;
      },
    },
    quoteLine: {
      findMany: async ({ where }) => s.quoteLines.filter((l) => l.quoteVersionId === where.quoteVersionId),
      deleteMany: async ({ where }) => {
        const before = s.quoteLines.length;
        s.quoteLines = s.quoteLines.filter((l) => l.quoteVersionId !== where.quoteVersionId);
        return { count: before - s.quoteLines.length };
      },
      createMany: async ({ data }) => {
        for (const row of data) s.quoteLines.push({ id: id('ql'), ...row });
        return { count: data.length };
      },
    },

    priceList: {
      findFirst: async () => ({ defaultVatMode: 'included', defaultVatRate: 18 }),
    },

    task: {
      findMany: async ({ where }) =>
        s.tasks.filter((t) => t.dealId === where.dealId && (!where.status || t.status === where.status)),
      update: async ({ where, data }) => {
        const t = s.tasks.find((x) => x.id === where.id);
        Object.assign(t, data);
        return t;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const t of s.tasks) {
          if (where.id && t.id !== where.id) continue;
          if (where.status && t.status !== where.status) continue;
          Object.assign(t, data);
          count += 1;
        }
        return { count };
      },
    },

    icountDocument: {
      findMany: async ({ where }) => {
        const ids = where.dealId?.in || [where.dealId];
        return s.documents.filter((d) => ids.includes(d.dealId) && (!where.status || d.status === where.status));
      },
    },
    dealCollectionEvidence: {
      findMany: async ({ where }) => {
        const ids = where.dealId?.in || [where.dealId];
        return s.evidence.filter((e) => ids.includes(e.dealId) && (!where.status || e.status === where.status));
      },
    },

    organization: {
      findUnique: async ({ where }) => s.orgs[where.id] || null,
      findMany: async ({ where }) => Object.values(s.orgs).filter((o) => where.id.in.includes(o.id)),
    },
    organizationSubtype: { findUnique: async () => null, findMany: async () => [] },
    // The catalogs the merge PREVIEW reads to turn stored ids into the labels
    // the operator chooses between (deals/mergeFieldLabels.js). Empty by
    // default: these fixtures carry no catalog references, and a field with no
    // row resolves to "ערך שנמחק מהקטלוג" rather than crashing.
    organizationUnit: { findMany: async () => [] },
    organizationType: { findMany: async () => [] },
    product: { findMany: async () => [] },
    location: { findMany: async () => [] },
    dealSource: { findMany: async () => [] },
    paymentTerm: { findMany: async () => [] },
    paymentMethod: { findMany: async () => [] },
    // Contact↔Organization, for the primary-contact identity cards.
    contactOrganization: { findMany: async () => [] },

    tourEvent: {
      findUnique: async ({ where }) => s.tours[where.id] || null,
      update: async ({ where, data }) => Object.assign(s.tours[where.id], data),
      updateMany: async () => ({ count: 0 }),
    },

    booking: {
      findFirst: async ({ where }) =>
        withTour(
          s.bookings.find(
            (b) => b.dealId === where.dealId
              && (where.status ? b.status === where.status : true)
              && (!where.tourEvent || false),
          ),
        ),
      findMany: async ({ where }) =>
        s.bookings.filter((b) => {
          if (where.tourEventId && b.tourEventId !== where.tourEventId) return false;
          if (where.dealId?.in && !where.dealId.in.includes(b.dealId)) return false;
          if (where.dealId && !where.dealId.in && b.dealId !== where.dealId) return false;
          if (where.status && b.status !== where.status) return false;
          return true;
        }),
      create: async ({ data }) => {
        if (data.status === 'active' && s.bookings.some((b) => b.dealId === data.dealId && b.status === 'active')) {
          throw P2002();
        }
        const b = { id: id('bk'), ...data };
        s.bookings.push(b);
        return b;
      },
      update: async ({ where, data }) => {
        const b = s.bookings.find((x) => x.id === where.id);
        // The partial unique, enforced on UPDATE too — this is exactly the path
        // a booking re-parent takes, and the ordering bug it would hide is the
        // whole reason "both deals live" is dangerous.
        if (data.dealId && (data.status ?? b.status) === 'active') {
          const clash = s.bookings.find(
            (x) => x.id !== b.id && x.dealId === data.dealId && x.status === 'active',
          );
          if (clash) throw P2002();
        }
        Object.assign(b, data);
        return b;
      },
      updateMany: async () => ({ count: 0 }),
      count: async ({ where }) =>
        s.bookings.filter(
          (b) => (where.tourEventId ? b.tourEventId === where.tourEventId : true)
            && (where.dealId ? b.dealId === where.dealId : true)
            && (where.status ? b.status === where.status : true)
            && (where.status?.not ? b.status !== where.status.not : true),
        ).length,
      groupBy: async () => [],
    },

    ticketRegistration: {
      findFirst: async ({ where }) =>
        s.registrations.filter((r) => {
          if (where.bookingId !== undefined && r.bookingId !== where.bookingId) return false;
          if (where.dealId !== undefined && r.dealId !== where.dealId) return false;
          if (where.tourEventId !== undefined && r.tourEventId !== where.tourEventId) return false;
          if (where.status?.in && !where.status.in.includes(r.status)) return false;
          return true;
        }).slice(-1)[0] || null,
      findMany: async ({ where }) =>
        s.registrations.filter((r) => {
          if (where.bookingId !== undefined && r.bookingId !== where.bookingId) return false;
          if (where.dealId?.in) { if (!where.dealId.in.includes(r.dealId)) return false; }
          else if (where.dealId !== undefined && r.dealId !== where.dealId) return false;
          if (where.tourEventId !== undefined && r.tourEventId !== where.tourEventId) return false;
          if (where.status?.in && !where.status.in.includes(r.status)) return false;
          return true;
        }),
      count: async ({ where }) =>
        s.registrations.filter(
          (r) => r.dealId === where.dealId && (where.status?.in ? where.status.in.includes(r.status) : true),
        ).length,
      aggregate: async ({ where }) => ({
        _sum: {
          quantity: s.registrations
            .filter((r) => {
              if (where.dealId?.in) { if (!where.dealId.in.includes(r.dealId)) return false; }
              else if (where.dealId !== undefined && r.dealId !== where.dealId) return false;
              if (where.tourEventId !== undefined && r.tourEventId !== where.tourEventId) return false;
              if (where.status?.in && !where.status.in.includes(r.status)) return false;
              return true;
            })
            .reduce((n, r) => n + (r.quantity || 0), 0),
        },
      }),
      groupBy: async ({ where }) => {
        const rows = s.registrations.filter(
          (r) => where.tourEventId?.in?.includes(r.tourEventId) && CAP.includes(r.status),
        );
        const byTour = new Map();
        for (const r of rows) byTour.set(r.tourEventId, (byTour.get(r.tourEventId) || 0) + (r.quantity || 0));
        return [...byTour].map(([tourEventId, q]) => ({ tourEventId, _sum: { quantity: q } }));
      },
      create: async ({ data }) => {
        const r = { id: id('reg'), confirmedAt: null, paymentStatus: null, ...data };
        s.registrations.push(r);
        return r;
      },
      update: async ({ where, data }) => {
        const r = s.registrations.find((x) => x.id === where.id);
        Object.assign(r, data);
        return r;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const r of s.registrations) {
          if (where.id?.in && !where.id.in.includes(r.id)) continue;
          if (where.bookingId !== undefined && r.bookingId !== where.bookingId) continue;
          if (where.dealId !== undefined && r.dealId !== where.dealId) continue;
          if (where.tourEventId !== undefined && r.tourEventId !== where.tourEventId) continue;
          if (where.status?.in && !where.status.in.includes(r.status)) continue;
          Object.assign(r, data);
          count += 1;
        }
        return { count };
      },
    },

    timelineEntry: {
      create: async ({ data }) => {
        const row = { id: id('tl'), createdAt: new Date(), ...data };
        s.timeline.push(row);
        return row;
      },
      count: async ({ where }) =>
        s.timeline.filter((t) => t.subjectType === where.subjectType && t.subjectId === where.subjectId).length,
      findMany: async ({ where }) =>
        s.timeline.filter((t) => {
          if (where.subjectId?.in) return where.subjectId.in.includes(t.subjectId);
          return t.subjectId === where.subjectId;
        }),
      findFirst: async () => null,
      update: async () => ({}),
    },

    reviewItem: {
      create: async ({ data }) => {
        if (s.reviewItems.some((r) => r.dedupeKey === data.dedupeKey)) throw P2002();
        const row = { id: id('rev'), status: 'open', ...data };
        s.reviewItems.push(row);
        return row;
      },
      findUnique: async ({ where }) => s.reviewItems.find((r) => r.dedupeKey === where.dedupeKey) || null,
      findFirst: async () => null,
    },

    adminUser: { findUnique: async () => ({ username: 'tester' }), findMany: async () => [] },
    dealStage: { findFirst: async () => ({ id: 'stageFinal' }) },
    dealTourPlan: { findUnique: async () => null, upsert: async () => ({ id: 'plan1' }), update: async () => ({}) },
    dealTourPlanAssignment: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    dealTourPlanActivityComponent: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    tourAssignment: { findMany: async () => [], count: async () => 0, deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    tourEventActivityComponent: { findMany: async () => [], deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    productVariant: { findMany: async () => [], findUnique: async () => null },
    productVariantActivityComponent: { findMany: async () => [] },
    openTourTemplateProduct: { findMany: async () => [], findFirst: async () => null },
    tourGallery: { findUnique: async () => null },
    tourGalleryLink: { updateMany: async () => ({ count: 0 }) },
    tourGalleryCleanupTask: { create: async () => ({}), findFirst: async () => null },
    quoteDocument: { findFirst: async () => null, create: async () => ({}) },
    communicationDelivery: { findMany: async () => [], updateMany: async () => ({ count: 0 }), count: async () => 0 },
  };
  return client;
}
