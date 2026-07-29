import test from 'node:test';
import assert from 'node:assert/strict';
import { channelLabel } from '../ingress/attribution.js';
import {
  MARKETING_FIELDS,
  marketingDto,
  planMarketingWrite,
  resolveChannel,
  writeDealMarketing,
} from './marketing.js';

// ── the shared channel resolver ───────────────────────────────────────────────

test('an imported Hebrew source and an ingress UTM resolve to the SAME channel', () => {
  assert.equal(channelLabel({ legacyLabel: 'פייסבוק' }), 'Meta');
  assert.equal(channelLabel({ utmSource: 'facebook' }), 'Meta');
  assert.equal(channelLabel({ legacyLabel: 'פייסבוק/אינסטגרם ממומן' }), 'Meta');
  assert.equal(channelLabel({ legacyLabel: 'אינסטגרם' }), 'Meta');
  assert.equal(channelLabel({ legacyLabel: 'גוגל' }), 'Google');
  assert.equal(channelLabel({ utmSource: 'google' }), 'Google');
});

test('real UTM tags beat a hand-picked legacy dropdown', () => {
  assert.equal(channelLabel({ utmSource: 'google', legacyLabel: 'פייסבוק' }), 'Google');
});

test('an unmapped legacy label is kept, not flattened to "unknown"', () => {
  assert.equal(channelLabel({ legacyLabel: 'TOMIX' }), 'TOMIX');
  assert.equal(channelLabel({}), 'לא ידוע');
});

test('a closed-list option id appended to the label never reaches the channel', () => {
  // Production really contains these: the free-text source field carries the
  // label with its option id, which fragmented analytics and leaked an id.
  assert.equal(channelLabel({ legacyLabel: 'וואטספ - 113' }), 'WhatsApp');
  assert.equal(channelLabel({ legacyLabel: 'פייסבוק - 106' }), 'Meta');
  assert.equal(channelLabel({ legacyLabel: 'גוגל - 112' }), 'Google');
  // Unmapped labels are still kept — but cleaned.
  assert.equal(channelLabel({ legacyLabel: 'סמוב - 118' }), 'סמוב');
  assert.equal(channelLabel({ legacyLabel: 'TOMIX - 323' }), 'TOMIX');
});

test('stripping is bounded to real option ids and never eats a year', () => {
  assert.equal(channelLabel({ legacyLabel: 'קמפיין 2026' }), 'קמפיין 2026', 'no dash, no strip');
  assert.equal(channelLabel({ legacyLabel: 'ערוץ - 99999' }), 'ערוץ - 99999', '5 digits is not an option id');
  // Measured against production: this value really exists and used to become
  // "27-07". Every real option id is three digits (106–472).
  assert.equal(channelLabel({ legacyLabel: '27-07-1970' }), '27-07-1970');
  assert.equal(channelLabel({ legacyLabel: 'משהו - 2021' }), 'משהו - 2021');
});

test('existing ingress channel behaviour is unchanged', () => {
  assert.equal(channelLabel({ source: 'meta_lead_ads' }), 'Meta');
  assert.equal(channelLabel({ source: 'woocommerce' }), 'אתר');
  assert.equal(channelLabel({ source: 'website_form' }), 'אתר');
  assert.equal(channelLabel({ utmMedium: 'organic' }), 'אורגני');
});

test('resolveChannel routes through the shared resolver', () => {
  assert.equal(resolveChannel({ leadSource: 'וואטספ' }), 'WhatsApp');
  assert.equal(resolveChannel({ utmSource: 'instagram' }), 'Meta');
});

// ── merge semantics ───────────────────────────────────────────────────────────

test('a null incoming value never erases what is already known', () => {
  const { set } = planMarketingWrite(
    { campaign: 'FB-COLD-AD2', leadSource: 'פייסבוק' },
    { campaign: null, leadSource: '', channel: 'Meta' },
  );
  assert.equal(set.campaign, undefined);
  assert.equal(set.leadSource, undefined);
  assert.equal(set.channel, 'Meta');
});

test('first touch is settable once', () => {
  const { set, firstTouchConflict } = planMarketingWrite(
    {},
    { firstTouchAt: new Date('2021-03-23'), firstTouchSource: 'פייסבוק' },
  );
  assert.equal(firstTouchConflict, null);
  assert.equal(set.firstTouchSource, 'פייסבוק');
});

test('first touch is IMMUTABLE afterwards — a different one is a conflict, not an overwrite', () => {
  const existing = { firstTouchAt: new Date('2021-03-23'), firstTouchSource: 'פייסבוק' };
  const { set, firstTouchConflict } = planMarketingWrite(existing, { firstTouchSource: 'גוגל' });
  assert.equal(set.firstTouchSource, undefined, 'must NOT overwrite');
  assert.ok(firstTouchConflict);
  assert.equal(firstTouchConflict.existing.firstTouchSource, 'פייסבוק');
  assert.equal(firstTouchConflict.incoming.firstTouchSource, 'גוגל');
});

test('re-sending an IDENTICAL first touch is not a conflict', () => {
  const existing = { firstTouchAt: new Date('2021-03-23'), firstTouchSource: 'פייסבוק' };
  const { firstTouchConflict } = planMarketingWrite(existing, { firstTouchSource: 'פייסבוק' });
  assert.equal(firstTouchConflict, null);
});

