import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { guideTourDetailDto } from './dto.js';
import { guidePayEntryDto } from '../../payroll/dto.js';
import {
  pickBilingual,
  catalogName,
  catalogTitle,
  pairFrom,
  contactFullName,
} from '../../../../shared/bilingualText.mjs';

// Guide Portal — ENGLISH DATA regression suite.
//
// The portal's language architecture rests on three promises. These tests pin
// all three, so a future change cannot quietly break any of them:
//
//   1. an English guide reads MANAGED data in English
//   2. a Hebrew guide's experience is byte-identical to before
//   3. code NEVER invents English — a missing value is a DATA gap, surfaced,
//      not translated, not blanked, not special-cased per record
//
// Everything here is pure: the DTO builders take already-fetched rows, so the
// suite runs without a database and cannot go green against a stale schema
// (the DMMF contract test covers field existence separately).

const SERVER_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIENT_SRC = path.resolve(SERVER_SRC, '..', '..', 'client', 'src');
const SCHEMA = path.resolve(SERVER_SRC, '..', 'prisma', 'schema.prisma');

const ALL_ON = {
  viewTeam: true,
  viewParticipantPhone: true,
  viewParticipantEmail: true,
  viewCustomerInfo: true,
  viewFieldRep: true,
  useCoordinationForms: true,
};

// A tour whose every managed field has BOTH languages authored.
function bilingualTour() {
  return {
    id: 't1',
    kind: 'business',
    product: { nameHe: 'סיור גרפיטי', nameEn: 'Graffiti Tour' },
    location: { nameHe: 'פלורנטין', nameEn: 'Florentin' },
    assignments: [],
    bookings: [],
    activityComponents: [
      {
        id: 'c1',
        activityComponent: {
          nameHe: 'סדנת גרפיטי',
          nameEn: 'Graffiti workshop',
          icon: '🎨',
          isWorkshop: true,
        },
        workshopLocation: {
          nameHe: 'גג הסטודיו',
          nameEn: 'Studio roof',
          address: 'רח׳ העם 1',
          addressEn: '1 Ha-Am St.',
          instructions: 'לעלות במעלית לקומה 4',
          instructionsEn: 'Take the lift to floor 4',
        },
      },
    ],
  };
}

// ── 1. English guide receives English managed data ───────────────────────────

test('English guide: every managed tour field resolves from its English column', () => {
  const dto = guideTourDetailDto({
    tour: bilingualTour(),
    assignment: { role: 'guide' },
    occupancy: { activeSeats: 0 },
    permissions: ALL_ON,
    lang: 'en',
  });
  assert.equal(dto.variantName, 'Graffiti Tour · Florentin');
  assert.equal(dto.productName, 'Graffiti Tour');
  assert.equal(dto.locationName, 'Florentin');
  assert.equal(dto.components[0].name, 'Graffiti workshop');
  // The operationally critical one: WHERE to go and HOW to get in.
  assert.equal(dto.workshopLocations[0].location.name, 'Studio roof');
  assert.equal(dto.workshopLocations[0].location.address, '1 Ha-Am St.');
  assert.equal(dto.workshopLocations[0].location.instructions, 'Take the lift to floor 4');
});

// ── 2. Hebrew guide is unchanged ─────────────────────────────────────────────

test('Hebrew guide: the same tour resolves entirely from the Hebrew columns', () => {
  const dto = guideTourDetailDto({
    tour: bilingualTour(),
    assignment: { role: 'guide' },
    occupancy: { activeSeats: 0 },
    permissions: ALL_ON,
    lang: 'he',
  });
  assert.equal(dto.variantName, 'סיור גרפיטי · פלורנטין');
  assert.equal(dto.components[0].name, 'סדנת גרפיטי');
  assert.equal(dto.workshopLocations[0].location.name, 'גג הסטודיו');
  assert.equal(dto.workshopLocations[0].location.address, 'רח׳ העם 1');
  assert.equal(dto.workshopLocations[0].location.instructions, 'לעלות במעלית לקומה 4');
});

