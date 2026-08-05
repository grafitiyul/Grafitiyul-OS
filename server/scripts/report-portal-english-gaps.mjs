// Guide Portal — English content-completion worklist.
//
// The portal is STRUCTURALLY complete in English: every static string exists in
// both languages (client/src/portal/i18n.js) and every business field the
// portal renders now has a canonical English column resolved through the ONE
// shared resolver (shared/bilingualText.mjs). What remains is CONTENT ENTRY.
//
// This script produces that worklist, per record — entity, id, the Hebrew value
// an English guide currently sees, the empty English field, the portal screen,
// the operational impact, and the admin URL to fix it. Nothing is fixed by
// code: there is no machine translation anywhere in this path, by design.
//
// Read-only. Run against production:
//   railway run node server/scripts/report-portal-english-gaps.mjs
// or set DATABASE_URL to the prod URL and run the same command.
//
//   --json          machine-readable, per-record
//   --counts        summary only (no per-record rows)
//   --limit=N       cap the rows printed per entity (default 25; 0 = all)

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const countsOnly = argv.includes('--counts');
const limitArg = argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : 25;

const BASE = process.env.GOS_ADMIN_ORIGIN || 'https://app.grafitiyul.co.il';
const blank = (v) => !(typeof v === 'string' && v.trim() !== '');
const short = (v, n = 60) => {
  const t = String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// One entity's worklist. `rows` are the actual records still missing English.
function group(o) {
  return {
    entity: o.entity,
    field: o.field,
    screen: o.screen,
    impact: o.impact,
    adminPath: o.adminPath,
    kind: o.kind, // 'catalog' | 'content' | 'people'
    missing: o.rows.length,
    total: o.total,
    rows: o.rows,
  };
}

async function collect() {
  const out = [];

  // ── Tour identity: the single most visible text in the portal ─────────────
  const products = await prisma.product.findMany({
    where: { active: true },
    select: { id: true, nameHe: true, nameEn: true },
    orderBy: { sortOrder: 'asc' },
  });
  out.push(
    group({
      entity: 'Product',
      field: 'nameEn',
      screen: 'Upcoming tours · Past tours · Tour detail · Gallery · Participants breakdown',
      impact: 'The tour name shows in Hebrew on every card and heading.',
      adminPath: 'Settings → CRM → מוצרים → (the product)',
      kind: 'catalog',
      total: products.length,
      rows: products
        .filter((p) => blank(p.nameEn))
        .map((p) => ({ id: p.id, he: p.nameHe, url: `${BASE}/admin/settings/crm/products/${p.id}` })),
    }),
  );

  const locations = await prisma.location.findMany({
    select: { id: true, nameHe: true, nameEn: true },
    orderBy: { sortOrder: 'asc' },
  });
  out.push(
    group({
      entity: 'Location (city)',
      field: 'nameEn',
      screen: 'Upcoming tours · Past tours · Tour detail · Parallel tours',
      impact: 'The city half of every tour title shows in Hebrew.',
      adminPath: 'Settings → CRM → מיקומים',
      kind: 'catalog',
      total: locations.length,
      rows: locations
        .filter((l) => blank(l.nameEn))
        .map((l) => ({ id: l.id, he: l.nameHe, url: `${BASE}/admin/settings/crm/locations` })),
    }),
  );

  const components = await prisma.activityComponent.findMany({
    where: { isActive: true },
    select: { id: true, nameHe: true, nameEn: true },
    orderBy: { sortOrder: 'asc' },
  });
  out.push(
    group({
      entity: 'ActivityComponent',
      field: 'nameEn',
      screen: 'Tour detail — activity component chips + workshop rows',
      impact: 'Component chips show in Hebrew.',
      adminPath: 'Settings → סיורים → מרכיבי הפעילות ומיקומי הסדנה (card 1)',
      kind: 'catalog',
      total: components.length,
      rows: components
        .filter((c) => blank(c.nameEn))
        .map((c) => ({ id: c.id, he: c.nameHe, url: `${BASE}/admin/settings/tours/components` })),
    }),
  );

  const ticketTypes = await prisma.ticketType.findMany({
    where: { active: true },
    select: { id: true, nameHe: true, nameEn: true },
    orderBy: { sortOrder: 'asc' },
  });
  out.push(
    group({
      entity: 'TicketType',
      field: 'nameEn',
      screen: 'Tour detail — participants breakdown',
      impact: 'Ticket-type rows show in Hebrew.',
      adminPath: 'Settings → CRM → סוגי כרטיסים',
      kind: 'catalog',
      total: ticketTypes.length,
      rows: ticketTypes
        .filter((t) => blank(t.nameEn))
        .map((t) => ({ id: t.id, he: t.nameHe, url: `${BASE}/admin/settings/crm/ticket-types` })),
    }),
  );

  // ── Workshop locations: where the guide goes and how to get in ────────────
  const workshops = await prisma.workshopLocation.findMany({
    where: { isActive: true },
    select: {
      id: true,
      nameHe: true, nameEn: true,
      address: true, addressEn: true,
      instructions: true, instructionsEn: true,
    },
    orderBy: { sortOrder: 'asc' },
  });
  const workshopRows = [];
  for (const w of workshops) {
    const fields = [];
    if (blank(w.nameEn)) fields.push({ field: 'nameEn', he: w.nameHe });
    if (!blank(w.address) && blank(w.addressEn)) fields.push({ field: 'addressEn', he: w.address });
    if (!blank(w.instructions) && blank(w.instructionsEn)) {
      fields.push({ field: 'instructionsEn', he: short(w.instructions) });
    }
    if (fields.length) {
      workshopRows.push({
        id: w.id,
        he: w.nameHe,
        fields,
        url: `${BASE}/admin/settings/tours/components`,
      });
    }
  }
  out.push(
    group({
      entity: 'WorkshopLocation',
      field: 'nameEn / addressEn / instructionsEn',
      screen: 'Tour detail — workshop locations',
      impact:
        'HIGHEST operational risk: this is where the guide is told where to go, the address, and how to get in.',
      adminPath: 'Settings → סיורים → מרכיבי הפעילות ומיקומי הסדנה (card 2)',
      kind: 'catalog',
      total: workshops.length,
      rows: workshopRows,
    }),
  );

  // ── Training content ─────────────────────────────────────────────────────
  const tours = await prisma.tour.findMany({
    where: { active: true },
    select: { id: true, titleHe: true, titleEn: true, descriptionHe: true, descriptionEn: true },
    orderBy: { sortOrder: 'asc' },
  });
  out.push(
    group({
      entity: 'Tour (training set)',
      field: 'titleEn / descriptionEn',
      screen: 'Training content — list + station header',
      impact: 'The training set name shows in Hebrew.',
      adminPath: 'מערכי הדרכה (tour content) → pick the tour / station',
      kind: 'content',
      total: tours.length,
      rows: tours
        .filter((t) => blank(t.titleEn) || (!blank(t.descriptionHe) && blank(t.descriptionEn)))
        .map((t) => ({
          id: t.id,
          he: t.titleHe,
          fields: [
            blank(t.titleEn) ? { field: 'titleEn', he: t.titleHe } : null,
            !blank(t.descriptionHe) && blank(t.descriptionEn)
              ? { field: 'descriptionEn', he: short(t.descriptionHe) }
              : null,
          ].filter(Boolean),
          url: `${BASE}/admin/tour-content/tours/${t.id}`,
        })),
    }),
  );

  const stations = await prisma.tourStation.findMany({
    where: { active: true, tour: { active: true } },
    select: {
      id: true, tourId: true,
      titleHe: true, titleEn: true,
      descriptionHe: true, descriptionEn: true,
    },
    orderBy: { sortOrder: 'asc' },
  });
  out.push(
    group({
      entity: 'TourStation',
      field: 'titleEn / descriptionEn',
      screen: 'Training content — station list + station page',
      impact: 'Station names and summaries show in Hebrew.',
      adminPath: 'מערכי הדרכה (tour content) → pick the tour / station',
      kind: 'content',
      total: stations.length,
      rows: stations
        .filter((s) => blank(s.titleEn) || (!blank(s.descriptionHe) && blank(s.descriptionEn)))
        .map((s) => ({
          id: s.id,
          he: s.titleHe,
          fields: [
            blank(s.titleEn) ? { field: 'titleEn', he: s.titleHe } : null,
            !blank(s.descriptionHe) && blank(s.descriptionEn)
              ? { field: 'descriptionEn', he: short(s.descriptionHe) }
              : null,
          ].filter(Boolean),
          url: `${BASE}/admin/tour-content/tours/${s.tourId}/stations/${s.id}`,
        })),
    }),
  );

  // Only blocks that are actually PLACED in a live station reach a guide.
  const blocks = await prisma.tourContentBlock.findMany({
    where: { active: true, placements: { some: { station: { active: true, tour: { active: true } } } } },
    select: {
      id: true,
      titleHe: true, titleEn: true,
      bodyHe: true, bodyEn: true,
      placements: {
        take: 1,
        select: { stationId: true, station: { select: { tourId: true, titleHe: true } } },
      },
    },
  });
  out.push(
    group({
      entity: 'TourContentBlock (station part)',
      field: 'titleEn / bodyEn',
      screen: 'Training content — station page body',
      impact: 'The teaching content itself shows in Hebrew. Highest VOLUME gap.',
      adminPath: 'מערכי הדרכה (tour content) → pick the tour / station',
      kind: 'content',
      total: blocks.length,
      rows: blocks
        .filter((b) => (!blank(b.titleHe) && blank(b.titleEn)) || (!blank(b.bodyHe) && blank(b.bodyEn)))
        .map((b) => {
          const place = b.placements[0];
          return {
            id: b.id,
            he: b.titleHe || short(b.bodyHe, 40),
            station: place?.station?.titleHe || null,
            fields: [
              !blank(b.titleHe) && blank(b.titleEn) ? { field: 'titleEn', he: b.titleHe } : null,
              !blank(b.bodyHe) && blank(b.bodyEn) ? { field: 'bodyEn', he: short(b.bodyHe) } : null,
            ].filter(Boolean),
            url: place
              ? `${BASE}/admin/tour-content/tours/${place.station.tourId}/stations/${place.stationId}`
              : `${BASE}/admin/tour-content`,
          };
        }),
    }),
  );

  const assets = await prisma.tourBlockAsset.findMany({
    where: { active: true },
    select: { id: true, titleHe: true, titleEn: true, contentBlockId: true },
  });
  out.push(
    group({
      entity: 'TourBlockAsset (media/link)',
      field: 'titleEn',
      screen: 'Training content — media and links',
      impact: 'Media/link captions show in Hebrew.',
      adminPath: 'מערכי הדרכה (tour content) → pick the tour / station',
      kind: 'content',
      total: assets.length,
      rows: assets
        .filter((a) => blank(a.titleEn))
        .map((a) => ({ id: a.id, he: a.titleHe, url: `${BASE}/admin/tour-content` })),
    }),
  );

  // ── Payroll ──────────────────────────────────────────────────────────────
  const payComponents = await prisma.payrollComponent.findMany({
    where: { active: true, guideVisible: true },
    select: { id: true, nameHe: true, nameEn: true },
    orderBy: { sortOrder: 'asc' },
  });
  out.push(
    group({
      entity: 'PayrollComponent',
      field: 'nameEn',
      screen: 'Pay — line names inside each entry',
      impact: 'Payroll line names show in Hebrew. Applies to PAST payslips too (resolved live).',
      adminPath: 'Settings → כספים → רכיבי שכר',
      kind: 'catalog',
      total: payComponents.length,
      rows: payComponents
        .filter((c) => blank(c.nameEn))
        .map((c) => ({ id: c.id, he: c.nameHe, url: `${BASE}/admin/settings/finance/payroll-components` })),
    }),
  );

  const activityTypes = await prisma.generalActivityType.findMany({
    where: { active: true },
    select: {
      id: true, nameHe: true, nameEn: true,
      unitLabelSingularHe: true, unitLabelSingularEn: true,
      unitLabelPluralHe: true, unitLabelPluralEn: true,
    },
    orderBy: { sortOrder: 'asc' },
  });
  out.push(
    group({
      entity: 'GeneralActivityType',
      field: 'nameEn / unitLabelSingularEn / unitLabelPluralEn',
      screen: 'Pay — general-addition entries and their "₪40 per hour × 1.5 hours" breakdown',
      impact: 'Activity names and unit nouns show in Hebrew inside otherwise-English pay cards.',
      adminPath: 'Settings → כספים → סוגי תוספת כללית',
      kind: 'catalog',
      total: activityTypes.length,
      rows: activityTypes
        .filter(
          (t) =>
            blank(t.nameEn) ||
            (!blank(t.unitLabelSingularHe) && blank(t.unitLabelSingularEn)) ||
            (!blank(t.unitLabelPluralHe) && blank(t.unitLabelPluralEn)),
        )
        .map((t) => ({
          id: t.id,
          he: t.nameHe,
          fields: [
            blank(t.nameEn) ? { field: 'nameEn', he: t.nameHe } : null,
            !blank(t.unitLabelSingularHe) && blank(t.unitLabelSingularEn)
              ? { field: 'unitLabelSingularEn', he: t.unitLabelSingularHe }
              : null,
            !blank(t.unitLabelPluralHe) && blank(t.unitLabelPluralEn)
              ? { field: 'unitLabelPluralEn', he: t.unitLabelPluralHe }
              : null,
          ].filter(Boolean),
          url: `${BASE}/admin/settings/finance/activity-types`,
        })),
    }),
  );

  // ── Procedures ───────────────────────────────────────────────────────────
  const flows = await prisma.flow.findMany({
    where: { status: 'published' },
    select: { id: true, title: true, titleEn: true, description: true, descriptionEn: true },
  });
  out.push(
    group({
      entity: 'Flow (procedure)',
      field: 'titleEn / descriptionEn',
      screen: 'Procedures — task cards',
      impact: 'Procedure titles show in Hebrew.',
      adminPath: 'נהלים → (the flow) — English title in the editor header',
      kind: 'content',
      total: flows.length,
      rows: flows
        .filter((f) => blank(f.titleEn) || (!blank(f.description) && blank(f.descriptionEn)))
        .map((f) => ({
          id: f.id,
          he: f.title,
          fields: [
            blank(f.titleEn) ? { field: 'titleEn', he: f.title } : null,
            !blank(f.description) && blank(f.descriptionEn)
              ? { field: 'descriptionEn', he: short(f.description) }
              : null,
          ].filter(Boolean),
          url: `${BASE}/admin/procedures/flows/${f.id}`,
        })),
    }),
  );

  // ── People ───────────────────────────────────────────────────────────────
  const profiles = await prisma.personProfile.findMany({
    select: {
      personRefId: true,
      firstNameHe: true, lastNameHe: true,
      firstNameEn: true, lastNameEn: true,
      personRef: { select: { displayName: true, portalEnabled: true } },
    },
  });
  out.push(
    group({
      entity: 'PersonProfile (staff name)',
      field: 'firstNameEn / lastNameEn',
      screen: 'Portal header (own name) · Profile · Tour detail — team',
      impact: 'Staff names show in Hebrew for an English-reading guide.',
      adminPath: 'אנשים → (the person)',
      kind: 'people',
      total: profiles.length,
      rows: profiles
        .filter((p) => blank(p.firstNameEn) && blank(p.lastNameEn))
        .map((p) => ({
          id: p.personRefId,
          he:
            `${p.firstNameHe || ''} ${p.lastNameHe || ''}`.trim() ||
            p.personRef?.displayName ||
            '(no name)',
          url: `${BASE}/admin/people/${p.personRefId}`,
        })),
    }),
  );

  // Contacts are counted, never listed: 20k rows is not a worklist, and a
  // customer's Latin name is usually already present in the Hebrew fields.
  const contactsTotal = await prisma.contact.count();
  const contactsMissing = await prisma.contact.count({
    where: { AND: [{ firstNameEn: '' }, { lastNameEn: '' }] },
  });

  const questionnaires = await prisma.questionnaireTemplate.findMany({
    where: { status: 'active', purpose: { in: ['tour_summary', 'coordination'] } },
    select: { id: true, internalName: true, purpose: true, supportedLanguages: true },
  });
  out.push(
    group({
      entity: 'QuestionnaireTemplate',
      field: "supportedLanguages missing 'en'",
      screen: 'Tour detail — tour summary form / coordination form',
      impact: "The form opens in the template's default language.",
      adminPath: 'Settings → סיורים',
      kind: 'content',
      total: questionnaires.length,
      rows: questionnaires
        .filter((q) => !(q.supportedLanguages || []).includes('en'))
        .map((q) => ({ id: q.id, he: `${q.purpose}: ${q.internalName}`, url: `${BASE}/admin/settings/tours` })),
    }),
  );

  return { groups: out.filter((g) => g.missing > 0), contacts: { total: contactsTotal, missing: contactsMissing } };
}

async function englishGuides() {
  const rows = await prisma.personRef.findMany({
    where: { portalEnabled: true, status: { not: 'blocked' } },
    select: { displayName: true, profile: { select: { preferredLanguage: true } } },
  });
  const en = rows.filter((r) => r.profile?.preferredLanguage === 'en');
  return { total: rows.length, en: en.length, names: en.map((r) => r.displayName) };
}

async function main() {
  const [{ groups, contacts }, guides] = await Promise.all([collect(), englishGuides()]);

  if (asJson) {
    console.log(JSON.stringify({ guides, contacts, groups }, null, 2));
    return;
  }

  console.log('\nGUIDE PORTAL — ENGLISH CONTENT WORKLIST');
  console.log('======================================');
  console.log(
    `English-language guides with portal access: ${guides.en} of ${guides.total}` +
      (guides.names.length ? ` (${guides.names.join(', ')})` : ''),
  );
  console.log(
    'Every field below HAS an English column and an admin editor. What is missing is content.\n',
  );

  const totalMissing = groups.reduce((n, g) => n + g.missing, 0);
  for (const g of groups.sort((a, b) => a.missing - b.missing)) {
    console.log(`\n■ ${g.entity} · ${g.field}`);
    console.log(`  missing : ${g.missing} of ${g.total} records`);
    console.log(`  screen  : ${g.screen}`);
    console.log(`  impact  : ${g.impact}`);
    console.log(`  fix at  : ${g.adminPath}`);
    if (countsOnly) continue;
    const shown = LIMIT > 0 ? g.rows.slice(0, LIMIT) : g.rows;
    for (const r of shown) {
      const fields = r.fields ? r.fields.map((f) => f.field).join(', ') : g.field;
      console.log(`    - ${r.id}  "${short(r.he, 48)}"${r.station ? ` [${r.station}]` : ''}  → ${fields}`);
      console.log(`      ${r.url}`);
    }
    if (shown.length < g.rows.length) {
      console.log(`    …and ${g.rows.length - shown.length} more (use --limit=0 for all)`);
    }
  }

  console.log(`\n■ Contact (customer names) · firstNameEn / lastNameEn`);
  console.log(`  missing : ${contacts.missing} of ${contacts.total} records`);
  console.log('  screen  : Tour detail — participant cards · Gallery title');
  console.log('  impact  : Customer names show in Hebrew. Low urgency — a Latin name is often');
  console.log('            already stored in the Hebrew fields, and names are personal data.');
  console.log('  fix at  : /admin/crm/contacts (per contact, as they come up)');

  console.log(`\nTOTAL actionable records (excluding contacts): ${totalMissing}`);
  if (!totalMissing) console.log('The Guide Portal is fully populated in English.');
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
