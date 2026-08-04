// Guide Portal — English data-coverage report.
//
// The portal is fully language-aware: every static string exists in both
// languages (client/src/portal/i18n.js) and every field GOS maintains as a
// He/En PAIR is resolved to the reader's language on the server. What this
// script measures is the REMAINDER: business data with no English value, which
// an English-speaking guide therefore sees in Hebrew.
//
// Nothing here is a code bug and nothing is fixed by code — machine translation
// is deliberately not used anywhere in this path. This report is the work list
// for populating translations IN THE DATABASE.
//
// Two kinds of gap are reported separately, because they need different work:
//
//   MISSING VALUE   — the column pair exists, the English side is empty.
//                     Fixable today by filling it in the admin UI.
//   NO ENGLISH FIELD — the entity has no English column at all in the schema.
//                     Needs a schema + admin-UI decision before data can exist.
//
// Read-only. Run against production:
//   railway run node server/scripts/report-portal-english-gaps.mjs
// or set DATABASE_URL to the prod URL and run the same command.
//
//   --json   machine-readable output (for pasting into a tracking doc)

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const asJson = process.argv.includes('--json');

const blank = (v) => !(typeof v === 'string' && v.trim() !== '');

// A gap row: what a guide would see, where, and how many records are affected.
function gap(o) {
  return {
    entity: o.entity,
    field: o.field,
    screens: o.screens,
    impact: o.impact,
    kind: o.kind, // 'missing_value' | 'no_english_field'
    missing: o.missing,
    total: o.total,
    examples: o.examples || [],
  };
}

// ── pairs that EXIST and are simply unfilled ─────────────────────────────────

async function pairGaps() {
  const out = [];

  // Product.nameEn — the single most visible value in the portal: it is half of
  // every tour card title and the tour-detail heading.
  const products = await prisma.product.findMany({
    where: { active: true },
    select: { id: true, nameHe: true, nameEn: true },
    orderBy: { sortOrder: 'asc' },
  });
  const productsMissing = products.filter((p) => blank(p.nameEn));
  out.push(
    gap({
      entity: 'Product',
      field: 'nameEn',
      screens: ['Upcoming tours', 'Past tours', 'Tour detail', 'Tour gallery', 'Participants breakdown'],
      impact: 'The tour name shows in Hebrew on every card and heading.',
      kind: 'missing_value',
      missing: productsMissing.length,
      total: products.length,
      examples: productsMissing.slice(0, 10).map((p) => p.nameHe),
    }),
  );

  // Location.nameEn — the other half of the tour title ("Product · City").
  const locations = await prisma.location.findMany({
    select: { id: true, nameHe: true, nameEn: true },
    orderBy: { sortOrder: 'asc' },
  });
  const locationsMissing = locations.filter((l) => blank(l.nameEn));
  out.push(
    gap({
      entity: 'Location',
      field: 'nameEn',
      screens: ['Upcoming tours', 'Past tours', 'Tour detail', 'Parallel tours'],
      impact: 'The city half of every tour title shows in Hebrew.',
      kind: 'missing_value',
      missing: locationsMissing.length,
      total: locations.length,
      examples: locationsMissing.slice(0, 10).map((l) => l.nameHe),
    }),
  );

  // ActivityComponent.nameEn — the "activity components" chips on tour detail.
  const components = await prisma.activityComponent.findMany({
    where: { isActive: true },
    select: { nameHe: true, nameEn: true },
    orderBy: { sortOrder: 'asc' },
  });
  const componentsMissing = components.filter((c) => blank(c.nameEn));
  out.push(
    gap({
      entity: 'ActivityComponent',
      field: 'nameEn',
      screens: ['Tour detail — activity components', 'Tour detail — workshop locations'],
      impact: 'Component chips show in Hebrew.',
      kind: 'missing_value',
      missing: componentsMissing.length,
      total: components.length,
      examples: componentsMissing.slice(0, 10).map((c) => c.nameHe),
    }),
  );

  // TicketType.nameEn — the ticket lines under each participant card.
  const ticketTypes = await prisma.ticketType.findMany({
    where: { active: true },
    select: { nameHe: true, nameEn: true },
    orderBy: { sortOrder: 'asc' },
  });
  const ticketTypesMissing = ticketTypes.filter((t) => blank(t.nameEn));
  out.push(
    gap({
      entity: 'TicketType',
      field: 'nameEn',
      screens: ['Tour detail — participants breakdown'],
      impact: 'Ticket-type rows show in Hebrew.',
      kind: 'missing_value',
      missing: ticketTypesMissing.length,
      total: ticketTypes.length,
      examples: ticketTypesMissing.slice(0, 10).map((t) => t.nameHe),
    }),
  );

  // PersonProfile English names — the guide's own name in the header, and the
  // names of teammates on the tour-detail team list.
  const profiles = await prisma.personProfile.findMany({
    select: { firstNameEn: true, lastNameEn: true, firstNameHe: true, lastNameHe: true },
  });
  const profilesMissing = profiles.filter((p) => blank(p.firstNameEn) && blank(p.lastNameEn));
  out.push(
    gap({
      entity: 'PersonProfile',
      field: 'firstNameEn / lastNameEn',
      screens: ['Portal header (own name)', 'Profile', 'Tour detail — team'],
      impact: 'Staff names show in Hebrew for an English-reading guide.',
      kind: 'missing_value',
      missing: profilesMissing.length,
      total: profiles.length,
      examples: profilesMissing
        .slice(0, 10)
        .map((p) => `${p.firstNameHe || ''} ${p.lastNameHe || ''}`.trim())
        .filter(Boolean),
    }),
  );

  // Contact English names — the customer names on the participant cards. Note
  // the columns are non-null in the schema, so "missing" means EMPTY STRING.
  const contactsTotal = await prisma.contact.count();
  const contactsMissing = await prisma.contact.count({
    where: { AND: [{ firstNameEn: '' }, { lastNameEn: '' }] },
  });
  out.push(
    gap({
      entity: 'Contact',
      field: 'firstNameEn / lastNameEn',
      screens: ['Tour detail — participant cards', 'Tour gallery title'],
      impact: 'Customer names show in Hebrew.',
      kind: 'missing_value',
      missing: contactsMissing,
      total: contactsTotal,
      examples: [],
    }),
  );

  return out;
}

