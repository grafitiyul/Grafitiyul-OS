// Quote Module — Slice 1 unit tests. Pure: no DB. DB-touching functions are
// exercised against a tiny in-memory fake `client` (same injection style the
// engine + ensureWorkingVersion use). Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  newPublicToken,
  resolveQuoteLanguage,
  buildInitialDraftData,
  ensureDraftQuoteDocument,
  updateQuoteDocumentMeta,
  resetQuoteDocumentToSource,
} from './quoteDocument.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Fake Prisma client ───────────────────────────────────────────────────────
// Implements only the methods the service uses, over in-memory arrays.
function fakeClient({ deals = {}, versions = [], docs = [], offers = [] } = {}) {
  let vSeq = 0;
  let dSeq = 0;
  let oSeq = 0;
  const state = { versions: [...versions], docs: [...docs], offers: [...offers] };
  return {
    state,
    deal: {
      findUnique: async ({ where }) => deals[where.id] || null,
    },
    quoteOffer: {
      findFirst: async ({ where }) =>
        state.offers
          .filter((o) => o.dealId === where.dealId && (where.archivedAt === undefined || (o.archivedAt ?? null) === where.archivedAt))
          .sort((a, b) => a.offerNo - b.offerNo)[0] || null,
      findUnique: async ({ where }) => state.offers.find((o) => o.id === where.id) || null,
      aggregate: async ({ where }) => ({
        _max: { offerNo: Math.max(0, ...state.offers.filter((o) => o.dealId === where.dealId).map((o) => o.offerNo)) },
      }),
      create: async ({ data }) => {
        const o = { id: `off_${++oSeq}`, ...data };
        state.offers.push(o);
        return o;
      },
    },
    quoteVersion: {
      findFirst: async ({ where }) =>
        state.versions.find(
          (v) => v.dealId === where.dealId && (where.isWorking === undefined || v.isWorking === where.isWorking),
        ) || null,
      create: async ({ data }) => {
        const v = { id: `ver_${++vSeq}`, ...data };
        state.versions.push(v);
        return v;
      },
      update: async ({ where, data }) => {
        const v = state.versions.find((x) => x.id === where.id);
        Object.assign(v, data);
        return v;
      },
    },
    quoteDocument: {
      findFirst: async ({ where }) =>
        state.docs.find(
          (d) => d.dealId === where.dealId && d.quoteVersionId === where.quoteVersionId && d.status === where.status,
        ) || null,
      findUnique: async ({ where }) => state.docs.find((d) => d.id === where.id) || null,
      create: async ({ data }) => {
        const d = { id: `qd_${++dSeq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        state.docs.push(d);
        return d;
      },
      update: async ({ where, data }) => {
        const d = state.docs.find((x) => x.id === where.id);
        Object.assign(d, data, { updatedAt: new Date() });
        return d;
      },
    },
  };
}

const deal = (over = {}) => ({ id: 'deal_1', communicationLanguage: null, quoteEmailIntro: null, contacts: [], ...over });
const dc = (lang, { roles = [], isPrimary = false } = {}) => ({ roles, isPrimary, contact: { communicationLanguage: lang } });

// ── publicToken ──────────────────────────────────────────────────────────────
test('publicToken: present, URL-safe, and unique across many generations', () => {
  const tokens = Array.from({ length: 500 }, () => newPublicToken());
  for (const t of tokens) {
    assert.ok(typeof t === 'string' && t.length >= 32, 'token long enough');
    assert.match(t, /^[A-Za-z0-9_-]+$/, 'token is URL-safe (base64url)');
  }
  assert.equal(new Set(tokens).size, tokens.length, 'all tokens unique');
});

// ── language resolution ──────────────────────────────────────────────────────
test('language: defaults from the payer contact communicationLanguage', () => {
  const d = deal({ communicationLanguage: 'he', contacts: [dc('en', { roles: ['payer'] })] });
  assert.equal(resolveQuoteLanguage(d), 'en');
});

test('language: role priority — payer beats coordinator', () => {
  const d = deal({ contacts: [dc('he', { roles: ['coordinator'] }), dc('en', { roles: ['payer'] })] });
  assert.equal(resolveQuoteLanguage(d), 'en');
});

test('language: isPrimary used when no priority role carries a language', () => {
  const d = deal({ contacts: [dc(null, { roles: ['participant'] }), dc('en', { isPrimary: true })] });
  assert.equal(resolveQuoteLanguage(d), 'en');
});

test('language: falls back to the deal working language when no contact language', () => {
  const d = deal({ communicationLanguage: 'en', contacts: [dc(null, { roles: ['payer'] })] });
  assert.equal(resolveQuoteLanguage(d), 'en');
});

test('language: falls back to Hebrew when nothing is set', () => {
  assert.equal(resolveQuoteLanguage(deal()), 'he');
  assert.equal(resolveQuoteLanguage(deal({ communicationLanguage: 'xx' })), 'he'); // invalid ignored
});

test('buildInitialDraftData: sane defaults, valid token', () => {
  const data = buildInitialDraftData({ dealId: 'd', quoteVersionId: 'v', language: 'en' });
  assert.equal(data.status, 'draft');
  assert.equal(data.language, 'en');
  assert.equal(data.displayProductName, null);
  assert.equal(data.renderModelSnapshot, null);
  assert.match(data.publicToken, /^[A-Za-z0-9_-]+$/);
});

// ── ensureDraftQuoteDocument ─────────────────────────────────────────────────
test('ensureDraft: creates exactly one draft + a working version for a fresh deal', async () => {
  const client = fakeClient({ deals: { deal_1: deal({ contacts: [dc('en', { roles: ['payer'] })] }) } });
  const r = await ensureDraftQuoteDocument(client, 'deal_1');
  assert.equal(r.created, true);
  assert.equal(r.doc.status, 'draft');
  assert.equal(r.doc.language, 'en');
  assert.ok(r.doc.publicToken);
  assert.equal(client.state.docs.length, 1, 'one document');
  assert.equal(client.state.versions.length, 1, 'one working version created');
  assert.equal(client.state.offers.length, 1, 'primary offer #1 created');
  assert.equal(client.state.offers[0].offerNo, 1);
  assert.equal(client.state.offers[0].isPrimary, true);
  assert.equal(r.doc.offerId, client.state.offers[0].id, 'draft attached to the offer');
  assert.equal(client.state.versions[0].offerId, client.state.offers[0].id, 'working version attached to the offer');
});

test('ensureDraft: reuses the existing draft instead of creating a duplicate', async () => {
  const client = fakeClient({ deals: { deal_1: deal() } });
  const first = await ensureDraftQuoteDocument(client, 'deal_1');
  const second = await ensureDraftQuoteDocument(client, 'deal_1');
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.doc.id, first.doc.id, 'same document returned');
  assert.equal(client.state.docs.length, 1, 'no duplicate created');
  assert.equal(client.state.versions.length, 1, 'no duplicate working version');
  assert.equal(client.state.offers.length, 1, 'no duplicate offer');
});

test('ensureDraft: returns not_found for a missing deal', async () => {
  const client = fakeClient();
  const r = await ensureDraftQuoteDocument(client, 'nope');
  assert.equal(r.error, 'not_found');
  assert.equal(client.state.docs.length, 0);
});

// ── updateQuoteDocumentMeta ──────────────────────────────────────────────────
test('updateMeta: edits draft displayProductName', async () => {
  const client = fakeClient({ deals: { deal_1: deal() } });
  const { doc } = await ensureDraftQuoteDocument(client, 'deal_1');
  const r = await updateQuoteDocumentMeta(client, doc.id, {
    displayProductName: 'השתלמות מקצועית באומנות אורבנית',
  });
  assert.equal(r.doc.displayProductName, 'השתלמות מקצועית באומנות אורבנית');
});

test('updateMeta: rejects a non-draft (produced) document — frozen', async () => {
  const client = fakeClient({ deals: { deal_1: deal() } });
  const { doc } = await ensureDraftQuoteDocument(client, 'deal_1');
  doc.status = 'produced';
  const r = await updateQuoteDocumentMeta(client, doc.id, { displayProductName: 'x' });
  assert.equal(r.error, 'not_editable');
});

test('updateMeta: rejects an invalid language', async () => {
  const client = fakeClient({ deals: { deal_1: deal() } });
  const { doc } = await ensureDraftQuoteDocument(client, 'deal_1');
  const r = await updateQuoteDocumentMeta(client, doc.id, { language: 'fr' });
  assert.equal(r.error, 'invalid_language');
});

test('updateMeta: not_found for a missing document', async () => {
  const client = fakeClient();
  const r = await updateQuoteDocumentMeta(client, 'nope', { displayProductName: 'x' });
  assert.equal(r.error, 'not_found');
});

// ── draft structure + override persistence (Slice 3) ─────────────────────────
test('updateMeta: persists compositionDraft and overrideState', async () => {
  const client = fakeClient({ deals: { deal_1: deal() } });
  const { doc } = await ensureDraftQuoteDocument(client, 'deal_1');
  const composition = { blocks: [{ key: 'pricing' }, { key: 'hero', hidden: true }] };
  const overrides = { blocks: { faq: { html: '<p>custom</p>' } } };
  const r = await updateQuoteDocumentMeta(client, doc.id, { compositionDraft: composition, overrideState: overrides });
  assert.deepEqual(r.doc.compositionDraft, composition);
  assert.deepEqual(r.doc.overrideState, overrides);
});

test('updateMeta: rejects a non-object compositionDraft', async () => {
  const client = fakeClient({ deals: { deal_1: deal() } });
  const { doc } = await ensureDraftQuoteDocument(client, 'deal_1');
  const r = await updateQuoteDocumentMeta(client, doc.id, { compositionDraft: 'nope' });
  assert.equal(r.error, 'invalid_composition_draft');
});

test('updateMeta: an overrideState with no block entries normalizes to null', async () => {
  const client = fakeClient({ deals: { deal_1: deal() } });
  const { doc } = await ensureDraftQuoteDocument(client, 'deal_1');
  await updateQuoteDocumentMeta(client, doc.id, { overrideState: { blocks: { faq: { html: '<p>x</p>' } } } });
  // Removing the LAST override must leave a clean null — never a hollow object
  // that could read as "overridden with nothing" (the reset-default QA bug).
  const r = await updateQuoteDocumentMeta(client, doc.id, { overrideState: { blocks: {} } });
  assert.equal(r.doc.overrideState, null);
  const r2 = await updateQuoteDocumentMeta(client, doc.id, { overrideState: null });
  assert.equal(r2.doc.overrideState, null);
});

test('resetToSource: clears overrides + structural edits', async () => {
  const client = fakeClient({ deals: { deal_1: deal() } });
  const { doc } = await ensureDraftQuoteDocument(client, 'deal_1');
  await updateQuoteDocumentMeta(client, doc.id, {
    displayProductName: 'X',
    compositionDraft: { blocks: [{ key: 'hero' }] },
    overrideState: { blocks: { faq: { html: '<p>c</p>' } } },
  });
  const r = await resetQuoteDocumentToSource(client, doc.id);
  assert.equal(r.doc.displayProductName, null);
  assert.equal(r.doc.compositionDraft, null);
  assert.equal(r.doc.overrideState, null);
});

test('resetToSource: rejected on a produced document', async () => {
  const client = fakeClient({ deals: { deal_1: deal() } });
  const { doc } = await ensureDraftQuoteDocument(client, 'deal_1');
  doc.status = 'produced';
  const r = await resetQuoteDocumentToSource(client, doc.id);
  assert.equal(r.error, 'not_editable');
});

// ── additive-migration guard (constraint #10: no destructive drops) ──────────
test('Slice 1 migrations are additive — no destructive drops', () => {
  const migDir = path.resolve(__dirname, '../../prisma/migrations');
  const slice1 = [
    '20260630300000_location_marketing_desc',
    '20260630320000_quotesection_category',
    '20260630340000_quote_documents',
  ];
  const forbidden = /\b(DROP\s+TABLE|DROP\s+COLUMN|DROP\s+CONSTRAINT|ALTER\s+TABLE\s+"[^"]+"\s+DROP|TRUNCATE)\b/i;
  for (const name of slice1) {
    const sql = fs.readFileSync(path.join(migDir, name, 'migration.sql'), 'utf-8');
    assert.doesNotMatch(sql, forbidden, `${name} must contain no destructive statements`);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS|ADD COLUMN IF NOT EXISTS/i, `${name} must be additive`);
  }
});
