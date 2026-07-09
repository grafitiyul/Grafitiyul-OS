import test from 'node:test';
import assert from 'node:assert/strict';
import { removeOrArchiveOffer, setPrimaryOffer, splitBuilderPatch, updateOfferContext } from './quoteOffers.js';

// Safety rules for removing a parallel offer:
//   signed document anywhere → refuse; produced documents → ARCHIVE (history
//   intact); never generated → hard delete (offer + drafts + pricing rows).
//   Primary/active roles fall back to the first remaining live offer.

function fakeClient({ offers, versions = [], docs = [] }) {
  let seq = 0;
  const state = { offers: [...offers], versions: [...versions], docs: [...docs] };
  const client = {
    state,
    deal: { findUnique: async ({ where }) => ({ id: where.id, communicationLanguage: null, contacts: [] }) },
    quoteOffer: {
      findUnique: async ({ where, include }) => {
        const o = state.offers.find((x) => x.id === where.id);
        if (!o) return null;
        if (!include) return o;
        return {
          ...o,
          quoteDocuments: state.docs
            .filter((d) => d.offerId === o.id && d.status !== 'draft')
            .map((d) => ({ id: d.id, signature: d.signed ? { id: `sig_${d.id}` } : null })),
          quoteVersions: state.versions.filter((v) => v.offerId === o.id).map((v) => ({ id: v.id, isWorking: v.isWorking })),
        };
      },
      findFirst: async ({ where }) =>
        state.offers
          .filter((o) => o.dealId === where.dealId && (where.archivedAt === undefined || (o.archivedAt ?? null) === where.archivedAt))
          .sort((a, b) => a.offerNo - b.offerNo)[0] || null,
      aggregate: async ({ where }) => ({
        _max: { offerNo: Math.max(0, ...state.offers.filter((o) => o.dealId === where.dealId).map((o) => o.offerNo)) },
      }),
      update: async ({ where, data }) => {
        const o = state.offers.find((x) => x.id === where.id);
        Object.assign(o, data);
        return o;
      },
      updateMany: async ({ where, data }) => {
        state.offers.filter((o) => o.dealId === where.dealId && (!where.isPrimary || o.isPrimary)).forEach((o) => Object.assign(o, data));
      },
      delete: async ({ where }) => {
        state.offers = state.offers.filter((o) => o.id !== where.id);
      },
      create: async ({ data }) => {
        const o = { id: `off_new_${++seq}`, ...data };
        state.offers.push(o);
        return o;
      },
    },
    quoteVersion: {
      findFirst: async ({ where }) =>
        state.versions.find((v) =>
          v.dealId === where.dealId
          && (where.offerId === undefined || v.offerId === where.offerId)
          && (where.isWorking === undefined || v.isWorking === where.isWorking)) || null,
      create: async ({ data }) => {
        const v = { id: `ver_new_${++seq}`, ...data };
        state.versions.push(v);
        return v;
      },
      update: async ({ where, data }) => {
        const v = state.versions.find((x) => x.id === where.id);
        Object.assign(v, data);
        return v;
      },
      updateMany: async ({ where, data }) => {
        state.versions.filter((v) => v.dealId === where.dealId && (!where.isWorking || v.isWorking)).forEach((v) => Object.assign(v, data));
      },
      deleteMany: async ({ where }) => {
        state.versions = state.versions.filter((v) => v.offerId !== where.offerId);
      },
    },
    quoteDocument: {
      findFirst: async ({ where }) =>
        state.docs.find((d) => d.dealId === where.dealId && d.quoteVersionId === where.quoteVersionId && d.status === where.status) || null,
      create: async ({ data }) => {
        const d = { id: `qd_new_${++seq}`, ...data };
        state.docs.push(d);
        return d;
      },
      update: async ({ where, data }) => {
        const d = state.docs.find((x) => x.id === where.id);
        Object.assign(d, data);
        return d;
      },
      deleteMany: async ({ where }) => {
        state.docs = state.docs.filter((d) => !(d.offerId === where.offerId && d.status === where.status));
      },
    },
  };
  return client;
}

const offer = (id, offerNo, over = {}) => ({ id, dealId: 'deal_1', offerNo, isPrimary: offerNo === 1, archivedAt: null, ...over });

// ── Deal ≡ primary: promotion + builder routing ─────────────────────────────

