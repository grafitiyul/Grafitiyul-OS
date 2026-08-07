import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVariables } from './variables.js';
import { buildSyntheticContext } from './synthetic.js';
import { prepareMessageRun } from './prepare.js';

const KEYS = ['deal_link', 'deal_owner', 'activity_type', 'sub_organization'];

const fullCtx = {
  deal: {
    orderNo: 27123,
    activityType: 'private',
    organizationId: null,
    organizationUnit: { id: 'u1', name: 'סניף רמת גן' },
  },
  owner: { username: 'dorko', displayName: 'דור קורן' },
  links: { origin: 'https://gos.example', paymentUrl: null },
};

test('deal_link builds the canonical internal route from orderNo + origin', () => {
  const { values } = resolveVariables(['deal_link'], fullCtx, 'he');
  assert.equal(values.deal_link, 'https://gos.example/admin/crm/deals/27123');
});

test('deal_link is honestly missing without an origin or orderNo', () => {
  const { missing } = resolveVariables(['deal_link'], { deal: { orderNo: 1 }, links: { origin: null } }, 'he');
  assert.deepEqual(missing, ['deal_link']);
});

test('deal_owner resolves via the canonical display-name rule (displayName → username)', () => {
  assert.equal(resolveVariables(['deal_owner'], fullCtx, 'he').values.deal_owner, 'דור קורן');
  const usernameOnly = { ...fullCtx, owner: { username: 'dorko', displayName: null } };
  assert.equal(resolveVariables(['deal_owner'], usernameOnly, 'he').values.deal_owner, 'dorko');
});

test('deal_owner with NO assigned owner is missing — never substituted', () => {
  const { values, missing } = resolveVariables(['deal_owner'], { ...fullCtx, owner: null }, 'he');
  assert.equal(values.deal_owner, null);
  assert.deepEqual(missing, ['deal_owner']);
});

test('activity_type returns the business label per language', () => {
  assert.equal(resolveVariables(['activity_type'], fullCtx, 'he').values.activity_type, 'פרטי');
  assert.equal(resolveVariables(['activity_type'], fullCtx, 'en').values.activity_type, 'Private');
});

test('activity_type: a linked organization labels an UNCLASSIFIED deal business', () => {
  const ctx = { ...fullCtx, deal: { ...fullCtx.deal, activityType: null, organizationId: 'org1' } };
  assert.equal(resolveVariables(['activity_type'], ctx, 'he').values.activity_type, 'עסקי');
});

test('activity_type: an EXPLICIT type outranks the linked organization', () => {
  // shared/dealActivity.mjs — the organization answers for a deal with no
  // answer of its own; it never overwrites a deliberate classification.
  const ctx = { ...fullCtx, deal: { ...fullCtx.deal, activityType: 'private', organizationId: 'org1' } };
  assert.equal(resolveVariables(['activity_type'], ctx, 'he').values.activity_type, 'פרטי');
});

test('sub_organization resolves the OrganizationUnit name; missing unit is missing', () => {
  assert.equal(resolveVariables(['sub_organization'], fullCtx, 'he').values.sub_organization, 'סניף רמת גן');
  const { missing } = resolveVariables(['sub_organization'], { deal: { organizationUnit: null } }, 'he');
  assert.deepEqual(missing, ['sub_organization']);
});

test('stale/deleted context (empty ctx) reports all four as missing, none substituted', () => {
  const { values, missing } = resolveVariables(KEYS, {}, 'he');
  for (const k of KEYS) assert.equal(values[k], null);
  assert.deepEqual(new Set(missing), new Set(KEYS));
});

// ── synthetic context → same pipeline ────────────────────────────────────────

test('synthetic context resolves the new variables through the same resolver', () => {
  const ctx = buildSyntheticContext({
    orderNo: '27999', activityType: 'business', subOrganization: 'תיכון עירוני ד׳',
    ownerName: 'מיכל', organization: 'עיריית תל אביב',
    contactFirstName: 'ישראל', phone: '050-0000000',
  });
  // Deal link needs PUBLIC_ORIGIN; synthetic exposes what the env provides —
  // assert the rest deterministically.
  const { values } = resolveVariables(['deal_owner', 'activity_type', 'sub_organization', 'org_name'], ctx, 'he');
  assert.equal(values.deal_owner, 'מיכל');
  assert.equal(values.activity_type, 'עסקי');
  assert.equal(values.sub_organization, 'תיכון עירוני ד׳');
  assert.equal(values.org_name, 'עיריית תל אביב');
});

