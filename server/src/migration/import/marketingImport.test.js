import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PD_FIELD_KEYS,
  buildLeadSourceOptions,
  mapPipedriveMarketing,
  planMarketingImport,
} from './marketingImport.js';

// The real closed-list shape, as it appears in the snapshot reference.
const DEAL_FIELDS = [
  {
    key: PD_FIELD_KEYS.leadSourceList,
    name: 'מקור-רשימה סגורה',
    field_type: 'enum',
    options: [
      { id: 106, label: 'פייסבוק' },
      { id: 111, label: 'המלצה' },
      { id: 112, label: 'גוגל' },
      { id: 171, label: 'פייסבוק/אינסטגרם ממומן' },
      { id: 472, label: 'chatgpt.com' },
    ],
  },
  { key: PD_FIELD_KEYS.leadSourceText, name: 'מקור', field_type: 'varchar' },
];

const OPTS = buildLeadSourceOptions(DEAL_FIELDS);

const pdDeal = (o = {}) => ({
  id: o.id ?? 501,
  [PD_FIELD_KEYS.leadSourceList]: o.list ?? null,
  [PD_FIELD_KEYS.leadSourceText]: o.text ?? null,
  [PD_FIELD_KEYS.campaign]: o.campaign ?? null,
  [PD_FIELD_KEYS.origin]: o.origin ?? null,
  [PD_FIELD_KEYS.originId]: o.originId ?? null,
  [PD_FIELD_KEYS.addTime]: o.addTime ?? null,
});

test('option labels are resolved from the snapshot, never hardcoded', () => {
  assert.equal(OPTS.get('106'), 'פייסבוק');
  assert.equal(OPTS.get('472'), 'chatgpt.com');
  assert.equal(OPTS.size, 5);
});

test('maps the six fields Pipedrive actually carries', () => {
  const m = mapPipedriveMarketing(
    pdDeal({ list: 106, text: 'דף נחיתה', campaign: 'FB-COLD-Grafiti-AD2-short', origin: 'API', addTime: '2021-03-23 20:47:19' }),
    OPTS,
  );
  assert.equal(m.leadSource, 'פייסבוק');
  assert.equal(m.leadSourceKey, '106');
  assert.equal(m.leadSourceText, 'דף נחיתה');
  assert.equal(m.campaign, 'FB-COLD-Grafiti-AD2-short');
  assert.equal(m.originalIngressSource, 'pipedrive:API');
  assert.equal(m.sourceCreatedAt.toISOString(), '2021-03-23T20:47:19.000Z');
});

test('Pipedrive supplies no UTM data — those columns stay empty by design', () => {
  const m = mapPipedriveMarketing(pdDeal({ list: 106, origin: 'API' }), OPTS);
  for (const f of ['utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm', 'landingUrl', 'referrer', 'adId']) {
    assert.equal(m[f], undefined, `${f} must not be invented`);
  }
});

test('channel is left for the shared resolver, never computed here', () => {
  assert.equal(mapPipedriveMarketing(pdDeal({ list: 106 }), OPTS).channel, null);
});

test("an unresolved option id is NEVER shown as if it were a label", () => {
  const m = mapPipedriveMarketing(pdDeal({ list: 999 }), OPTS);
  assert.equal(m.leadSource, null, 'no fake label');
  assert.equal(m.leadSourceKey, '999', 'the raw key is still kept');
  assert.equal(m.attributionRaw.pipedrive.unresolvedLeadSourceOption, '999');
});

test('first touch is what the source can honestly attest: creation time + stated source', () => {
  const m = mapPipedriveMarketing(pdDeal({ list: 111, campaign: 'C1', addTime: '2022-06-01 09:00:00' }), OPTS);
  assert.equal(m.firstTouchSource, 'המלצה');
  assert.equal(m.firstTouchCampaign, 'C1');
  assert.equal(m.firstTouchAt.toISOString(), '2022-06-01T09:00:00.000Z');
});

test("Pipedrive's 'YYYY-MM-DD HH:mm:ss' is parsed as UTC, not as local time", () => {
  const m = mapPipedriveMarketing(pdDeal({ addTime: '2021-03-23 20:47:19' }), OPTS);
  assert.equal(m.sourceCreatedAt.toISOString(), '2021-03-23T20:47:19.000Z');
});

test('a nonsense date becomes null rather than an Invalid Date', () => {
  assert.equal(mapPipedriveMarketing(pdDeal({ addTime: 'not a date' }), OPTS).sourceCreatedAt, null);
});

test('object-wrapped custom field values are unwrapped', () => {
  const m = mapPipedriveMarketing(pdDeal({ list: { value: 112 }, text: { value: 'גוגל אורגני' } }), OPTS);
  assert.equal(m.leadSource, 'גוגל');
  assert.equal(m.leadSourceText, 'גוגל אורגני');
});

test('origin defaults to plain pipedrive when absent', () => {
  assert.equal(mapPipedriveMarketing(pdDeal({}), OPTS).originalIngressSource, 'pipedrive');
});

// ── planning ──────────────────────────────────────────────────────────────────

test('plan skips deals with no crosswalk and deals with nothing to say', () => {
  const xwalk = new Map([['501', 'gos-1'], ['502', 'gos-2']]);
  const { rows, stats } = planMarketingImport({
    deals: [
      pdDeal({ id: 501, list: 106, addTime: '2021-03-23 20:47:19' }),
      pdDeal({ id: 502 }),                       // nothing to write
      pdDeal({ id: 999, list: 106 }),            // no crosswalk
    ],
    dealIdByPipedriveId: xwalk,
    optionLabels: OPTS,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dealId, 'gos-1');
  assert.equal(stats.dealsSeen, 3);
  assert.equal(stats.skippedNoCrosswalk, 1);
  assert.equal(stats.skippedNothingToWrite, 1);
  assert.equal(stats.withLeadSource, 1);
});

test('plan counts unresolved options so a rotted closed list is visible', () => {
  const { stats } = planMarketingImport({
    deals: [pdDeal({ id: 501, list: 9999 })],
    dealIdByPipedriveId: new Map([['501', 'gos-1']]),
    optionLabels: OPTS,
  });
  assert.equal(stats.unresolvedOptions, 1);
});

test('planning is read-only and deterministic', () => {
  const args = {
    deals: [pdDeal({ id: 501, list: 106, campaign: 'C' })],
    dealIdByPipedriveId: new Map([['501', 'gos-1']]),
    optionLabels: OPTS,
  };
  const a = planMarketingImport(args);
  const b = planMarketingImport(args);
  assert.deepEqual(JSON.stringify(a.rows), JSON.stringify(b.rows));
  assert.deepEqual(a.stats, b.stats);
});
