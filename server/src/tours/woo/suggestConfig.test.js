import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestWooConfig, readableSlug } from './suggestConfig.js';

// Auto-config builder — proves it resolves REAL ticketTypeIds and the store's
// EXACT option encoding (from #167's live variations), no placeholders.

test('readableSlug matches the store encoding', () => {
  assert.equal(readableSlug('סיור + סדנה'), 'סיור-סדנה');
  assert.equal(readableSlug('סיור בלבד'), 'סיור-בלבד');
  assert.equal(readableSlug('מבוגר'), 'מבוגר');
  assert.equal(readableSlug('08/08/2026'), '08-08-2026');
});

// A fake shaped exactly like Tel Aviv #167.
const PRODUCT = {
  id: 167,
  name: 'סיור וסדנת גרפיטי בתל אביב',
  attributes: [
    { id: 5, name: 'גיל', variation: true },
    { id: 3, name: 'פעילות', variation: true },
    { id: 2, name: 'שעה', variation: true },
    { id: 1, name: 'תאריך', variation: true },
  ],
};
const VARIATIONS = [
  { id: 1101, attributes: [{ id: 5, option: 'מבוגר' }, { id: 3, option: 'סיור-בלבד' }, { id: 2, option: '0700' }, { id: 1, option: '01-06-2026' }] },
  { id: 1100, attributes: [{ id: 5, option: 'ילד' }, { id: 3, option: 'סיור-בלבד' }, { id: 2, option: '0700' }, { id: 1, option: '01-06-2026' }] },
  { id: 1099, attributes: [{ id: 5, option: 'מבוגר' }, { id: 3, option: 'סיור-סדנה' }, { id: 2, option: '0700' }, { id: 1, option: '01-06-2026' }] },
  { id: 1098, attributes: [{ id: 5, option: 'ילד' }, { id: 3, option: 'סיור-סדנה' }, { id: 2, option: '0700' }, { id: 1, option: '01-06-2026' }] },
];

function deps(rows) {
  return {
    db: {
      priceRule: {
        findFirst: async () => ({
          priceModel: 'ticket_types',
          ticketPrices: rows.map((r) => ({ ticketTypeId: r.id, priceMinor: r.price, ticketType: { nameHe: r.label, sortOrder: r.sort } })),
        }),
      },
    },
    woo: {
      getProduct: async () => PRODUCT,
      listVariations: async () => VARIATIONS,
      listAttributeTerms: async () => [],
    },
  };
}

const TA_ROWS = [
  { id: 'ckAdult123', label: 'מבוגר', price: 6000, sort: 0 },
  { id: 'ckChild456', label: 'ילד', price: 3000, sort: 1 },
];

test('tour-only card → real ids + exact #167 encoding', async () => {
  const r = await suggestWooConfig(deps(TA_ROWS), {
    cardGroupId: 'cardTour',
    productId: 167,
    cardTitle: 'Graffiti Tour',
  });
  assert.equal(r.warnings.length, 0);
  assert.deepEqual(r.config.date, { attrId: 1, attrName: 'תאריך', format: 'slash-dmy' });
  assert.deepEqual(r.config.time, { attrId: 2, attrName: 'שעה' });
  assert.equal(r.config.age.attrId, 5);
  assert.equal(r.config.activity.attrId, 3);
  assert.equal(r.config.activity.option, 'סיור-בלבד'); // tour-only, exact store form
  // REAL ticket ids as keys, age NAME as option (as #167 stores it).
  assert.deepEqual(r.config.ticketAge, {
    ckAdult123: { option: 'מבוגר', label: 'מבוגר' },
    ckChild456: { option: 'ילד', label: 'ילד' },
  });
});

test('workshop card (title inference) → סיור-סדנה', async () => {
  const r = await suggestWooConfig(deps(TA_ROWS), {
    cardGroupId: 'cardWs',
    productId: 167,
    cardTitle: 'Graffiti Tour + Workshop',
  });
  assert.equal(r.config.activity.option, 'סיור-סדנה');
  assert.equal(r.warnings.length, 0);
});

test('explicit activity override beats the title', async () => {
  const r = await suggestWooConfig(deps(TA_ROWS), {
    cardGroupId: 'c',
    productId: 167,
    cardTitle: 'ambiguous',
    activity: 'workshop',
  });
  assert.equal(r.config.activity.option, 'סיור-סדנה');
});

test('an unmatched ticket type is REPORTED, never silently dropped', async () => {
  const rows = [
    { id: 'ckAdult123', label: 'מבוגר', price: 6000, sort: 0 },
    { id: 'ckStudent', label: 'סטודנט', price: 4000, sort: 1 }, // no age term
  ];
  const r = await suggestWooConfig(deps(rows), { cardGroupId: 'c', productId: 167, cardTitle: 'Graffiti Tour' });
  assert.ok(r.config.ticketAge.ckAdult123);
  assert.equal(r.config.ticketAge.ckStudent, undefined);
  assert.match(r.warnings.join(' '), /סטודנט.*ckStudent/);
});
