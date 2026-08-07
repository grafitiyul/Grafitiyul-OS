// Confirmation Email — customer-facing variable catalog tests. Pure: no DB.
// Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIRMATION_VARIABLES,
  CONFIRMATION_VARIABLE_KEYS,
  CONFIRMATION_VARIABLE_CATEGORIES,
  listConfirmationVariables,
  resolveConfirmationVariables,
} from './variables.js';

const ctx = {
  deal: {
    orderNo: 27123,
    groupName: 'כיתה ו2',
    activityType: 'group',
    organizationId: null,
    valueMinor: 250000n,
    currency: 'ILS',
    tourDate: '2026-08-20',
    tourTime: '10:00',
    tourLanguage: 'he',
    participants: 25,
    product: { nameHe: 'סיור גרפיטי', nameEn: 'Graffiti Tour' },
    location: { nameHe: 'תל אביב', nameEn: 'Tel Aviv' },
    organization: null,
    organizationType: { label: 'בית ספר', labelEn: 'School' },
  },
  contact: { firstNameHe: 'דנה', lastNameHe: 'לוי', firstNameEn: 'Dana', lastNameEn: 'Levi' },
  email: 'dana@example.com',
  contactPhone: '050-1234567',
  meetingPoint: { text: 'מתחת לשעון' },
  effectiveDurationHours: 2,
  tourBookingsCount: 3,
  brandContact: { whatsapp: '+972-50-0000000', email: 'hello@grafitiyul.co.il' },
};

// ── allowlist safety ─────────────────────────────────────────────────────────

test('the catalog contains NO staff/internal keys', () => {
  const forbidden = /staff|portal|deal_link|lead_|owner|note|salary|internal|token/;
  for (const key of CONFIRMATION_VARIABLE_KEYS) {
    assert.doesNotMatch(key, forbidden, `key ${key} looks internal`);
  }
});

test('every entry is complete: labels, description, category, resolver', () => {
  for (const v of CONFIRMATION_VARIABLES) {
    assert.ok(v.labelHe && v.labelEn && v.descriptionHe, v.key);
    assert.ok(CONFIRMATION_VARIABLE_CATEGORIES[v.category], `${v.key}: unknown category`);
    assert.equal(typeof v.resolve, 'function', v.key);
  }
});

test('listConfirmationVariables strips resolvers (client-safe meta)', () => {
  for (const v of listConfirmationVariables()) {
    assert.equal(v.resolve, undefined);
    assert.ok(v.key && v.labelHe);
  }
});

// ── resolution ───────────────────────────────────────────────────────────────

test('Hebrew resolution: names, labels, money, duration', () => {
  const { values, missing } = resolveConfirmationVariables(ctx, 'he');
  assert.equal(values.customer_first_name, 'דנה');
  assert.equal(values.customer_full_name, 'דנה לוי');
  assert.equal(values.org_type, 'בית ספר');
  assert.equal(values.deal_number, '27123');
  assert.equal(values.activity_type, 'קבוצתי');
  assert.equal(values.total_amount, '₪2,500');
  assert.equal(values.tour_date, '20.8.2026');
  assert.equal(values.effective_duration, 'שעתיים');
  assert.equal(values.tour_bookings_count, '3');
  assert.equal(values.meeting_point, 'מתחת לשעון');
  assert.equal(values.team_name, 'צוות גרפיטיול');
  assert.equal(values.brand_email, 'hello@grafitiyul.co.il');
  assert.equal(missing.find((m) => m.key === 'org_name')?.label, 'שם הארגון');
});

test('English resolution is strict for names, labeled for enums', () => {
  const { values } = resolveConfirmationVariables(ctx, 'en');
  assert.equal(values.customer_first_name, 'Dana');
  assert.equal(values.tour_date, '20/08/2026');
  assert.equal(values.effective_duration, '2 hours');
  assert.equal(values.activity_type, 'Group');
  assert.equal(values.team_name, 'The Grafitiyul team');
});

test('organization details resolve, and an EXPLICIT activity type is kept', () => {
  const withOrg = {
    ...ctx,
    deal: {
      ...ctx.deal,
      organizationId: 'org1',
      organization: { name: 'סוכנות נסיעות בע״מ', organizationType: { label: 'סוכנות', labelEn: 'Agency' } },
    },
  };
  const { values } = resolveConfirmationVariables(withOrg, 'he');
  assert.equal(values.org_name, 'סוכנות נסיעות בע״מ');
  assert.equal(values.org_type, 'סוכנות');
  // ctx.deal carries an explicit activityType — the organization is a default
  // for deals with no answer of their own, never an override (dealActivity.mjs).
  assert.equal(values.activity_type, 'קבוצתי');
});

test('an unclassified deal with an organization reads as business', () => {
  const unclassified = {
    ...ctx,
    deal: { ...ctx.deal, activityType: null, organizationId: 'org1' },
  };
  const { values } = resolveConfirmationVariables(unclassified, 'he');
  assert.equal(values.activity_type, 'עסקי');
});

test('empty context resolves everything to "" with labeled missing entries', () => {
  const { values, missing } = resolveConfirmationVariables({ deal: {} }, 'he');
  for (const key of CONFIRMATION_VARIABLE_KEYS) {
    if (key === 'team_name') continue; // static, always present
    assert.equal(values[key], '', key);
  }
  assert.ok(missing.length >= CONFIRMATION_VARIABLE_KEYS.length - 1);
  assert.ok(missing.every((m) => m.label));
});
