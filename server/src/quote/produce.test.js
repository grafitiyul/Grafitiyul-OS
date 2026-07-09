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

function fakeClient({ draft, drafts, dealBox }) {
  let seq = 0;
  const state = {
    docs: drafts ? [...drafts] : [draft],
    offers: [
      { id: 'off_1', dealId: 'deal_1', offerNo: 1, isPrimary: true },
      { id: 'off_2', dealId: 'deal_1', offerNo: 2, isPrimary: false },
    ],
    updates: [], // every quoteDocument.update call, for leak assertions
  };
  const box = dealBox || { value: DEAL };
  return {
    state,
    deal: { findUnique: async () => box.value },
    quoteOffer: {
      findFirst: async () => state.offers[0],
      findUnique: async ({ where }) => state.offers.find((o) => o.id === where.id) || null,
      create: async ({ data }) => data,
    },
    quoteVersion: { findUnique: async ({ where }) => ({ id: where.id }) },
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

// PARALLEL OFFERS: overrides live on each offer's OWN draft — resetting one
// offer's override can never touch another offer's wording.
test('produce: resetting offer A\'s override leaves offer B untouched', async () => {
  const mk = (id, offerId, overrideState) => ({
    id, dealId: 'deal_1', quoteVersionId: `ver_${offerId}`, offerId,
    status: 'draft', language: 'he', displayProductName: null,
    compositionDraft: null, overrideState,
  });
  const draftA = mk('qd_a', 'off_1', { blocks: { faq: { html: '<p>A</p>' } } });
  const draftB = mk('qd_b', 'off_2', { blocks: { faq: { html: '<p>B</p>' } } });
  const client = fakeClient({ drafts: [draftA, draftB] });

  // Reset on offer A (the client PUT removes the override from A's draft only).
  draftA.overrideState = null;

  const a = await produceQuoteDocument(client, 'qd_a');
  const b = await produceQuoteDocument(client, 'qd_b');
  assert.equal(faqHtmlOf(a.doc.renderModelSnapshot), '<p>מקור</p>', 'offer A back to source');
  assert.equal(faqHtmlOf(b.doc.renderModelSnapshot), '<p>B</p>', 'offer B keeps its own override');
  assert.deepEqual(draftB.overrideState, { blocks: { faq: { html: '<p>B</p>' } } }, 'offer B draft untouched');
});

// THE PRODUCTION REPRO (deal ציפי 2): the deal's product/variant was switched
// while an override masked the section. Reset correctly falls back to the
// CURRENT source — which is empty on the new variant — and the old wording
// stays recoverable in the earlier immutable snapshots. Reset never deletes,
// blanks or poisons any source.
test('produce: product switch under an override — reset reveals the empty new source; old snapshots keep the text', async () => {
  const dealBox = {
    value: { ...DEAL, productVariant: { programHe: '<p>סיור גרפיטי כולל התנסות</p>', programEn: null } },
  };
  const draft = {
    id: 'qd_draft', dealId: 'deal_1', quoteVersionId: 'ver_1', offerId: 'off_1',
    status: 'draft', language: 'he', displayProductName: null,
    compositionDraft: null, overrideState: null,
  };
  const client = fakeClient({ draft, dealBox });
  const programOf = (snap) => snap.blocks.find((b) => b.type === 'program')?.data?.html ?? null;

  const v1 = await produceQuoteDocument(client, 'qd_draft');
  assert.equal(programOf(v1.doc.renderModelSnapshot), '<p>סיור גרפיטי כולל התנסות</p>', 'original source renders');

  // Operator overrides the wording, then switches the deal's product/variant
  // (the parallel-offer flow) — the new variant has no program content.
  draft.overrideState = { blocks: { program: { html: '<p>נוסח מותאם</p>' } } };
  dealBox.value = { ...DEAL, productVariant: { programHe: null, programEn: null } };

  const v2 = await produceQuoteDocument(client, 'qd_draft');
  assert.equal(programOf(v2.doc.renderModelSnapshot), '<p>נוסח מותאם</p>', 'override masks the switch');

  // Reset — override removed. The section composes from the CURRENT (empty)
  // source: nothing was deleted by the reset; the wording lives in v1/v2.
  draft.overrideState = null;
  const v3 = await produceQuoteDocument(client, 'qd_draft');
  assert.equal(programOf(v3.doc.renderModelSnapshot), null, 'new source is genuinely empty');
  assert.equal(programOf(v1.doc.renderModelSnapshot), '<p>סיור גרפיטי כולל התנסות</p>', 'v1 snapshot immutable');
  assert.equal(programOf(v2.doc.renderModelSnapshot), '<p>נוסח מותאם</p>', 'v2 snapshot immutable');
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