test('Hebrew is the default: an absent/unknown language never changes behaviour', () => {
  const tour = bilingualTour();
  const he = guideTourDetailDto({ tour, assignment: {}, occupancy: {}, permissions: ALL_ON, lang: 'he' });
  for (const lang of [undefined, null, '', 'fr', 'de']) {
    const dto = guideTourDetailDto({ tour, assignment: {}, occupancy: {}, permissions: ALL_ON, lang });
    assert.equal(dto.variantName, he.variantName, `lang=${lang}`);
    assert.equal(dto.components[0].name, he.components[0].name, `lang=${lang}`);
  }
});

// ── 3. Missing English is a reported DATA gap, never an invention ────────────

test('missing English keeps the authored value — never blank, never translated', () => {
  const tour = bilingualTour();
  // Real production shape: half the pair is filled.
  tour.location.nameEn = null;
  tour.activityComponents[0].workshopLocation.instructionsEn = '';
  const dto = guideTourDetailDto({
    tour,
    assignment: {},
    occupancy: {},
    permissions: ALL_ON,
    lang: 'en',
  });
  // The authored Hebrew shows — a nameless card is unusable in the field, and
  // nothing here fabricates an English string.
  assert.equal(dto.variantName, 'Graffiti Tour · פלורנטין');
  assert.equal(dto.workshopLocations[0].location.instructions, 'לעלות במעלית לקומה 4');
});

test('the resolver reports the fallback so the gap is detectable, not silent', async () => {
  const { isBilingualFallback } = await import('../../../../shared/bilingualText.mjs');
  assert.equal(isBilingualFallback({ he: 'פלורנטין', en: null }, 'en'), true);
  assert.equal(isBilingualFallback({ he: 'פלורנטין', en: 'Florentin' }, 'en'), false);
  // Nothing authored at all is not a "fallback" — there is simply no value.
  assert.equal(isBilingualFallback({ he: '', en: '' }, 'en'), false);
  // Hebrew readers never trigger the English-gap signal.
  assert.equal(isBilingualFallback({ he: 'פלורנטין', en: null }, 'he'), false);
});

test('an empty English column is never written as the Hebrew value', () => {
  // The picker CHOOSES; it must not mutate or copy. Same object in → the
  // English side stays exactly as authored (empty).
  const pair = { he: 'סיור', en: '' };
  pickBilingual(pair, 'en');
  assert.equal(pair.en, '');
});

// ── 4. Language-neutral values are untouched ─────────────────────────────────

test('language-neutral values pass through byte-identically in both languages', () => {
  const tour = bilingualTour();
  tour.notes = 'להביא רמקול\nלהתקשר לאבטחה';
  tour.bookings = [
    {
      id: 'b1',
      status: 'active',
      seats: 4,
      deal: {
        // Organization name, group name and customer free text are business
        // values: never translated, in either direction.
        organization: { name: 'IBM ישראל' },
        groupName: 'קבוצת דור',
        customerInfo: '<p>מגיעים באוטובוס</p>',
        organizationUnit: null,
        contacts: [
          {
            isPrimary: true,
            roles: [],
            contact: {
              firstNameHe: 'דור',
              lastNameHe: 'קורן',
              firstNameEn: 'Dor',
              lastNameEn: 'Koren',
              phones: [{ value: '050-1234567' }],
              emails: [{ value: 'dor@example.com' }],
            },
          },
        ],
      },
    },
  ];
  const of = (lang) =>
    guideTourDetailDto({ tour, assignment: {}, occupancy: { activeSeats: 4 }, permissions: ALL_ON, lang });
  const he = of('he');
  const en = of('en');

  for (const dto of [he, en]) {
    assert.equal(dto.notes, 'להביא רמקול\nלהתקשר לאבטחה');
    assert.equal(dto.participants[0].title, 'IBM ישראל');
    assert.equal(dto.participants[0].groupName, 'קבוצת דור');
    assert.equal(dto.participants[0].customerInfo, '<p>מגיעים באוטובוס</p>');
    assert.equal(dto.participants[0].phone, '050-1234567');
    assert.equal(dto.participants[0].email, 'dor@example.com');
  }
  // A contact's NAME is bilingual data the operator entered in both scripts —
  // that one does follow the reader.
  assert.equal(he.participants[0].customerName, 'דור קורן');
  assert.equal(en.participants[0].customerName, 'Dor Koren');
});

// ── 5. Every new English field is reachable through the DTO/API path ─────────
//
// A column nobody selects is a column nobody sees. These assertions pin that
// each new field is actually read somewhere on the portal's server path.