function promoteFake({ deal, offers }) {
  const state = { deal: { ...deal }, offers: offers.map((o) => ({ ...o })), dealUpdates: [] };
  return {
    state,
    deal: {
      findUnique: async () => state.deal,
      update: async ({ data }) => {
        state.dealUpdates.push(data);
        Object.assign(state.deal, data);
        return state.deal;
      },
    },
    quoteOffer: {
      findUnique: async ({ where }) => state.offers.find((o) => o.id === where.id) || null,
      findFirst: async ({ where }) =>
        state.offers.find((o) =>
          o.dealId === where.dealId
          && (where.isPrimary === undefined || o.isPrimary === where.isPrimary)
          && (where.archivedAt === undefined || (o.archivedAt ?? null) === where.archivedAt)) || null,
      update: async ({ where, data }) => {
        const o = state.offers.find((x) => x.id === where.id);
        Object.assign(o, data);
        return o;
      },
      updateMany: async ({ where, data }) => {
        state.offers
          .filter((o) => o.dealId === where.dealId && (!where.isPrimary || o.isPrimary))
          .forEach((o) => Object.assign(o, data));
      },
    },
  };
}

test('makePrimary: Deal adopts the offer context; outgoing primary keeps what it had', async () => {
  const client = promoteFake({
    deal: {
      id: 'deal_1', productId: 'p1', productVariantId: 'v1', locationId: 'l1',
      participants: 30, tourDate: '2026-08-04', tourTime: '10:00', valueMinor: 350000n,
    },
    offers: [
      offer('off_1', 1, { contextMode: 'deal' }),
      offer('off_2', 2, {
        isPrimary: false, contextMode: 'own',
        productId: 'p2', productVariantId: 'v2', locationId: 'l2',
        participants: 25, tourDate: '2026-08-10', tourTime: '12:00', valueMinor: 237500n,
      }),
    ],
  });

  const r = await setPrimaryOffer(client, 'deal_1', 'off_2');
  assert.equal(r.changed, true);

  const [a, b] = client.state.offers;
  // Outgoing primary froze the Deal's PRE-adoption context as its own.
  assert.equal(a.isPrimary, false);
  assert.equal(a.contextMode, 'own');
  assert.equal(a.productId, 'p1');
  assert.equal(a.valueMinor, 350000n);
  // The Deal now mirrors the new primary.
  assert.equal(client.state.deal.productId, 'p2');
  assert.equal(client.state.deal.productVariantId, 'v2');
  assert.equal(client.state.deal.participants, 25);
  assert.equal(client.state.deal.valueMinor, 237500n);
  // The new primary follows the Deal (context cleared).
  assert.equal(b.isPrimary, true);
  assert.equal(b.contextMode, 'deal');
  assert.equal(b.productId, null);
});

test('makePrimary: promoting the current primary is a no-op', async () => {
  const client = promoteFake({
    deal: { id: 'deal_1', productId: 'p1', productVariantId: null, locationId: null, participants: null, tourDate: null, tourTime: null, valueMinor: 0n },
    offers: [offer('off_1', 1, { contextMode: 'deal' })],
  });
  const r = await setPrimaryOffer(client, 'deal_1', 'off_1');
  assert.equal(r.changed, false);
  assert.deepEqual(client.state.dealUpdates, [], 'deal untouched');
});

test('updateOfferContext: writes the OWN offer only — the Deal is never touched', async () => {
  const client = promoteFake({
    deal: { id: 'deal_1', productId: 'p1', productVariantId: 'v1', locationId: 'l1', participants: 30, tourDate: null, tourTime: null, valueMinor: 0n },
    offers: [
      offer('off_1', 1, { contextMode: 'deal' }),
      offer('off_2', 2, { isPrimary: false, contextMode: 'own', productId: 'p1' }),
    ],
  });
  const r = await updateOfferContext(client, 'deal_1', 'off_2', {
    productId: 'p2', productVariantId: 'v2', locationId: 'l2',
    participants: 25, tourDate: '2026-08-10', tourTime: '12:00',
  });
  assert.ok(!r.error);
  const o = client.state.offers[1];
  assert.equal(o.productId, 'p2');
  assert.equal(o.participants, 25);
  assert.equal(o.tourDate, '2026-08-10');
  assert.deepEqual(client.state.dealUpdates, [], 'Deal untouched');
});

test('updateOfferContext: primary/archived/invalid are rejected', async () => {
  const client = promoteFake({
    deal: { id: 'deal_1', productId: 'p1', productVariantId: null, locationId: null, participants: null, tourDate: null, tourTime: null, valueMinor: 0n },
    offers: [
      offer('off_1', 1, { contextMode: 'deal' }),
      offer('off_2', 2, { isPrimary: false, contextMode: 'own' }),
      offer('off_3', 3, { isPrimary: false, contextMode: 'own', archivedAt: new Date() }),
    ],
  });
  assert.equal((await updateOfferContext(client, 'deal_1', 'off_1', { productId: 'p2' })).error, 'primary_follows_deal');
  assert.equal((await updateOfferContext(client, 'deal_1', 'off_3', { productId: 'p2' })).error, 'archived');
  assert.equal((await updateOfferContext(client, 'deal_1', 'off_2', { participants: -3 })).error, 'invalid_participants');
  assert.equal((await updateOfferContext(client, 'deal_1', 'nope', {})).error, 'not_found');
});

