import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addonApplies, resolveLanguageAddonEntry } from './engine.js';
import { buildAutoAddonLines } from './autoAddons.js';

// The language surcharge is 100% data-driven: the addon declares the trigger
// languages (autoApplyLanguages) and the engine evaluates that set — no 'he'/'en'
// literal anywhere in the pricing code.

const langAddon = {
  id: 'addon_lang',
  nameHe: 'תוספת שפה',
  active: true,
  defaultPriceMinor: 20000n, // ₪200
  vatMode: null, // inherit card VAT
  vatRate: 18,
  autoApplyLanguages: ['es', 'fr', 'ru'],
};

test('addonApplies(language): triggers only for languages in the configured set', () => {
  const entry = { autoApply: 'language', autoApplyLanguages: ['es', 'fr', 'ru'], enabled: true };
  assert.equal(addonApplies(entry, { tourLanguage: 'es' }), true);
  assert.equal(addonApplies(entry, { tourLanguage: 'fr' }), true);
  assert.equal(addonApplies(entry, { tourLanguage: 'ru' }), true);
  // "Regular" languages are simply absent from the set — no code condition.
  assert.equal(addonApplies(entry, { tourLanguage: 'en' }), false);
  assert.equal(addonApplies(entry, { tourLanguage: 'he' }), false);
  assert.equal(addonApplies(entry, { tourLanguage: null }), false);
  assert.equal(addonApplies(entry, {}), false);
});

test('changing the configured trigger set changes behavior with NO code change', () => {
  // Adding a language to the data flips applicability — proves it is data-driven.
  const entry = { autoApply: 'language', autoApplyLanguages: ['de'], enabled: true };
  assert.equal(addonApplies(entry, { tourLanguage: 'de' }), true);
  assert.equal(addonApplies(entry, { tourLanguage: 'es' }), false);
});

test('resolveLanguageAddonEntry: carries key/price/languages; inert when unconfigured', () => {
  const e = resolveLanguageAddonEntry(langAddon, null);
  assert.equal(e.addonId, 'addon_lang');
  assert.equal(e.autoApply, 'language');
  assert.deepEqual(e.autoApplyLanguages, ['es', 'fr', 'ru']);
  assert.equal(e.priceMinor, 20000);
  // Inert cases → null (never applies): no trigger languages, inactive, ≤0 price.
  assert.equal(resolveLanguageAddonEntry({ ...langAddon, autoApplyLanguages: [] }, null), null);
  assert.equal(resolveLanguageAddonEntry({ ...langAddon, active: false }, null), null);
  assert.equal(resolveLanguageAddonEntry({ ...langAddon, defaultPriceMinor: 0n }, null), null);
  assert.equal(resolveLanguageAddonEntry(null, null), null);
});

test('buildAutoAddonLines injects ONE language surcharge line for a non-regular language', () => {
  const catalog = new Map([['addon_lang', { nameHe: 'תוספת שפה', vatMode: null, vatRate: 18 }]]);
  const base = {
    ruleAddons: [],
    systemAddon: null,
    languageAddon: langAddon,
    cardVat: { vatMode: 'excluded', vatRate: 18 },
    cardGroupId: 'card_1',
    moment: { weekday: 3, minuteOfDay: 600, dateISO: '2026-08-05' },
    isSabbathHoliday: false,
    addonCatalogById: catalog,
    groupCount: 2,
  };

  const es = buildAutoAddonLines({ ...base, tourLanguage: 'es' });
  const langLine = es.find((l) => l.refId === 'addon_lang');
  assert.ok(langLine, 'expected a language surcharge line for es');
  assert.equal(langLine.unitPriceMinor, 20000);
  assert.equal(langLine.label, 'תוספת שפה');
  // Uniform with every auto surcharge: per group (× groupCount).
  assert.equal(langLine.quantity, 2);

  // Regular languages emit nothing.
  assert.equal(buildAutoAddonLines({ ...base, tourLanguage: 'en' }).length, 0);
  assert.equal(buildAutoAddonLines({ ...base, tourLanguage: 'he' }).length, 0);
  assert.equal(buildAutoAddonLines({ ...base, tourLanguage: null }).length, 0);
});
