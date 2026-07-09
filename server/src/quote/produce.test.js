import test from 'node:test';
import assert from 'node:assert/strict';
import { produceQuoteDocument } from './produce.js';

// Replays the QA flow that reported a temporary-override leak:
//   V1: draft carries a PERSISTENT override (the checked edit).
//   V2: produced WITH a temporary override on the same section (unchecked).
//   V3: produced with no temp layer.
// Contract: V2's snapshot shows the temp text; the DRAFT is never mutated by
// produce; V3 goes back to the persistent text.

const DEAL = {
  id: 'deal_1',
  currency: 'ILS',
  valueMinor: 540000,
  participants: 25,
  product: { nameHe: 'סיור', nameEn: 'Tour' },
  productVariant: null,
  location: null,
  organization: null,
  organizationType: null,
  organizationSubtype: null,
  paymentTerm: null,
  paymentMethodRef: null,
  contacts: [],
};

function fakeClient({ draft }) {
  let seq = 0;
  const state = {
    docs: [draft],
    offers: [{ id: 'off_1', dealId: 'deal_1', offerNo: 1, isPrimary: true }],
    updates: [], // every quoteDocument.update call, for leak assertions
  };
  return {
    state,
    deal: { findUnique: async () => DEAL },
    quoteOffer: {
      findFirst: async () => state.offers[0],
      findUnique: async ({ where }) => state.offers.find((o) => o.id === where.id) || null,
      create: async ({ data }) => data,
    },
    quoteVersion: { findUnique: async () => ({ id: draft.quoteVersionId }) },
    quoteLine: { findMany: async () => [] },
    quoteSection: {
      findMany: async () => [
        { id: 's1', category: 'faq', active: true, sortOrder: 1, titleHe: 'שאלה', titleEn: 'Q', richTextHe: '<p>מקור</p>', richTextEn: '<p>src</p>' },
      ],
    },
    quoteTemplate: { findUnique: async () => null },
    quoteDocument: {
      findUnique: async ({ where }) => state.docs.find((d) => d.id === where.id) || null,
      aggregate: async () => ({ _max: { versionNo: Math.max(0, ...state.docs.map((d) => d.versionNo || 0)) } }),
      create: async ({ data }) => {
        const d = { id: `qd_new_${++seq}`, createdAt: new Date(), ...data };
        state.docs.push(d);
        return d;
      },
      update: async ({ where, data }) => {
        state.updates.push({ where, data });
        const d = state.docs.find((x) => x.id === where.id);
        Object.assign(d, data);
        return d;
      },
    },
  };
}

const faqHtmlOf = (snapshot) => snapshot.blocks.find((b) => b.type === 'faq')?.data?.customHtml
  ?? snapshot.blocks.find((b) => b.type === 'faq')?.data?.items?.map((i) => i.html).join('');

test('produce: temporary override applies to ONE generation and never mutates the draft', async () => {
  const draft = {
    id: 'qd_draft',
    dealId: 'deal_1',
    quoteVersionId: 'ver_1',
    offerId: 'off_1',
    status: 'draft',
    language: 'he',
    displayProductName: null,
    compositionDraft: null,
    overrideState: { blocks: { faq: { html: '<p>A-PERSIST</p>' } } },
  };
  const client = fakeClient({ draft });

  // V1 — persistent override only.
  const v1 = await produceQuoteDocument(client, 'qd_draft');
  assert.equal(v1.doc.versionNo, 1);
  assert.equal(faqHtmlOf(v1.doc.renderModelSnapshot), '<p>A-PERSIST</p>');

  // V2 — one-shot temp on the same section.
  const v2 = await produceQuoteDocument(client, 'qd_draft', {
    temporaryOverrideState: { blocks: { faq: { html: '<p>B-TEMP</p>' } } },
  });
  assert.equal(v2.doc.versionNo, 2);
  assert.equal(faqHtmlOf(v2.doc.renderModelSnapshot), '<p>B-TEMP</p>', 'V2 shows the temp text');

  // The draft was NEVER written by produce (offerId adoption is the only legal
  // update, and this draft already has one).
  assert.deepEqual(client.state.updates, [], 'produce never updates the draft');
  assert.equal(draft.overrideState.blocks.faq.html, '<p>A-PERSIST</p>', 'draft keeps the persistent text');

  // V3 — no temp layer → back to the persistent state.
  const v3 = await produceQuoteDocument(client, 'qd_draft');
  assert.equal(v3.doc.versionNo, 3);
  assert.equal(faqHtmlOf(v3.doc.renderModelSnapshot), '<p>A-PERSIST</p>', 'V3 reverts to the persistent text');

  // Earlier snapshots are immutable — later generations never rewrite them.
  assert.equal(faqHtmlOf(v1.doc.renderModelSnapshot), '<p>A-PERSIST</p>');
  assert.equal(faqHtmlOf(v2.doc.renderModelSnapshot), '<p>B-TEMP</p>');
});

test('produce: reset (override removed) falls back to SOURCE content — section stays visible', async () => {
  const draft = {
    id: 'qd_draft',
    dealId: 'deal_1',
    quoteVersionId: 'ver_1',
    offerId: 'off_1',
    status: 'draft',
    language: 'he',
    displayProductName: null,
    compositionDraft: null,
    overrideState: { blocks: { faq: { html: '<p>מותאם</p>' } } },
  };
  const client = fakeClient({ draft });

  const v1 = await produceQuoteDocument(client, 'qd_draft');
  assert.equal(faqHtmlOf(v1.doc.renderModelSnapshot), '<p>מותאם</p>');

  // "שחזר טקסט ברירת מחדל" — the client PUT removes the override entirely.
  draft.overrideState = null;

  const v2 = await produceQuoteDocument(client, 'qd_draft');
  const faq = v2.doc.renderModelSnapshot.blocks.find((b) => b.type === 'faq');
  assert.equal(faq.data.customHtml ?? null, null, 'no override residue');
  assert.ok(Array.isArray(faq.data.items) && faq.data.items.length > 0, 'SOURCE items are back');
  assert.equal(faq.data.items[0].html, '<p>מקור</p>', 'source library text restored');
  // The already-generated v1 snapshot is untouched by the reset.
  assert.equal(faqHtmlOf(v1.doc.renderModelSnapshot), '<p>מותאם</p>');
});

test('produce: temp-only override → reset (layer dropped) → source content generated', async () => {
  const draft = {
    id: 'qd_draft',
    dealId: 'deal_1',
    quoteVersionId: 'ver_1',
    offerId: 'off_1',
    status: 'draft',
    language: 'he',
    displayProductName: null,
    compositionDraft: null,
    overrideState: null,
  };
  const client = fakeClient({ draft });

  const withTemp = await produceQuoteDocument(client, 'qd_draft', {
    temporaryOverrideState: { blocks: { faq: { html: '<p>זמני</p>' } } },
  });
  assert.equal(faqHtmlOf(withTemp.doc.renderModelSnapshot), '<p>זמני</p>');

  // Reset = the one-shot layer is simply not sent again.
  const afterReset = await produceQuoteDocument(client, 'qd_draft');
  const faq = afterReset.doc.renderModelSnapshot.blocks.find((b) => b.type === 'faq');
  assert.equal(faq.data.customHtml ?? null, null);
  assert.equal(faq.data.items[0].html, '<p>מקור</p>', 'source text restored');
});