// ── entities with NO English column anywhere in the schema ───────────────────
//
// These cannot be filled today: the schema has no place to put an English
// value. Each needs an explicit owner decision (add the column + the admin
// field) before any data work can start. Counts show how much content is
// affected, i.e. how much translation work the decision would create.

async function schemaGaps() {
  const out = [];

  const workshopLocations = await prisma.workshopLocation.findMany({
    where: { isActive: true },
    select: { nameHe: true, address: true, instructions: true },
  });
  out.push(
    gap({
      entity: 'WorkshopLocation',
      field: 'nameHe / address / instructions (no *En columns)',
      screens: ['Tour detail — workshop locations'],
      impact:
        'Workshop name, address and access instructions show in Hebrew. Operationally significant: this is where the guide is told where to go and how to get in.',
      kind: 'no_english_field',
      missing: workshopLocations.length,
      total: workshopLocations.length,
      examples: workshopLocations.slice(0, 10).map((w) => w.nameHe),
    }),
  );

  const tours = await prisma.tour.count({ where: { active: true } });
  const stations = await prisma.tourStation.count({ where: { active: true } });
  const blocks = await prisma.tourContentBlock.count();
  out.push(
    gap({
      entity: 'Tour / TourStation / TourContentBlock (training content)',
      field: 'titleHe / descriptionHe / bodyHe (no *En columns)',
      screens: ['Training content list', 'Training station page'],
      impact:
        'The whole training-content domain is single-language: titles, descriptions and the station body render in Hebrew.',
      kind: 'no_english_field',
      missing: tours + stations + blocks,
      total: tours + stations + blocks,
      examples: [`${tours} tours`, `${stations} stations`, `${blocks} content blocks`],
    }),
  );

  const components = await prisma.payrollComponent.count();
  const generalTypes = await prisma.generalActivityType.count();
  out.push(
    gap({
      entity: 'PayrollComponent / GeneralActivityType / PayrollActivity',
      field: 'nameHe / unitLabelSingularHe / unitLabelPluralHe / titleHe (no *En columns)',
      screens: ['Pay'],
      impact:
        'Payroll line names, unit nouns and activity titles render in Hebrew inside otherwise-English pay cards.',
      kind: 'no_english_field',
      missing: components + generalTypes,
      total: components + generalTypes,
      examples: [`${components} payroll components`, `${generalTypes} general-activity types`],
    }),
  );

  const flows = await prisma.flow.count({ where: { status: 'published' } });
  out.push(
    gap({
      entity: 'Flow (procedures)',
      field: 'title / description (no *En columns)',
      screens: ['Procedures'],
      impact:
        'Procedure titles and descriptions render in Hebrew. The procedure RUNTIME (item content) is likewise single-language.',
      kind: 'no_english_field',
      missing: flows,
      total: flows,
      examples: [],
    }),
  );

  return out;
}