test('splitBuilderPatch: primary (deal-mode) patches the Deal; own-mode offer keeps it to itself', () => {
  const b = { valueMinor: 1000, productId: 'p9', productVariantId: 'v9', locationId: 'l9', participants: '40' };
  const primary = splitBuilderPatch({ isPrimary: true, contextMode: 'deal' }, b);
  assert.deepEqual(primary.offerPatch, {});
  assert.equal(primary.dealPatch.valueMinor, 1000n);
  assert.equal(primary.dealPatch.productId, 'p9');
  assert.equal(primary.dealPatch.participants, 40);

  const own = splitBuilderPatch({ isPrimary: false, contextMode: 'own' }, b);
  assert.deepEqual(own.dealPatch, {}, 'pricing an alternative never mutates the Deal');
  assert.equal(own.offerPatch.productId, 'p9');
  assert.equal(own.offerPatch.valueMinor, 1000n);

  // Legacy safety: no offer row at all → historic behavior (patch the Deal).
  assert.equal(splitBuilderPatch(null, b).dealPatch.productId, 'p9');
});

test('remove: refuses when the offer has a signed document', async () => {
  const client = fakeClient({
    offers: [offer('off_1', 1), offer('off_2', 2, { isPrimary: false })],
    docs: [{ id: 'qd_1', dealId: 'deal_1', offerId: 'off_2', quoteVersionId: 'v2', status: 'accepted', signed: true }],
  });
  const r = await removeOrArchiveOffer(client, 'deal_1', 'off_2');
  assert.equal(r.error, 'has_signed');
  assert.equal(client.state.offers.length, 2, 'nothing removed');
});

test('remove: offer with produced documents is ARCHIVED, documents survive', async () => {
  const client = fakeClient({
    offers: [offer('off_1', 1), offer('off_2', 2, { isPrimary: false })],
    docs: [{ id: 'qd_1', dealId: 'deal_1', offerId: 'off_2', quoteVersionId: 'v2', status: 'produced', signed: false }],
  });
  const r = await removeOrArchiveOffer(client, 'deal_1', 'off_2');
  assert.equal(r.mode, 'archived');
  const archived = client.state.offers.find((o) => o.id === 'off_2');
  assert.ok(archived.archivedAt, 'offer archived, not deleted');
  assert.equal(client.state.docs.length, 1, 'produced document untouched');
});

test('remove: never-generated offer is hard-deleted with its draft + pricing', async () => {
  const client = fakeClient({
    offers: [offer('off_1', 1), offer('off_2', 2, { isPrimary: false })],
    versions: [
      { id: 'v1', dealId: 'deal_1', offerId: 'off_1', isWorking: false },
      { id: 'v2', dealId: 'deal_1', offerId: 'off_2', isWorking: true },
    ],
    docs: [{ id: 'qd_d2', dealId: 'deal_1', offerId: 'off_2', quoteVersionId: 'v2', status: 'draft', signed: false }],
  });
  const r = await removeOrArchiveOffer(client, 'deal_1', 'off_2');
  assert.equal(r.mode, 'deleted');
  assert.ok(!client.state.offers.some((o) => o.id === 'off_2'), 'offer gone');
  assert.ok(!client.state.versions.some((v) => v.offerId === 'off_2'), 'pricing version gone');
  assert.ok(!client.state.docs.some((d) => d.offerId === 'off_2'), 'draft gone');
  // The removed offer was ACTIVE (working version) → offer 1 takes over.
  const working = client.state.versions.find((v) => v.isWorking);
  assert.equal(working?.offerId, 'off_1', 'builder context fell back to offer 1');
});

test('remove: archiving the primary offer hands primary to the remaining one', async () => {
  const client = fakeClient({
    offers: [offer('off_1', 1), offer('off_2', 2, { isPrimary: false })],
    docs: [{ id: 'qd_1', dealId: 'deal_1', offerId: 'off_1', quoteVersionId: 'v1', status: 'produced', signed: false }],
  });
  const r = await removeOrArchiveOffer(client, 'deal_1', 'off_1');
  assert.equal(r.mode, 'archived');
  const remaining = client.state.offers.find((o) => o.id === 'off_2');
  assert.equal(remaining.isPrimary, true, 'primary reassigned');
});