const NEW_FIELDS = [
  // [model, field, the server file that must read it]
  ['WorkshopLocation', 'nameEn', 'src/tours/guidePortal/dto.js'],
  ['WorkshopLocation', 'addressEn', 'src/tours/guidePortal/dto.js'],
  ['WorkshopLocation', 'instructionsEn', 'src/tours/guidePortal/dto.js'],
  ['Tour', 'titleEn', 'src/routes/portalTraining.js'],
  ['Tour', 'descriptionEn', 'src/routes/portalTraining.js'],
  ['TourStation', 'titleEn', 'src/routes/portalTraining.js'],
  ['TourStation', 'descriptionEn', 'src/routes/portalTraining.js'],
  ['TourStation', 'heroImageTitleEn', 'src/routes/portalTraining.js'],
  ['TourContentBlock', 'titleEn', 'src/routes/portalTraining.js'],
  ['TourContentBlock', 'bodyEn', 'src/routes/portalTraining.js'],
  ['TourBlockAsset', 'titleEn', 'src/routes/portalTraining.js'],
  ['PayrollComponent', 'nameEn', 'src/routes/portalPay.js'],
  ['GeneralActivityType', 'unitLabelSingularEn', 'src/routes/portalPay.js'],
  ['GeneralActivityType', 'unitLabelPluralEn', 'src/routes/portalPay.js'],
  ['PayrollActivity', 'titleEn', 'src/payroll/dto.js'],
  ['Flow', 'titleEn', 'src/routes/portal.js'],
  ['Flow', 'descriptionEn', 'src/routes/portal.js'],
];