// ── questionnaire templates: bilingual by design, per-language completeness ──
//
// The questionnaire engine stores every string as a localized JSON map and the
// portal now opens internal forms in the FILLING GUIDE's language. A template
// that does not declare 'en' in supportedLanguages will fall back to its
// default language for an English guide.

async function questionnaireGaps() {
  const templates = await prisma.questionnaireTemplate.findMany({
    where: { status: 'active', purpose: { in: ['tour_summary', 'coordination'] } },
    select: { key: true, purpose: true, internalName: true, supportedLanguages: true, defaultLanguage: true },
  });
  const missing = templates.filter((t) => !(t.supportedLanguages || []).includes('en'));
  return [
    gap({
      entity: 'QuestionnaireTemplate (tour summary / coordination)',
      field: "supportedLanguages does not include 'en'",
      screens: ['Tour detail — tour summary form', 'Tour detail — coordination form'],
      impact:
        "The form opens in the template's default language. The engine is fully bilingual — this is unfilled content, not a code limit.",
      kind: 'missing_value',
      missing: missing.length,
      total: templates.length,
      examples: missing.map((t) => `${t.purpose}: ${t.internalName}`),
    }),
  ];
}

// ── who this actually affects ────────────────────────────────────────────────

async function englishGuides() {
  const rows = await prisma.personRef.findMany({
    where: { portalEnabled: true, status: { not: 'blocked' } },
    select: { displayName: true, profile: { select: { preferredLanguage: true } } },
  });
  const en = rows.filter((r) => r.profile?.preferredLanguage === 'en');
  return { total: rows.length, en: en.length, names: en.map((r) => r.displayName) };
}

async function main() {
  const [pairs, schema, questionnaires, guides] = await Promise.all([
    pairGaps(),
    schemaGaps(),
    questionnaireGaps(),
    englishGuides(),
  ]);
  const rows = [...pairs, ...questionnaires, ...schema].filter((r) => r.missing > 0);

  if (asJson) {
    console.log(JSON.stringify({ guides, gaps: rows }, null, 2));
    return;
  }

  console.log('\nGUIDE PORTAL — ENGLISH DATA COVERAGE');
  console.log('====================================');
  console.log(
    `English-language guides with portal access: ${guides.en} of ${guides.total}` +
      (guides.names.length ? ` (${guides.names.join(', ')})` : ''),
  );

  for (const kind of ['missing_value', 'no_english_field']) {
    const group = rows.filter((r) => r.kind === kind);
    if (!group.length) continue;
    console.log(
      `\n${kind === 'missing_value' ? 'A. FILLABLE TODAY — the En column exists and is empty' : 'B. NEEDS A SCHEMA DECISION — no English column exists'}`,
    );
    for (const r of group) {
      console.log(`\n  ${r.entity} · ${r.field}`);
      console.log(`    missing : ${r.missing} of ${r.total} records`);
      console.log(`    screens : ${r.screens.join(', ')}`);
      console.log(`    impact  : ${r.impact}`);
      if (r.examples.length) console.log(`    examples: ${r.examples.join(' | ')}`);
    }
  }
  if (!rows.length) console.log('\nNo gaps: every portal-visible field has English content.');
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
