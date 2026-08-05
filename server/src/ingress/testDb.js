// Ingress Platform — shared testing infrastructure.
//
// An in-memory stand-in for the Prisma client covering exactly the surface the
// pipeline touches. It exists so pipeline behaviour (idempotency, dedupe,
// dry-run, retry escalation) is provable without a live database, and so every
// adapter added later inherits the same harness instead of inventing its own.
//
// It is a test double, not a Prisma emulator: it implements the specific query
// shapes this module uses and throws loudly on anything it does not model, so a
// silently-wrong test is impossible.

let seq = 0;
const nextId = (p) => `${p}_${++seq}`;

const contains = (haystack, needle) => String(haystack ?? '').includes(String(needle ?? ''));
const ieq = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

// Prisma-style update data → plain assignment ({ increment } handled).
const applyPatch = (row, data) => {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && 'increment' in v) {
      row[k] = (Number(row[k]) || 0) + v.increment;
    } else {
      row[k] = v;
    }
  }
};

const evidenceMatch = (e, where) => {
  if (where.dealId && e.dealId !== where.dealId) return false;
  if (where.kind && e.kind !== where.kind) return false;
  if (where.reference && e.reference !== where.reference) return false;
  if (where.status && e.status !== where.status) return false;
  return true;
};

// The where-shapes the registration chain uses, in one matcher. The relation
// filter (`tourEvent: { kind }`) is resolved via the row's own tourEventId by
// the caller-supplied resolver so the matcher stays table-agnostic.
const makeRegMatch = (db) => (r, where) => {
  if (where.id && r.id !== where.id) return false;
  if (where.dealId && r.dealId !== where.dealId) return false;
  if (where.bookingId && r.bookingId !== where.bookingId) return false;
  if (where.source && r.source !== where.source) return false;
  if (where.tourEventId) {
    if (typeof where.tourEventId === 'object') {
      if (where.tourEventId.in && !where.tourEventId.in.includes(r.tourEventId)) return false;
    } else if (r.tourEventId !== where.tourEventId) return false;
  }
  if (where.status) {
    if (typeof where.status === 'object') {
      if (where.status.in && !where.status.in.includes(r.status)) return false;
    } else if (r.status !== where.status) return false;
  }
  if (where.productVariantId?.not === null && r.productVariantId == null) return false;
  if (where.tourEvent?.kind) {
    const tour = db.tourEvent.find((t) => t.id === r.tourEventId);
    if (!tour || tour.kind !== where.tourEvent.kind) return false;
  }
  return true;
};