test('latest touch is overwritten freely — that is what "latest" means', () => {
  const { set, firstTouchConflict } = planMarketingWrite(
    { latestTouchSource: 'פייסבוק' },
    { latestTouchSource: 'גוגל' },
  );
  assert.equal(set.latestTouchSource, 'גוגל');
  assert.equal(firstTouchConflict, null);
});

test('originalIngressSource is write-once', () => {
  const { set } = planMarketingWrite(
    { originalIngressSource: 'pipedrive:API' },
    { originalIngressSource: 'meta_lead_ads' },
  );
  assert.equal(set.originalIngressSource, undefined);
});

test('an unchanged value produces no write at all', () => {
  const { set } = planMarketingWrite({ campaign: 'X', channel: 'Meta' }, { campaign: 'X', channel: 'Meta' });
  assert.deepEqual(set, {});
});

test('every canonical field is mergeable (the list and the merger cannot drift)', () => {
  const incoming = Object.fromEntries(MARKETING_FIELDS.map((f) => [f, f === 'sourceCreatedAt' ? new Date() : `v-${f}`]));
  const { set } = planMarketingWrite({}, incoming);
  for (const f of MARKETING_FIELDS) assert.ok(f in set, `${f} was not merged`);
});

// ── the write path ────────────────────────────────────────────────────────────

function fakeDb(existing = null) {
  const calls = { created: null, updated: null };
  return {
    calls,
    dealMarketing: {
      findUnique: async () => existing,
      create: async ({ data }) => { calls.created = data; return data; },
      update: async ({ data }) => { calls.updated = data; return data; },
    },
  };
}

test('writeDealMarketing derives the channel when none is supplied', async () => {
  const db = fakeDb(null);
  const r = await writeDealMarketing(db, 'd1', { leadSource: 'פייסבוק', campaign: 'FB-AD2' });
  assert.equal(r.created, true);
  assert.equal(db.calls.created.channel, 'Meta');
  assert.equal(db.calls.created.dealId, 'd1');
});

test('writeDealMarketing does not update when nothing changed', async () => {
  const db = fakeDb({ leadSource: 'פייסבוק', channel: 'Meta' });
  const r = await writeDealMarketing(db, 'd1', { leadSource: 'פייסבוק' });
  assert.equal(r.changed, 0);
  assert.equal(db.calls.updated, null);
});

test('a first-touch conflict is RETURNED while other fields still write', async () => {
  const db = fakeDb({ firstTouchSource: 'פייסבוק', firstTouchAt: new Date('2021-01-01') });
  const r = await writeDealMarketing(db, 'd1', { firstTouchSource: 'גוגל', campaign: 'NEW-CAMPAIGN' });
  assert.ok(r.firstTouchConflict, 'conflict surfaced');
  assert.equal(db.calls.updated.campaign, 'NEW-CAMPAIGN', 'the campaign update is not lost');
  assert.equal(db.calls.updated.firstTouchSource, undefined);
});

// ── the panel DTO ─────────────────────────────────────────────────────────────

test('the DTO reports an honest empty state', () => {
  assert.deepEqual(marketingDto(null), { hasAny: false, syncedFromLegacy: false, groups: [] });
  assert.deepEqual(marketingDto({}), { hasAny: false, syncedFromLegacy: false, groups: [] });
});

test('the legacy badge is decided on the SERVER from provenance, not guessed by the client', () => {
  assert.equal(marketingDto({ leadSource: 'פייסבוק', originalIngressSource: 'pipedrive:API' }).syncedFromLegacy, true);
  assert.equal(marketingDto({ leadSource: 'פייסבוק', originalIngressSource: 'meta_lead_ads' }).syncedFromLegacy, false);
  assert.equal(marketingDto({ leadSource: 'פייסבוק' }).syncedFromLegacy, false);
});

test('the DTO omits empty groups instead of rendering rows of dashes', () => {
  const dto = marketingDto({ leadSource: 'פייסבוק', channel: 'Meta' });
  assert.equal(dto.hasAny, true);
  assert.deepEqual(dto.groups.map((g) => g.key), ['source']);
});

test('the DTO exposes business language only — no ids, no enum keys, no JSON', () => {
  const dto = marketingDto({
    leadSource: 'פייסבוק', leadSourceKey: '106', channel: 'Meta',
    attributionRaw: { pipedrive: { origin: 'API' } },
    originalIngressSource: 'pipedrive:API', sourceCreatedAt: new Date('2021-03-23T20:47:19Z'),
  });
  const flat = JSON.stringify(dto);
  assert.ok(!flat.includes('106'), 'option id must not leak');
  assert.ok(!flat.includes('leadSourceKey'));
  assert.ok(!flat.includes('attributionRaw'));
  assert.ok(flat.includes('2021-03-23'));
});

test('free text is shown as detail only when it adds something beyond the label', () => {
  const same = marketingDto({ leadSource: 'פייסבוק', leadSourceText: 'פייסבוק' });
  assert.equal(same.groups[0].rows.filter((r) => r.label === 'פירוט').length, 0);
  const diff = marketingDto({ leadSource: 'פייסבוק', leadSourceText: 'קמפיין קיץ בפייסבוק' });
  assert.equal(diff.groups[0].rows.filter((r) => r.label === 'פירוט').length, 1);
});
