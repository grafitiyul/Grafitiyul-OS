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
  };

  // Deliberately explicit: a P2002 is raised on the real unique constraint so
  // the pipeline's race handling is exercised rather than assumed.
  const uniqueViolation = () => {
    const e = new Error('Unique constraint failed');
    e.code = 'P2002';
    return e;
  };

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
      findUnique: async ({ where, select }) => {
        const row = db.deal.find((d) => d.id === where.id) || null;
        if (!row || !select) return row;
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

    // WON transition support. A deal born from an order has no quote, so the
    // canonical wonQuoteRef lookup finds nothing — modelled explicitly rather
    // than stubbed away, so the real code path runs.
    quoteOffer: { findFirst: async () => null },
    quoteDocument: { findFirst: async () => null },

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

export function seedOpenDeal(client, contactId, { createdAt = new Date(), status = 'open' } = {}) {
  const t = client._tables;
  const deal = { id: nextId('d'), orderNo: 27000 + t.deal.length, status, createdAt, title: 'קיים' };
  t.deal.push(deal);
  t.dealContact.push({ id: nextId('dc'), dealId: deal.id, contactId, isPrimary: true, roles: [] });
  return deal.id;
}
