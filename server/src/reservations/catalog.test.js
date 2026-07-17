import test from 'node:test';
import assert from 'node:assert/strict';
import { bookableCatalog, effectiveAgentCity } from './intake.js';

// The canonical agent-catalog resolution (corrective slice):
//   effectiveAgentCity(location) = location.parentLocation ?? location
// City list derives from ELIGIBLE variants only; agents see commercial
// display names, never internal ones; the operational locationId is
// preserved untouched for the Deal.

const TLV = { id: 'tlv', nameHe: 'תל אביב', nameEn: 'Tel Aviv', sortOrder: 0, active: true };
const FLORENTIN = {
  id: 'flor', nameHe: 'תל אביב - פלורנטין', nameEn: null, sortOrder: 1, parentLocation: TLV,
};
const KIRYAT = {
  id: 'kiryat', nameHe: 'תל אביב - קריית המלאכה', nameEn: null, sortOrder: 2, parentLocation: TLV,
};
const HOME = { id: 'home', nameHe: 'בית הלקוח', nameEn: 'Customer site', sortOrder: 3, parentLocation: null };

function fakeDb(variants) {
  return {
    productVariant: {
      findMany: async ({ where }) => {
        // The query itself must demand eligibility — assert the shape once.
        assert.equal(where.agentVisible, true);
        assert.equal(where.availableBusiness, true);
        return variants;
      },
    },
  };
}

const v = (id, location, over = {}) => ({
  id,
  productId: `p_${id}`,
  locationId: location.id,
  agentDisplayName: `שם מסחרי ${id}`,
  agentDisplayNameEn: null,
  agentDescription: null,
  location,
  ...over,
});

test('effectiveAgentCity: parent wins, standalone stays itself, inactive parent ignored', () => {
  assert.equal(effectiveAgentCity(FLORENTIN).id, 'tlv');
  assert.equal(effectiveAgentCity(HOME).id, 'home');
  assert.equal(
    effectiveAgentCity({ ...FLORENTIN, parentLocation: { ...TLV, active: false } }).id,
    'flor',
  );
  assert.equal(effectiveAgentCity(null), null);
});

test('two variants from different child locations appear under ONE commercial city', async () => {
  const catalog = await bookableCatalog(
    fakeDb([v('a', FLORENTIN), v('b', KIRYAT), v('c', HOME)]),
  );
  assert.deepEqual(catalog.cities.map((c) => c.key), ['tlv', 'home']);
  assert.equal(catalog.cities[0].nameHe, 'תל אביב');
  const tlvActivities = catalog.variants.filter((x) => x.cityKey === 'tlv');
  assert.deepEqual(tlvActivities.map((x) => x.id), ['a', 'b']);
  // The internal child-location complexity is never exposed…
  assert.ok(!JSON.stringify(catalog.cities).includes('פלורנטין'));
  // …but the OPERATIONAL location is preserved for the Deal.
  assert.equal(tlvActivities[0].locationId, 'flor');
  assert.equal(tlvActivities[1].locationId, 'kiryat');
});

test('agents see the commercial display name and city — never internal names', async () => {
  const catalog = await bookableCatalog(fakeDb([v('a', KIRYAT)]));
  const row = catalog.variants[0];
  assert.equal(row.nameHe, 'שם מסחרי a');
  assert.equal(row.productLabel, 'שם מסחרי a'); // frozen snapshot label
  assert.equal(row.locationLabel, 'תל אביב'); // commercial city, not קריית המלאכה
});

test('a visible variant WITHOUT a display name is excluded (defense in depth)', async () => {
  const catalog = await bookableCatalog(
    fakeDb([v('a', FLORENTIN, { agentDisplayName: null }), v('b', KIRYAT)]),
  );
  assert.deepEqual(catalog.variants.map((x) => x.id), ['b']);
});

test('a city appears only when at least one eligible variant resolves to it', async () => {
  const catalog = await bookableCatalog(fakeDb([v('a', HOME)]));
  assert.deepEqual(catalog.cities.map((c) => c.key), ['home']);
  assert.equal(catalog.cities[0].nameEn, 'Customer site');
});

test('EN falls back to the Hebrew COMMERCIAL name (approved channel rule)', async () => {
  const catalog = await bookableCatalog(
    fakeDb([v('a', FLORENTIN), v('b', KIRYAT, { agentDisplayNameEn: 'October 7th Tour' })]),
  );
  const [a, b] = catalog.variants;
  assert.equal(a.nameEn, 'שם מסחרי a');
  assert.equal(b.nameEn, 'October 7th Tour');
});