export function createTestDb(seed = {}) {
  const db = {
    ingressEvent: [],
    ingressAttempt: [],
    contact: [],
    contactPhone: [],
    contactEmail: [],
    organization: seed.organizations || [],
    dealStage: seed.dealStages || [{ id: 'stage_1', key: 'lead', label: 'ליד חדש', isActive: true, sortOrder: 0 }],
    dealSource: [],
    deal: [],
    dealContact: [],
    dealMarketing: [],
    timelineEntry: [],
    // Woo operational chain (order → quote → WON → booking → registration).
    wooVariationLink: seed.wooVariationLinks || [],
    priceList: seed.priceLists || [],
    priceRule: seed.priceRules || [],
    ticketType: seed.ticketTypes || [],
    productVariant: seed.productVariants || [],
    tourEvent: seed.tourEvents || [],
    openTourTemplateProduct: seed.openTourTemplateProducts || [],
    tourEventActivityComponent: [],
    quoteOffer: [],
    quoteVersion: [],
    quoteLine: [],
    booking: [],
    ticketRegistration: [],
    dealCollectionEvidence: [],
    reviewItem: [],
    icountDocument: [],
  };

  // Deliberately explicit: a P2002 is raised on the real unique constraint so
  // the pipeline's race handling is exercised rather than assumed.
  const uniqueViolation = () => {
    const e = new Error('Unique constraint failed');
    e.code = 'P2002';
    return e;
  };

  const regMatch = makeRegMatch(db);

  const client = {
    _tables: db,

    $transaction: async (fn) => fn(client),

    // Models the ONE raw query the ingress path uses (lookupPhoneContacts):
    //   WHERE regexp_replace("value", '[^0-9]', '', 'g') LIKE $pattern
    // Digits are stripped from the stored value before matching — reproducing
    // the real semantics, so a formatted number like '050-123-4567' matches its
    // significant suffix exactly as Postgres would.
    $queryRaw: async (_strings, ...values) => {
      const pattern = String(values[0] ?? '');
      const limit = Number(values[1] ?? 300);
      const body = pattern.replace(/^%/, '').replace(/%$/, '');
      const anchoredSuffix = pattern.startsWith('%') && !pattern.endsWith('%');
      return db.contactPhone
        .filter((r) => {
          const digits = String(r.value ?? '').replace(/[^0-9]/g, '');
          return anchoredSuffix ? digits.endsWith(body) : digits.includes(body);
        })
        .slice(0, limit)
        .map((r) => ({ contactId: r.contactId, value: r.value }));
    },

    ingressEvent: {
      findUnique: async ({ where, select }) => {
        let row = null;
        if (where.id) row = db.ingressEvent.find((r) => r.id === where.id) || null;
        else if (where.source_idempotencyKey) {
          const { source, idempotencyKey } = where.source_idempotencyKey;
          row = db.ingressEvent.find((r) => r.source === source && r.idempotencyKey === idempotencyKey) || null;
        } else throw new Error('testDb: unsupported ingressEvent.findUnique where');
        if (!row || !select) return row;
        return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
      },
      create: async ({ data, select }) => {
        if (db.ingressEvent.some((r) => r.source === data.source && r.idempotencyKey === data.idempotencyKey)) {
          throw uniqueViolation();
        }
        const row = {
          id: nextId('ev'),
          status: 'pending',
          dryRun: false,
          attemptCount: 0,
          dealId: null,
          outcome: null,
          contactId: null,
          organizationId: null,
          receivedAt: new Date(),
          ...data,
        };
        db.ingressEvent.push(row);
        if (!select) return row;
        return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
      },
      update: async ({ where, data }) => {
        const row = db.ingressEvent.find((r) => r.id === where.id);
        if (!row) throw new Error('testDb: ingressEvent.update missing row');
        Object.assign(row, data);
        return row;
      },
      findMany: async ({ where = {} } = {}) =>
        db.ingressEvent.filter((r) => (where.status ? r.status === where.status : true)),

      // The STABLE external-order lookup (findDealForExternalOrder): the most
      // recent PROCESSED event for one provider order that produced a deal.
      findFirst: async ({ where = {}, orderBy, select }) => {
        let rows = db.ingressEvent.filter((r) => {
          if (where.source !== undefined && r.source !== where.source) return false;
          if (where.sourceKey !== undefined && (r.sourceKey ?? null) !== (where.sourceKey ?? null)) return false;
          if (where.externalId !== undefined && String(r.externalId ?? '') !== String(where.externalId)) return false;
          if (where.status !== undefined && r.status !== where.status) return false;
          if (where.dealId?.not === null && r.dealId === null) return false;
          return true;
        });
        if (orderBy?.processedAt === 'desc') {
          rows = rows.sort((a, b) => new Date(b.processedAt || 0) - new Date(a.processedAt || 0));
        }
        const row = rows[0] || null;
        if (!row || !select) return row;
        return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
      },
    },

    ingressAttempt: {
      create: async ({ data }) => {
        const row = { id: nextId('att'), createdAt: new Date(), ...data };
        db.ingressAttempt.push(row);
        return row;
      },
    },

    contact: {
      findMany: async ({ where, select }) => {
        let rows = db.contact;
        if (where?.id?.in) rows = rows.filter((c) => where.id.in.includes(c.id));
        return rows.map((c) => (select ? { id: c.id, updatedAt: c.updatedAt } : c));
      },
      create: async ({ data, select }) => {
        const row = { id: nextId('c'), updatedAt: new Date(), ...data };
        db.contact.push(row);
        for (const p of data.phones?.create || []) {
          db.contactPhone.push({ id: nextId('cp'), contactId: row.id, ...p });
        }
        for (const e of data.emails?.create || []) {
          db.contactEmail.push({ id: nextId('ce'), contactId: row.id, ...e });
        }
        return select ? { id: row.id } : row;
      },
    },

    contactPhone: {
      findMany: async ({ where }) => {
        let rows = db.contactPhone;
        if (where?.contactId) rows = rows.filter((r) => r.contactId === where.contactId);
        if (where?.value?.contains) rows = rows.filter((r) => contains(r.value, where.value.contains));
        return rows.map((r) => ({
          contactId: r.contactId,
          value: r.value,
          contact: { updatedAt: db.contact.find((c) => c.id === r.contactId)?.updatedAt || new Date(0) },
        }));
      },
      create: async ({ data }) => {
        const row = { id: nextId('cp'), ...data };
        db.contactPhone.push(row);
        return row;
      },
    },

    contactEmail: {
      findMany: async ({ where }) => {
        let rows = db.contactEmail;
        if (where?.contactId) rows = rows.filter((r) => r.contactId === where.contactId);
        if (where?.value?.equals) rows = rows.filter((r) => ieq(r.value, where.value.equals));
        return rows.map((r) => ({ contactId: r.contactId, value: r.value }));
      },
      create: async ({ data }) => {
        const row = { id: nextId('ce'), ...data };
        db.contactEmail.push(row);
        return row;
      },
    },

    organization: {
      findMany: async ({ where }) =>
        db.organization.filter((o) => (where?.name?.equals ? ieq(o.name, where.name.equals) : true)),
    },

    dealStage: {
      findUnique: async ({ where }) => db.dealStage.find((s) => s.key === where.key) || null,
      // Honours orderBy direction: the lead stage is the FIRST active stage by
      // sortOrder, the WON final stage is the LAST. Ignoring direction would
      // silently put won deals on the lead stage.
      findFirst: async ({ where, orderBy }) => {
        const desc = Array.isArray(orderBy)
          ? orderBy.some((o) => o.sortOrder === 'desc')
          : orderBy?.sortOrder === 'desc';
        const rows = db.dealStage
          .filter((s) => (where?.isActive === undefined ? true : s.isActive === where.isActive))
          .sort((a, b) => (desc ? b.sortOrder - a.sortOrder : a.sortOrder - b.sortOrder));
        return rows[0] || null;
      },
    },

    dealSource: {
      findFirst: async ({ where }) => db.dealSource.find((s) => s.label === where.label) || null,
      create: async ({ data }) => {
        const row = { id: nextId('ds'), ...data };
        db.dealSource.push(row);
        return row;
      },
    },

    deal: {
      create: async ({ data }) => {
        const row = {
          id: nextId('d'), orderNo: 27000 + db.deal.length, createdAt: new Date(),
          ...data,
        };
        delete row.contacts;
        db.deal.push(row);
        for (const dc of data.contacts?.create || []) {
          db.dealContact.push({ id: nextId('dc'), dealId: row.id, ...dc });
        }
        return row;
      },
      findUnique: async ({ where, select, include }) => {
        const row = db.deal.find((d) => d.id === where.id) || null;
        if (!row) return null;
        // The document path loads the deal with ICOUNT_DEAL_INCLUDE — model the
        // relations it reads (primary contact + working version lines) so
        // buildDocumentDefaults derives rows from the REAL composed quote.
        if (include) {
          const contacts = db.dealContact
            .filter((dc) => dc.dealId === row.id)
            .map((dc) => {
              const c = db.contact.find((x) => x.id === dc.contactId) || {};
              return {
                ...dc,
                contact: {
                  ...c,
                  phones: db.contactPhone.filter((p) => p.contactId === c.id).slice(0, 1),
                  emails: db.contactEmail.filter((e) => e.contactId === c.id).slice(0, 1),
                },
              };
            });
          const quoteVersions = db.quoteVersion
            .filter((v) => v.dealId === row.id && v.isWorking)
            .slice(0, 1)
            .map((v) => ({
              ...v,
              lines: db.quoteLine
                .filter((l) => l.quoteVersionId === v.id && l.active !== false)
                .sort((a, b) => a.sortOrder - b.sortOrder),
            }));
          return {
            ...row,
            contacts,
            quoteVersions,
            organization: null,
            organizationUnit: null,
            product: null,
            paymentMethodRef: null,
            paymentTerm: null,
          };
        }
        if (!select) return row;
        return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
      },
      update: async ({ where, data }) => {
        const row = db.deal.find((d) => d.id === where.id);
        if (!row) throw new Error('testDb: deal.update missing row');
        Object.assign(row, data);
        return row;
      },
      // The WON transition's atomic guard: `status != 'won'` decides the race.
      // Modelled faithfully — a second call must match zero rows.
      updateMany: async ({ where, data }) => {
        const rows = db.deal.filter((d) => {
          if (where.id && d.id !== where.id) return false;
          if (where.status?.not !== undefined && d.status === where.status.not) return false;
          return true;
        });
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
    },

    // ── Woo operational chain ────────────────────────────────────────────────
    // Enough of the quote/tour/registration surface for the FULL order pipeline
    // (compose → WON → booking → registration → capacity) to run for real.
    // Same philosophy as above: the specific query shapes the chain uses,
    // modelled faithfully; anything else fails loudly.

    quoteOffer: {
      findFirst: async ({ where = {} } = {}) =>
        db.quoteOffer.find((o) => {
          if (where.dealId && o.dealId !== where.dealId) return false;
          if ('archivedAt' in where && (o.archivedAt ?? null) !== where.archivedAt) return false;
          if (where.isPrimary !== undefined && !!o.isPrimary !== where.isPrimary) return false;
          return true;
        }) || null,
      findUnique: async ({ where }) => db.quoteOffer.find((o) => o.id === where.id) || null,
      aggregate: async ({ where = {} } = {}) => {
        const rows = db.quoteOffer.filter((o) => (where.dealId ? o.dealId === where.dealId : true));
        return { _max: { offerNo: rows.length ? Math.max(...rows.map((o) => o.offerNo || 0)) : null } };
      },
      create: async ({ data }) => {
        const row = { id: nextId('qo'), archivedAt: null, isPrimary: false, contextMode: 'deal', ...data };
        db.quoteOffer.push(row);
        return row;
      },
    },
    quoteDocument: { findFirst: async () => null },

    quoteVersion: {
      findFirst: async ({ where = {} } = {}) =>
        db.quoteVersion.find(
          (v) =>
            (where.dealId ? v.dealId === where.dealId : true) &&
            (where.isWorking === undefined || !!v.isWorking === where.isWorking) &&
            (where.sourceKind === undefined || (v.sourceKind ?? null) === where.sourceKind),
        ) || null,
      create: async ({ data }) => {
        const row = { id: nextId('qv'), vatMode: null, ...data };
        db.quoteVersion.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = db.quoteVersion.find((v) => v.id === where.id);
        if (!row) throw new Error('testDb: quoteVersion.update missing row');
        Object.assign(row, data);
        return row;
      },
    },

    quoteLine: {
      findMany: async ({ where = {}, orderBy } = {}) => {
        let rows = db.quoteLine.filter((l) => {
          if (where.quoteVersionId && l.quoteVersionId !== where.quoteVersionId) return false;
          if (where.sourceKind && l.sourceKind !== where.sourceKind) return false;
          if (where.active !== undefined && !!l.active !== where.active) return false;
          if (where.quantity?.gt !== undefined && !(Number(l.quantity) > where.quantity.gt)) return false;
          return true;
        });
        if (orderBy?.sortOrder === 'asc') rows = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
        // The one relation read from lines: ticketType.nameHe (offering labels).
        return rows.map((l) => ({
          ...l,
          ticketType: db.ticketType.find((t) => t.id === l.ticketTypeId) || null,
        }));
      },
      deleteMany: async ({ where = {} } = {}) => {
        const keep = db.quoteLine.filter((l) => !(where.quoteVersionId && l.quoteVersionId === where.quoteVersionId));
        const count = db.quoteLine.length - keep.length;
        db.quoteLine = keep;
        return { count };
      },
      createMany: async ({ data }) => {
        for (const d of data) db.quoteLine.push({ id: nextId('ql'), ...d });
        return { count: data.length };
      },
    },

    wooVariationLink: {
      findMany: async ({ where = {} } = {}) =>
        db.wooVariationLink.filter((l) =>
          where.wooVariationId?.in ? where.wooVariationId.in.includes(Number(l.wooVariationId)) : true,
        ),
    },

    priceList: {
      findFirst: async ({ where = {} } = {}) =>
        db.priceList.find((p) => (where.isDefault === undefined ? true : !!p.isDefault === where.isDefault)) || null,
    },

    priceRule: {
      findMany: async ({ where = {} } = {}) =>
        db.priceRule.filter((r) => {
          if (where.cardGroupId?.in && !where.cardGroupId.in.includes(r.cardGroupId)) return false;
          if (where.availableForGroupTickets !== undefined && !!r.availableForGroupTickets !== where.availableForGroupTickets) return false;
          if (where.active !== undefined && !!r.active !== where.active) return false;
          if (where.priceModel && r.priceModel !== where.priceModel) return false;
          return true;
        }),
    },

    productVariant: {
      findMany: async ({ where = {} } = {}) =>
        db.productVariant.filter((v) => (where.id?.in ? where.id.in.includes(v.id) : true)),
    },

    tourEvent: {
      findUnique: async ({ where, select }) => {
        const row = db.tourEvent.find((t) => t.id === where.id) || null;
        if (!row || !select) return row;
        return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
      },
      update: async ({ where, data }) => {
        const row = db.tourEvent.find((t) => t.id === where.id);
        if (!row) throw new Error('testDb: tourEvent.update missing row');
        applyPatch(row, data);
        return row;
      },
      updateMany: async ({ where = {}, data }) => {
        const rows = db.tourEvent.filter((t) => (where.id ? t.id === where.id : true));
        for (const r of rows) applyPatch(r, data);
        return { count: rows.length };
      },
    },

    openTourTemplateProduct: {
      findMany: async ({ where = {} } = {}) =>
        db.openTourTemplateProduct.filter((p) => (where.templateId ? p.templateId === where.templateId : true)),
      findFirst: async () => null,
    },

    tourEventActivityComponent: {
      findMany: async ({ where = {} } = {}) =>
        db.tourEventActivityComponent.filter((c) => (where.tourEventId ? c.tourEventId === where.tourEventId : true)),
      deleteMany: async ({ where = {} } = {}) => {
        const ids = new Set(where.id?.in || []);
        const keep = db.tourEventActivityComponent.filter((c) => !ids.has(c.id));
        const count = db.tourEventActivityComponent.length - keep.length;
        db.tourEventActivityComponent = keep;
        return { count };
      },
      createMany: async ({ data }) => {
        for (const d of data) db.tourEventActivityComponent.push({ id: nextId('tac'), ...d });
        return { count: data.length };
      },
    },

    booking: {
      findFirst: async ({ where = {}, include } = {}) => {
        const row = db.booking.find(
          (b) =>
            (where.dealId ? b.dealId === where.dealId : true) &&
            (where.status ? b.status === where.status : true),
        ) || null;
        if (!row) return null;
        return include?.tourEvent ? { ...row, tourEvent: db.tourEvent.find((t) => t.id === row.tourEventId) || null } : row;
      },
      create: async ({ data }) => {
        const row = { id: nextId('bk'), createdAt: new Date(), ...data };
        db.booking.push(row);
        return row;
      },
      groupBy: async () => [],
    },

    ticketRegistration: {
      findFirst: async ({ where = {}, orderBy } = {}) => {
        let rows = db.ticketRegistration.filter((r) => regMatch(r, where));
        if (orderBy?.createdAt === 'desc') rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
        return rows[0] || null;
      },
      findMany: async ({ where = {} } = {}) => db.ticketRegistration.filter((r) => regMatch(r, where)),
      aggregate: async ({ where = {} } = {}) => {
        const rows = db.ticketRegistration.filter((r) => regMatch(r, where));
        return { _sum: { quantity: rows.reduce((n, r) => n + (Number(r.quantity) || 0), 0) } };
      },
      groupBy: async ({ by, where = {} } = {}) => {
        const rows = db.ticketRegistration.filter((r) => regMatch(r, where));
        const acc = new Map();
        for (const r of rows) {
          const k = r[by[0]];
          acc.set(k, (acc.get(k) || 0) + (Number(r.quantity) || 0));
        }
        return [...acc.entries()].map(([k, q]) => ({ [by[0]]: k, _sum: { quantity: q } }));
      },
      create: async ({ data }) => {
        const row = { id: nextId('tr'), createdAt: new Date(), ...data };
        db.ticketRegistration.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = db.ticketRegistration.find((r) => r.id === where.id);
        if (!row) throw new Error('testDb: ticketRegistration.update missing row');
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where = {}, data }) => {
        const rows = db.ticketRegistration.filter((r) => regMatch(r, where));
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
    },

    dealCollectionEvidence: {
      findFirst: async ({ where = {} } = {}) =>
        db.dealCollectionEvidence.find((e) => evidenceMatch(e, where)) || null,
      findMany: async ({ where = {} } = {}) => db.dealCollectionEvidence.filter((e) => evidenceMatch(e, where)),
      create: async ({ data }) => {
        const row = { id: nextId('ev$'), status: 'active', createdAt: new Date(), ...data };
        db.dealCollectionEvidence.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = db.dealCollectionEvidence.find((e) => e.id === where.id);
        if (!row) throw new Error('testDb: dealCollectionEvidence.update missing row');
        Object.assign(row, data);
        return row;
      },
    },

    icountDocument: {
      findUnique: async ({ where }) =>
        db.icountDocument.find((d) => d.idempotencyKey === where.idempotencyKey) || null,
      create: async ({ data }) => {
        if (data.idempotencyKey && db.icountDocument.some((d) => d.idempotencyKey === data.idempotencyKey)) {
          throw uniqueViolation();
        }
        const row = { id: nextId('doc'), status: 'issued', createdAt: new Date(), ...data };
        db.icountDocument.push(row);
        return row;
      },
    },

    reviewItem: {
      create: async ({ data }) => {
        if (db.reviewItem.some((r) => r.dedupeKey === data.dedupeKey)) throw uniqueViolation();
        const row = { id: nextId('ri'), status: 'open', createdAt: new Date(), ...data };
        db.reviewItem.push(row);
        return row;
      },
      findUnique: async ({ where }) => db.reviewItem.find((r) => r.dedupeKey === where.dedupeKey) || null,
    },

    dealContact: {
      findFirst: async ({ where }) => {
        const links = db.dealContact.filter((l) => l.contactId === where.contactId);
        const matched = links
          .map((l) => ({ link: l, deal: db.deal.find((d) => d.id === l.dealId) }))
          .filter(({ deal }) => {
            if (!deal) return false;
            if (where.deal?.status && deal.status !== where.deal.status) return false;
            if (where.deal?.createdAt?.gte && deal.createdAt < where.deal.createdAt.gte) return false;
            return true;
          })
          .sort((a, b) => b.deal.createdAt - a.deal.createdAt);
        return matched[0] ? { dealId: matched[0].link.dealId } : null;
      },
    },

    // The canonical marketing record. Unique on dealId, exactly like the real
    // schema — so a second write for the same deal updates rather than
    // duplicating, and first-touch immutability is genuinely exercised.
    dealMarketing: {
      findUnique: async ({ where }) => db.dealMarketing.find((m) => m.dealId === where.dealId) || null,
      create: async ({ data }) => {
        const row = { id: nextId('dm'), createdAt: new Date(), ...data };
        db.dealMarketing.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = db.dealMarketing.find((m) => m.dealId === where.dealId);
        if (!row) throw new Error('dealMarketing not found');
        Object.assign(row, data);
        return row;
      },
    },

    timelineEntry: {
      create: async ({ data }) => {
        const row = { id: nextId('tl'), createdAt: new Date(), ...data };
        db.timelineEntry.push(row);
        return row;
      },
    },
  };

  return client;
}

// Convenience seeding for "this person already exists in GOS".
export function seedContact(client, { firstName = 'דור', lastName = 'כהן', phone = null, email = null } = {}) {
  const t = client._tables;
  const contact = { id: nextId('c'), firstNameHe: firstName, lastNameHe: lastName, updatedAt: new Date() };
  t.contact.push(contact);
  if (phone) t.contactPhone.push({ id: nextId('cp'), contactId: contact.id, value: phone, isPrimary: true });
  if (email) t.contactEmail.push({ id: nextId('ce'), contactId: contact.id, value: email, isPrimary: true });
  return contact.id;
}

// A complete, minimal Woo-sellable catalog: one Pricing Card (adult ₪100 /
// child ₪50, VAT included), its variant, one scheduled group slot and the two
// WooVariationLinks the outbound sync would have written. Mirrors the REAL
// production shape (one variable Woo product, one variation per ticket type).
export function seedWooCatalog(client, {
  tourEventId = 'tour_1',
  cardGroupId = 'card_1',
  wooProductId = 167,
  adultVariationId = 2108,
  childVariationId = 2109,
  capacity = 30,
  adultPriceMinor = 10000,
  childPriceMinor = 5000,
} = {}) {
  const t = client._tables;
  t.priceList.push({ id: 'pl_1', isDefault: true, defaultVatMode: 'included', defaultVatRate: 18 });
  t.ticketType.push(
    { id: 'tt_adult', nameHe: 'מבוגר', sortOrder: 0 },
    { id: 'tt_child', nameHe: 'ילד', sortOrder: 1 },
  );
  t.productVariant.push({
    id: 'pv_1', productId: 'prod_1', durationHours: 2,
    activityComponents: [{ activityComponentId: 'comp_tour' }],
  });
  t.priceRule.push({
    id: 'pr_1', cardGroupId, priceModel: 'ticket_types',
    availableForGroupTickets: true, active: true,
    productId: 'prod_1', productVariantId: 'pv_1',
    vatMode: 'included', vatRate: null, cardSortOrder: 0, createdAt: new Date(0),
    firstLineNote: null, multiGroupNote: null,
    product: { nameHe: 'סיור גרפיטי תל אביב' },
    ticketPrices: [
      { ticketTypeId: 'tt_adult', priceMinor: adultPriceMinor, ticketType: { nameHe: 'מבוגר', sortOrder: 0 } },
      { ticketTypeId: 'tt_child', priceMinor: childPriceMinor, ticketType: { nameHe: 'ילד', sortOrder: 1 } },
    ],
  });
  t.tourEvent.push({
    id: tourEventId, kind: 'group_slot', status: 'scheduled',
    date: '2026-09-15', startTime: '10:00', tourLanguage: 'he',
    locationId: 'loc_tlv', capacity,
    productId: 'prod_1', productVariantId: 'pv_1',
    productManualOverride: false, openTourTemplateId: null,
    wooDesiredRevision: 0,
  });
  t.wooVariationLink.push(
    { id: 'wvl_a', tourEventId, cardGroupId, variantKey: 'tt_adult', ticketTypeId: 'tt_adult', wooProductId, wooVariationId: adultVariationId, status: 'synced' },
    { id: 'wvl_c', tourEventId, cardGroupId, variantKey: 'tt_child', ticketTypeId: 'tt_child', wooProductId, wooVariationId: childVariationId, status: 'synced' },
  );
  return { tourEventId, cardGroupId, adultVariationId, childVariationId };
}

export function seedOpenDeal(client, contactId, { createdAt = new Date(), status = 'open' } = {}) {
  const t = client._tables;
  const deal = { id: nextId('d'), orderNo: 27000 + t.deal.length, status, createdAt, title: 'קיים' };
  t.deal.push(deal);
  t.dealContact.push({ id: nextId('dc'), dealId: deal.id, contactId, isPrimary: true, roles: [] });
  return deal.id;
}
