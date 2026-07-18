// Automatic add-on line generation (node:test, pure). Verifies the builder's
// auto lines come from the SAME engine primitives the preview uses: the שבת/חג
// system add-on (catalog default ⊕ per-card override), weekday auto-apply, and
// that 'manual' add-ons are never auto-generated.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutoAddonLines, tourMoment, AUTO_ADDON_SOURCE_KIND } from './autoAddons.js';

const SYSTEM = { id: 'ad_sabbath', systemKey: 'sabbath_holiday', active: true, defaultPriceMinor: 40000n, vatMode: 'included', vatRate: 18 };
const CATALOG = new Map([
  ['ad_sabbath', { id: 'ad_sabbath', nameHe: 'תוספת שבת/חג', vatMode: 'included', vatRate: 18 }],
  ['ad_fri', { id: 'ad_fri', nameHe: 'תוספת שישי', vatMode: null, vatRate: null }],
  ['ad_manual', { id: 'ad_manual', nameHe: 'תוספת ידנית', vatMode: null, vatRate: null }],
]);
const CARD_VAT = { vatMode: 'included', vatRate: 18 };

test('tourMoment: weekday from date (UTC), minute from HH:MM', () => {
  // 2026-07-25 is a Saturday.
  const m = tourMoment('2026-07-25', '11:30');
  assert.equal(m.weekday, 6);
  assert.equal(m.minuteOfDay, 690);
  assert.equal(m.dateISO, '2026-07-25');
  assert.deepEqual(tourMoment(null, null), { dateISO: null, weekday: null, minuteOfDay: null });
});

test('שבת applies → one system add-on line with card provenance', () => {
  const lines = buildAutoAddonLines({
    ruleAddons: [],
    systemAddon: SYSTEM,
    cardVat: CARD_VAT,
    cardGroupId: 'card_a',
    moment: tourMoment('2026-07-25', '11:00'),
    isSabbathHoliday: true,
    addonCatalogById: CATALOG,
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, 'addon');
  assert.equal(lines[0].refId, 'ad_sabbath');
  assert.equal(lines[0].label, 'תוספת שבת/חג');
  assert.equal(lines[0].unitPriceMinor, 40000);
  assert.equal(lines[0].sourceKind, AUTO_ADDON_SOURCE_KIND);
  assert.equal(lines[0].sourceCardGroupId, 'card_a');
});

test('no שבת/חג → no system line; card override can disable or reprice it', () => {
  const none = buildAutoAddonLines({
    ruleAddons: [], systemAddon: SYSTEM, cardVat: CARD_VAT, cardGroupId: 'c',
    moment: tourMoment('2026-07-21', '11:00'), isSabbathHoliday: false, addonCatalogById: CATALOG,
  });
  assert.equal(none.length, 0);
  const disabled = buildAutoAddonLines({
    ruleAddons: [{ addonId: 'ad_sabbath', enabled: false }],
    systemAddon: SYSTEM, cardVat: CARD_VAT, cardGroupId: 'c',
    moment: tourMoment('2026-07-25', '11:00'), isSabbathHoliday: true, addonCatalogById: CATALOG,
  });
  assert.equal(disabled.length, 0);
  const repriced = buildAutoAddonLines({
    ruleAddons: [{ addonId: 'ad_sabbath', enabled: true, priceMinor: 25000 }],
    systemAddon: SYSTEM, cardVat: CARD_VAT, cardGroupId: 'c',
    moment: tourMoment('2026-07-25', '11:00'), isSabbathHoliday: true, addonCatalogById: CATALOG,
  });
  assert.equal(repriced[0].unitPriceMinor, 25000);
});

test('weekday auto add-on: applies only on its configured weekdays', () => {
  const friday = { addonId: 'ad_fri', enabled: true, priceMinor: 15000, vatMode: null, vatRate: null, autoApply: 'weekdays', autoApplyWeekdays: [5] };
  // 2026-07-24 is a Friday (weekday 5).
  const on = buildAutoAddonLines({
    ruleAddons: [friday], systemAddon: null, cardVat: CARD_VAT, cardGroupId: 'c',
    moment: tourMoment('2026-07-24', '10:00'), isSabbathHoliday: false, addonCatalogById: CATALOG,
  });
  assert.equal(on.length, 1);
  assert.equal(on[0].label, 'תוספת שישי');
  // VAT inherits the card (catalog null): included@18.
  assert.equal(on[0].vatMode, 'included');
  const off = buildAutoAddonLines({
    ruleAddons: [friday], systemAddon: null, cardVat: CARD_VAT, cardGroupId: 'c',
    moment: tourMoment('2026-07-21', '10:00'), isSabbathHoliday: false, addonCatalogById: CATALOG,
  });
  assert.equal(off.length, 0);
});

test('manual add-ons are NEVER auto-generated', () => {
  const manual = { addonId: 'ad_manual', enabled: true, priceMinor: 9000, autoApply: 'manual', autoApplyWeekdays: [] };
  const lines = buildAutoAddonLines({
    ruleAddons: [manual], systemAddon: null, cardVat: CARD_VAT, cardGroupId: 'c',
    moment: tourMoment('2026-07-25', '10:00'), isSabbathHoliday: true, addonCatalogById: CATALOG,
  });
  assert.equal(lines.length, 0);
});

test('auto add-on quantity multiplies by groups (₪250 שבת × 2 groups = ₪500)', () => {
  const lines = buildAutoAddonLines({
    ruleAddons: [], systemAddon: { ...SYSTEM, defaultPriceMinor: 25000n }, cardVat: CARD_VAT, cardGroupId: 'c',
    moment: tourMoment('2026-07-25', '11:00'), isSabbathHoliday: true, addonCatalogById: CATALOG, groupCount: 2,
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].unitPriceMinor, 25000);
  assert.equal(lines[0].quantity, 2);
});