test('every new English column exists in the schema', () => {
  const schema = fs.readFileSync(SCHEMA, 'utf8');
  for (const [model, field] of NEW_FIELDS) {
    const block = new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`).exec(schema);
    assert.ok(block, `model ${model} not found`);
    assert.match(block[0], new RegExp(`\\b${field}\\s`), `${model}.${field} missing from the schema`);
  }
});

test('every new English column is read on the portal server path', () => {
  for (const [model, field, file] of NEW_FIELDS) {
    const src = fs.readFileSync(path.join(SERVER_SRC, '..', file), 'utf8');
    assert.ok(src.includes(field), `${model}.${field} is never read in ${file}`);
  }
});

// ── 6/7. Admin write paths accept BOTH languages ─────────────────────────────

test('every bilingual admin write path accepts the English twin', () => {
  const cases = [
    ['src/routes/workshopLocations.js', ['nameEn', 'addressEn', 'instructionsEn']],
    ['src/routes/payroll.js', ['nameEn', 'unitLabelSingularEn', 'unitLabelPluralEn']],
    ['src/routes/flows.js', ['titleEn', 'descriptionEn']],
    ['src/tour-content/tourContent.js', ['titleEn', 'descriptionEn', 'bodyEn', 'heroImageTitleEn']],
  ];
  for (const [file, fields] of cases) {
    const src = fs.readFileSync(path.join(SERVER_SRC, '..', file), 'utf8');
    for (const f of fields) {
      assert.ok(src.includes(f), `${file} does not write ${f}`);
    }
  }
});

// ── THE operator rule ────────────────────────────────────────────────────────
//
// "If an operator is expected to translate it, there must be a normal admin
//  screen where it can be edited."
//
// Nothing that the coverage report asks an operator to fill may live only in the
// database. This pins the admin EDITOR for every such field — the gap that let
// ActivityComponent.nameEn sit in the schema (and in the report) for months with
// no input anywhere, on the very page whose other card was already bilingual.
const OPERATOR_EDITABLE = [
  // [what the report asks for, the admin screen, how that screen edits it]
  ['ActivityComponent.nameEn', 'client/src/admin/tours/settings/ActivityComponentsSettings.jsx', 'nameEn'],
  ['WorkshopLocation.*En', 'client/src/admin/tours/settings/WorkshopLocationsSettings.jsx', 'instructionsEn'],
  ['Product.nameEn', 'client/src/admin/products/ProductDetail.jsx', 'nameEn'],
  ['Location.nameEn', 'client/src/admin/products/LocationsSettings.jsx', 'nameEn'],
  ['PayrollComponent.nameEn', 'client/src/admin/finance/settings/PayrollComponentsSettings.jsx', 'nameEn'],
  ['GeneralActivityType.*En', 'client/src/admin/finance/settings/GeneralActivityTypesSettings.jsx', 'unitLabelSingularEn'],
  ['Flow.titleEn', 'client/src/admin/procedures/flows/FlowEditor.jsx', 'titleEn'],
  ['Tour.titleEn', 'client/src/admin/tour-content/StationsPane.jsx', 'titleEn'],
  ['TourStation.titleEn', 'client/src/admin/tour-content/StationEditor.jsx', 'titleEn'],
  ['TourContentBlock.bodyEn', 'client/src/admin/tour-content/StationEditor.jsx', 'bodyEn'],
];

test('every field the report asks an operator to translate has an admin editor', () => {
  for (const [what, file, token] of OPERATOR_EDITABLE) {
    const full = path.join(CLIENT_SRC, '..', '..', file);
    assert.ok(fs.existsSync(full), `${what}: admin screen ${file} does not exist`);
    const src = fs.readFileSync(full, 'utf8');
    assert.ok(
      src.includes(token),
      `${what} is in the English-coverage report but ${file} has no way to edit it — ` +
        'nothing requiring English may exist only in the database',
    );
  }
});

// Reachability: an editor nobody can navigate to is the same problem one step
// later. Each screen above must be routed AND linked from its settings hub.
test('every bilingual admin screen is routed and reachable', () => {
  const app = fs.readFileSync(path.join(CLIENT_SRC, 'App.jsx'), 'utf8');
  const routes = [
    'settings/tours/components',
    'settings/finance/payroll-components',
    'settings/finance/activity-types',
    'settings/crm/locations',
  ];
  for (const r of routes) assert.ok(app.includes(r), `route ${r} is not registered in App.jsx`);
  // Procedures (flows) is a top-level module, not a settings page.
  assert.match(app, /path="flows"/);

  const nav = fs.readFileSync(path.join(CLIENT_SRC, 'admin', 'settings', 'settingsNav.js'), 'utf8');
  for (const r of routes) {
    assert.ok(nav.includes(r), `${r} has no breadcrumb/nav entry — an operator cannot find it`);
  }
  const financeHome = fs.readFileSync(
    path.join(CLIENT_SRC, 'admin', 'settings', 'FinanceSettingsHome.jsx'),
    'utf8',
  );
  for (const r of ['payroll-components', 'activity-types']) {
    assert.ok(financeHome.includes(r), `Finance settings home does not link to ${r}`);
  }
});

test('the English snapshot never copies Hebrew into an English column', async () => {
  // PayrollActivity/GeneralActivity freeze a title at creation. With no
  // English anywhere in the source, the English snapshot must stay NULL.
  const src = fs.readFileSync(path.join(SERVER_SRC, 'payroll', 'service.js'), 'utf8');
  assert.match(src, /function tourTitleEn/);
  assert.match(src, /if \(!product && !location\) return null;/);
  // And the general-activity path copies the TYPE's English name or null.
  assert.match(src, /titleEn: type\.nameEn \|\| null/);
});

// ── 8. No hardcoded business translations in the portal renderers ────────────

test('no Guide Portal renderer contains a hardcoded business translation', () => {
  const portalDir = path.join(CLIENT_SRC, 'portal');
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(jsx?|mjs)$/.test(entry.name) && !entry.name.includes('.test.')) files.push(full);
    }
  })(portalDir);

  // The ONE file allowed to hold user-visible wording is the registry, and it
  // is chrome-only by contract (guarded separately by portal/i18n.test.js).
  const REGISTRY = path.join(portalDir, 'i18n.js');
  // Product/city/component names that appear in production. If any of these
  // ever shows up in a renderer, someone patched data in code.
  const BUSINESS_STRINGS = [
    'Graffiti Tour',
    'סיור גרפיטי',
    'Florentin',
    'פלורנטין',
    'Tel Aviv',
    'בר מצווה',
    'סדנת תקליטים',
  ];
  for (const file of files) {
    if (file === REGISTRY) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const s of BUSINESS_STRINGS) {
      assert.ok(
        !src.includes(s),
        `${path.relative(CLIENT_SRC, file)} hardcodes the business value "${s}" — business data belongs in bilingual DB columns`,
      );
    }
  }
});

test('the portal string registry holds no business data', () => {
  const registry = fs.readFileSync(path.join(CLIENT_SRC, 'portal', 'i18n.js'), 'utf8');
  for (const s of ['Graffiti', 'פלורנטין', 'Florentin', 'IBM']) {
    assert.ok(!registry.includes(s), `i18n.js contains business data: "${s}"`);
  }
});

// ── payroll DTO: bilingual line names + activity titles ──────────────────────

function payEntry() {
  return {
    id: 'e1',
    guideStatus: 'pending',
    vatStatusSnapshot: 'exempt',
    vatRateSnapshot: 0,
    lines: [
      // calculatedMinor is what the engine reads (lineFinalMinor); a zero line
      // is hidden from the guide, so the fixture must carry real amounts.
      { componentId: 'c-base', componentNameHe: 'תשלום בסיס', sign: 1, calculatedMinor: 30000, vatMode: 'none', sortOrder: 1 },
      { componentId: 'c-none', componentNameHe: 'נסיעות', sign: 1, calculatedMinor: 5000, vatMode: 'none', sortOrder: 2 },
    ],
  };
}

test('pay: line names come from the LIVE catalog English, activity title from its snapshot', () => {
  const componentById = new Map([
    ['c-base', { id: 'c-base', guideVisible: true, nameEn: 'Base payment' }],
    // No English on this one — the frozen Hebrew stays, honestly.
    ['c-none', { id: 'c-none', guideVisible: true, nameEn: null }],
  ]);
  const activity = { titleHe: 'סיור גרפיטי · פלורנטין', titleEn: 'Graffiti Tour · Florentin', sourceType: 'tour_event', date: '2026-08-01', payrollMonth: '2026-08' };

  const en = guidePayEntryDto(payEntry(), activity, componentById, [], null, 'en');
  assert.equal(en.activityTitle, 'Graffiti Tour · Florentin');
  assert.equal(en.lines[0].name, 'Base payment');
  assert.equal(en.lines[1].name, 'נסיעות'); // no English yet → authored value

  const he = guidePayEntryDto(payEntry(), activity, componentById, [], null, 'he');
  assert.equal(he.activityTitle, 'סיור גרפיטי · פלורנטין');
  assert.equal(he.lines[0].name, 'תשלום בסיס');
  assert.equal(he.lines[1].name, 'נסיעות');
});

test('pay: a frozen Hebrew line snapshot is never rewritten by the English read', () => {
  const entry = payEntry();
  const before = entry.lines.map((l) => l.componentNameHe);
  guidePayEntryDto(
    entry,
    { titleHe: 'x', titleEn: 'x', sourceType: 'general', date: null, payrollMonth: '2026-08' },
    new Map([['c-base', { nameEn: 'Base payment' }]]),
    [],
    null,
    'en',
  );
  assert.deepEqual(entry.lines.map((l) => l.componentNameHe), before);
});

// ── the shared resolver's own contract ───────────────────────────────────────

test('bilingualText: one resolver, one fallback rule, for every shape', () => {
  assert.equal(catalogName({ nameHe: 'א', nameEn: 'A' }, 'en'), 'A');
  assert.equal(catalogTitle({ titleHe: 'א', titleEn: 'A' }, 'en'), 'A');
  assert.equal(pairFrom({ title: 'א', titleEn: 'A' }, 'title', 'titleEn', 'en'), 'A');
  assert.equal(contactFullName({ firstNameHe: 'דור', lastNameHe: 'קורן', firstNameEn: 'Dor', lastNameEn: 'Koren' }, 'en'), 'Dor Koren');
  // …and each falls back the same way when the English side is empty.
  assert.equal(catalogName({ nameHe: 'א', nameEn: '' }, 'en'), 'א');
  assert.equal(catalogTitle({ titleHe: 'א' }, 'en'), 'א');
  assert.equal(pairFrom({ title: 'א' }, 'title', 'titleEn', 'en'), 'א');
  assert.equal(contactFullName({ firstNameHe: 'דור', lastNameHe: 'קורן' }, 'en'), 'דור קורן');
  // Nothing anywhere → empty string, never the word "undefined".
  assert.equal(catalogName(null, 'en'), '');
  assert.equal(catalogName({}, 'en'), '');
});