test('synthetic context never fabricates catalog IDs (id-based conditions stay honest)', () => {
  const ctx = buildSyntheticContext({ product: 'סיור גרפיטי', city: 'תל אביב' });
  assert.equal(ctx.deal.productId, null);
  assert.equal(ctx.deal.locationId, null);
});

// ── prepare (dry-run service) over a synthetic context ───────────────────────

const noWindow = async () => ({ windowEnabled: false, window: null, exceptions: [] });

test('prepare: full synthetic run verdict=send with resolved variables and timing', async () => {
  const ctx = buildSyntheticContext({
    contactFirstName: 'ישראל', contactLastName: 'ישראלי', phone: '050-0000000',
    tourDate: '2030-08-10', tourTime: '09:30', product: 'סיור גרפיטי', city: 'תל אביב',
    activityType: 'private',
  });
  const message = {
    channel: 'whatsapp', audienceType: 'primary_contact', waAccountId: 'main',
    waDestinationType: 'private', languagePolicy: 'auto', fallbackLanguage: 'he',
    windowEnabled: false, sendingWindowId: null,
  };
  const event = { activityMode: 'all', activityTypes: [], orgTypeIds: [], orgSubtypeIds: [], conditions: [], anchorType: 'trigger_time', timingMode: 'immediate' };
  const run = await prepareMessageRun({
    message, event,
    versionContent: { he: { body: '<p>שלום {{customer_first_name}}, נתראה ב{{tour_city}}!</p>' }, attachments: [] },
    ctx, policyLoader: noWindow,
  });
  assert.equal(run.verdict.action, 'send');
  assert.equal(run.recipients[0].name, 'ישראל ישראלי');
  assert.equal(run.rendered.body, 'שלום ישראל, נתראה בתל אביב!');
  assert.ok(run.timing.intendedAt);
  assert.equal(run.timing.intendedAt, run.timing.effectiveAt);
});

test('prepare: "before the tour" timing computes intendedAt from the tour anchor', async () => {
  const ctx = buildSyntheticContext({
    contactFirstName: 'א', phone: '050-0000000', tourDate: '2030-08-10', tourTime: '09:00',
  });
  const event = { activityMode: 'all', activityTypes: [], orgTypeIds: [], orgSubtypeIds: [], conditions: [], anchorType: 'tour_datetime', timingMode: 'before', timingAmount: 3, timingUnit: 'days' };
  const message = { channel: 'whatsapp', audienceType: 'primary_contact', waDestinationType: 'private', languagePolicy: 'he_only', fallbackLanguage: 'he', windowEnabled: false };
  const run = await prepareMessageRun({
    message, event, versionContent: { he: { body: '<p>תזכורת</p>' }, attachments: [] },
    ctx, policyLoader: noWindow,
  });
  // 3 calendar days before 2030-08-07 09:00 Israel — the same timing function
  // the worker uses (timing.js), surfaced to the simulator.
  assert.ok(run.timing.intendedAt.startsWith('2030-08-07T'));
  assert.equal(run.verdict.action, 'send');
});

test('prepare: missing recipient phone yields an honest skip verdict', async () => {
  const ctx = buildSyntheticContext({ contactFirstName: 'בלי', contactLastName: 'טלפון' });
  const message = { channel: 'whatsapp', audienceType: 'primary_contact', waDestinationType: 'private', languagePolicy: 'he_only', fallbackLanguage: 'he', windowEnabled: false };
  const event = { activityMode: 'all', activityTypes: [], orgTypeIds: [], orgSubtypeIds: [], conditions: [], anchorType: 'trigger_time', timingMode: 'immediate' };
  const run = await prepareMessageRun({
    message, event, versionContent: { he: { body: '<p>x</p>' }, attachments: [] },
    ctx, policyLoader: noWindow,
  });
  assert.equal(run.verdict.action, 'skip');
  assert.match(run.verdict.reason, /טלפון/);
});
