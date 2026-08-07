// The shared in-memory Prisma stand-in for the activity-conversion suites.
//
// Extracted so the conversion tests and the בקרה drift-recovery tests exercise
// the SAME fake. Two divergent fakes would let one suite prove something the
// other quietly contradicts — and the whole point of these tests is that the
// real orchestration (tourFromDeal, registrations, the classification rule)
// runs against them unmodified.
//
// Faithful on the two things the design rests on: the one-active-booking
// partial unique (which forces cancel-before-create ordering) and seats living
// on TicketRegistration rather than on Booking. It also enforces the
// conversionOpId unique, because idempotency proven against a fake that does
// not enforce it is not proven at all.
//
// NOT a general-purpose Prisma mock, and deliberately so: it implements exactly
// the calls this feature's code path makes. A missing method is a loud crash,
// which is the honest outcome — see activityConversion.prismaShape.test.js for
// the guard that the FIELD NAMES are real, which no fake can prove.

export const CAP = ['active', 'held', 'confirmed'];

export const WON_FIELDS = {
  status: 'won',
  productId: 'p1',
  productVariantId: 'v1',
  locationId: 'l1',
  tourDate: '2026-09-10',
  tourTime: '10:00',
  participants: 4,
  tourLanguage: 'he',
  valueMinor: 120000n,
  currency: 'ILS',
};
export function makeConversionStore(init = {}) {
  const s = {
    deals: { ...(init.deals || {}) },
    tours: { ...(init.tours || {}) },
    bookings: init.bookings ? [...init.bookings] : [],
    registrations: init.registrations ? [...init.registrations] : [],
    deliveries: init.deliveries ? [...init.deliveries] : [],
    orgs: init.orgs || {},
    timeline: [],
    plans: {},
    seq: 0,
  };
  const id = (p) => `${p}${++s.seq}`;
  const withTour = (b) => (b ? { ...b, tourEvent: s.tours[b.tourEventId] || null } : null);

  const client = {
    _s: s,
    $transaction: async (fn) => fn(client),
    $executeRaw: async () => 1,
    $executeRawUnsafe: async () => 1,

    deal: {
      findUnique: async ({ where }) => {
        if (where.conversionOpId !== undefined) {
          return Object.values(s.deals).find((d) => d.conversionOpId === where.conversionOpId) || null;
        }
        return s.deals[where.id] || null;
      },
      update: async ({ where, data }) => {
        const d = s.deals[where.id];
        // The DB unique on conversionOpId is the idempotency guarantee — the
        // fake must enforce it or the test proves nothing about concurrency.
        if (data.conversionOpId) {
          const clash = Object.values(s.deals).find(
            (x) => x.id !== where.id && x.conversionOpId === data.conversionOpId,
          );
          if (clash) {
            const e = new Error('unique');
            e.code = 'P2002';
            throw e;
          }
        }
        Object.assign(d, data);
        return d;
      },
    },
    organization: { findUnique: async ({ where }) => s.orgs[where.id] || null },
    organizationSubtype: { findUnique: async () => null },

    tourEvent: {
      findUnique: async ({ where }) => s.tours[where.id] || null,
      create: async ({ data }) => {
        const t = { id: id('tour'), status: 'scheduled', ...data };
        s.tours[t.id] = t;
        return t;
      },
      update: async ({ where, data }) => Object.assign(s.tours[where.id], data),
      updateMany: async () => ({ count: 1 }),
    },

    booking: {
      findFirst: async ({ where }) =>
        withTour(
          s.bookings.find(
            (b) =>
              b.dealId === where.dealId
              && (where.status ? b.status === where.status : true)
              // the reactivation lookup: a cancelled booking on a cancelled
              // private/business tour
              && (!where.tourEvent
                || (s.tours[b.tourEventId]
                  && where.tourEvent.kind?.in?.includes(s.tours[b.tourEventId].kind)
                  && s.tours[b.tourEventId].status === where.tourEvent.status)),
          ),
        ),
      findMany: async ({ where }) =>
        s.bookings.filter((b) => b.tourEventId === where.tourEventId && b.status === where.status),
      create: async ({ data }) => {
        // Booking_one_active_per_deal_key — the partial unique that forces the
        // cancel-before-create ordering. Enforced here for exactly that reason.
        if (data.status === 'active' && s.bookings.some((b) => b.dealId === data.dealId && b.status === 'active')) {
          const e = new Error('unique');
          e.code = 'P2002';
          throw e;
        }
        const b = { id: id('bk'), ...data };
        s.bookings.push(b);
        return b;
      },
      update: async ({ where, data }) => {
        const b = s.bookings.find((x) => x.id === where.id);
        Object.assign(b, data);
        return b;
      },
      updateMany: async () => ({ count: 0 }),
      count: async ({ where }) =>
        s.bookings.filter(
          (b) =>
            (where.tourEventId ? b.tourEventId === where.tourEventId : true)
            && (where.dealId ? b.dealId === where.dealId : true)
            && (where.status ? b.status === where.status : true),
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
          if (where.dealId !== undefined && r.dealId !== where.dealId) return false;
          if (where.tourEventId !== undefined && r.tourEventId !== where.tourEventId) return false;
          if (where.status?.in && !where.status.in.includes(r.status)) return false;
          if (where.source && r.source !== where.source) return false;
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
              if (where.dealId !== undefined && r.dealId !== where.dealId) return false;
              if (where.tourEventId !== undefined && r.tourEventId !== where.tourEventId) return false;
              if (where.status?.in && !where.status.in.includes(r.status)) return false;
              if (typeof where.status === 'string' && r.status !== where.status) return false;
              return true;
            })
            .reduce((n, r) => n + (r.quantity || 0), 0),
        },
        _count: { _all: 0 },
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
          if (where.dealId !== undefined && r.dealId !== where.dealId) continue;
          if (where.tourEventId !== undefined && r.tourEventId !== where.tourEventId) continue;
          if (where.status?.in && !where.status.in.includes(r.status)) continue;
          Object.assign(r, data);
          count += 1;
        }
        return { count };
      },
    },

    communicationDelivery: {
      findMany: async ({ where }) =>
        s.deliveries.filter(
          (d) =>
            d.dealId === where.dealId
            && d.tourEventId === where.tourEventId
            && where.status.in.includes(d.status),
        ),
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const d of s.deliveries) {
          if (where.id?.in && !where.id.in.includes(d.id)) continue;
          Object.assign(d, data);
          count += 1;
        }
        return { count };
      },
      count: async ({ where }) =>
        s.deliveries.filter(
          (d) => d.dealId === where.dealId && where.status.in.includes(d.status),
        ).length,
    },

    dealTourPlan: {
      findUnique: async ({ where }) => s.plans[where.dealId] || null,
      upsert: async ({ where, create }) => {
        if (!s.plans[where.dealId]) s.plans[where.dealId] = { id: id('plan'), ...create };
        return s.plans[where.dealId];
      },
      update: async ({ where, data }) => {
        const p = Object.values(s.plans).find((x) => x.id === where.id);
        Object.assign(p, data);
        return p;
      },
    },
    dealTourPlanAssignment: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    dealTourPlanActivityComponent: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    tourAssignment: {
      findMany: async () => [],
      count: async () => 0,
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    tourEventActivityComponent: {
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    productVariant: { findMany: async () => [], findUnique: async () => null },
    productVariantActivityComponent: { findMany: async () => [] },
    openTourTemplateProduct: { findMany: async () => [], findFirst: async () => null },
    quoteLine: { findMany: async () => [] },
    quoteVersion: { findFirst: async () => null },
    quoteOffer: { findFirst: async () => null },
    tourGallery: { findUnique: async () => null },
    tourGalleryLink: { updateMany: async () => ({ count: 0 }) },
    tourGalleryCleanupTask: { create: async () => ({}), findFirst: async () => null },
    timelineEntry: {
      create: async ({ data }) => {
        const row = { id: id('tl'), createdAt: new Date(), ...data };
        s.timeline.push(row);
        return row;
      },
      findFirst: async () => null,
      update: async () => ({}),
    },
  };
  return client;
}
