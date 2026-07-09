import test from 'node:test';
import assert from 'node:assert/strict';
import { removeOrArchiveOffer } from './quoteOffers.js';

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
