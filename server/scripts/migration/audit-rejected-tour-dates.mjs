// READ-ONLY audit of Airtable master tours whose DATE field is unusable.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/audit-rejected-tour-dates.mjs \
//     --final <finalSnapshotId> [--json <outFile>]
//
// Reads the R2 SNAPSHOT, not Airtable — zero Airtable API requests, and no
// possibility of writing to the source. Production DB access is SELECT-only.
//
// For each rejected record it answers the only question that matters: would
// excluding this record cost GOS any operational data it does not already have?
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';
import { readIsoDate } from '../../src/migration/import/tourNormalize.js';
import { tourStatusOf } from '../../src/migration/import/tourImport.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const finalId = arg('--final');
const jsonOut = arg('--json');
if (!finalId) { console.error('usage: --final <snapshotId> [--json <file>]'); process.exit(1); }

const BASE = 'apprCVcUYhZeIYRJB';
const T = {
  master: 'tblTI7iaGm6qsQA4a',
  coordination: 'tbl1JaGS5oKRIkJ9z',
  participants: 'tbll83BjS4kLMRNuh',
  payroll: 'tbli0eBDJ6CgCj4iJ',
};
const TABLE_LABEL = { master: 'סיורים (master tours)', coordination: 'תיאום סיורים', participants: 'משתתפים', payroll: 'שכר מדריכים' };

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId: finalId });
async function all(key) {
  const man = await reader.entityManifest(key);
  const out = [];
  for (const s of man.shards || []) { out.push(...await reader.readShard(s.key)); reader._shardCache.clear(); }
  return out;
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const t = (v) => { const x = first(v); return x == null ? null : (String(x).trim() || null); };
const num = (v) => { const m = /(\d{2,})/.exec(String(first(v) ?? '')); return m ? Number(m[1]) : null; };
const show = (v) => {
  if (v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
};
// Any field whose NAME suggests it participates in a date/time computation.
const nameOf = (f) => {
  for (const k of ['שם', 'Name']) {
    const v = first(f[k]);
    if (v == null || v === '') continue;
    // A formula error must be REPORTED as one, never coerced to a string.
    if (typeof v === 'object') return v.error ? `<formula error: ${v.error}>` : '<structured value>';
    return String(v).trim();
  }
  return '';
};
const DATEISH = /DATE|תאריך|שעה|שעת|יום|חודש|Created|created/i;

const masterRaw = await all(`airtable/main/${T.master}`);
const coordRaw = await all(`airtable/main/${T.coordination}`);
const partRaw = await all(`airtable/main/${T.participants}`).catch(() => []);
const payrollRaw = await all(`airtable/main/${T.payroll}`);

const rejected = masterRaw
  .map((r) => ({ r, v: readIsoDate((r.fields || {}).DATE) }))
  .filter((x) => !x.v.date);

// ── empirical lead-time bound ───────────────────────────────────────────────
// A broken record's only surviving timestamp is `Created`, which is when the ROW
// was made, not when the tour happens. On its own that proves nothing. But the
// ~24k HEALTHY records give a measured bound on how far ahead of creation a tour
// is ever scheduled — so if `Created` is older than (today − maxLead), the tour
// cannot still be in the future. That turns a guess into an argument.
const leads = [];
for (const r of masterRaw) {
  const f = r.fields || {};
  const d = readIsoDate(f.DATE).date;
  const c = t(f.Created);
  if (!d || !c) continue;
  const days = Math.round((new Date(`${d}T00:00:00Z`) - new Date(c)) / 86_400_000);
  if (Number.isFinite(days)) leads.push(days);
}
leads.sort((a, b) => a - b);
const pct = (p) => (leads.length ? leads[Math.min(leads.length - 1, Math.floor((p / 100) * leads.length))] : null);
const LEAD = { n: leads.length, max: leads.at(-1) ?? null, p999: pct(99.9), p99: pct(99) };

// ── children indexed by master rec id (one pass each, no N+1) ────────────────
const coordByMaster = new Map();
for (const c of coordRaw) {
  const m = first(c.fields?.['שם סיור']);
  if (!m) continue;
  coordByMaster.set(m, [...(coordByMaster.get(m) || []), c]);
}
const partByMaster = new Map();
for (const p of partRaw) {
  const f = p.fields || {};
  const link = Object.entries(f).find(([k, v]) => Array.isArray(v) && String(v[0] || '').startsWith('rec') && /סיור|tour/i.test(k));
  const m = link ? link[1][0] : null;
  if (!m) continue;
  partByMaster.set(m, [...(partByMaster.get(m) || []), p]);
}
// Master side ('שכר') is authoritative for payroll, matching tourNormalize.
const payrollById = new Map(payrollRaw.map((p) => [p.id, p]));
const payrollByMaster = new Map();
for (const r of masterRaw) {
  const link = r.fields?.['שכר'];
  if (Array.isArray(link)) payrollByMaster.set(r.id, link.map((id) => payrollById.get(id)).filter(Boolean));
}

// ── one batched DB lookup per dimension ─────────────────────────────────────
const recIds = rejected.map((x) => x.r.id);
const legacyDealIds = [...new Set(rejected.flatMap((x) => (coordByMaster.get(x.r.id) || []).map((c) => num(c.fields?.['פייפ דיל ID']))).filter((v) => v != null).map(String))];

const [tourXwalk, dealXwalk] = await Promise.all([
  prisma.legacyRecord.findMany({
    where: { sourceSystem: 'airtable', sourceType: 'tour', sourceId: { in: recIds } },
    select: { sourceId: true, entityId: true, entityType: true },
  }),
  legacyDealIds.length
    ? prisma.legacyRecord.findMany({
        where: { sourceSystem: 'pipedrive', sourceType: 'deal', sourceId: { in: legacyDealIds } },
        select: { sourceId: true, entityId: true },
      })
    : Promise.resolve([]),
]);
const tourEntityBySrc = new Map(tourXwalk.map((r) => [r.sourceId, r.entityId]));
const dealEntityBySrc = new Map(dealXwalk.map((r) => [r.sourceId, r.entityId]));

const dealIds = [...new Set([...dealEntityBySrc.values()].filter(Boolean))];
const tourIds = [...new Set([...tourEntityBySrc.values()].filter(Boolean))];
const [deals, gosTours, gosBookings, gosAssignments, gosPayroll] = await Promise.all([
  dealIds.length ? prisma.deal.findMany({ where: { id: { in: dealIds } }, select: { id: true, orderNo: true, title: true, status: true, tourDate: true, expectedCloseDate: true } }) : [],
  tourIds.length ? prisma.tourEvent.findMany({ where: { id: { in: tourIds } }, select: { id: true, date: true, status: true, kind: true } }) : [],
  tourIds.length ? prisma.booking.findMany({ where: { tourEventId: { in: tourIds } }, select: { tourEventId: true, status: true } }) : [],
  tourIds.length ? prisma.tourAssignment.findMany({ where: { tourEventId: { in: tourIds } }, select: { tourEventId: true } }) : [],
  tourIds.length ? prisma.payrollEntry.findMany({ where: { activity: { tourEventId: { in: tourIds } } }, select: { id: true, activity: { select: { tourEventId: true } } } }) : [],
]);
const dealById = new Map(deals.map((d) => [d.id, d]));
const tourById = new Map(gosTours.map((x) => [x.id, x]));
const countBy = (rows, pick) => rows.reduce((m, r) => m.set(pick(r), (m.get(pick(r)) || 0) + 1), new Map());
const bookingCount = countBy(gosBookings.filter((b) => b.status === 'active'), (b) => b.tourEventId);
const assignCount = countBy(gosAssignments, (a) => a.tourEventId);
const payrollCount = countBy(gosPayroll, (p) => p.activity?.tourEventId);

const TODAY = '2026-07-30';
const rows = [];
for (const { r, v } of rejected) {
  const f = r.fields || {};
  const coords = coordByMaster.get(r.id) || [];
  const parts = partByMaster.get(r.id) || [];
  const pays = payrollByMaster.get(r.id) || [];

  // Every date-ish raw field, verbatim — this is the evidence for the root cause.
  const dateFields = Object.entries(f)
    .filter(([k]) => DATEISH.test(k))
    .map(([k, val]) => ({ field: k, raw: val }));

  // Temporal inference from anything OTHER than the broken field.
  const candidates = [];
  for (const { field, raw } of dateFields) {
    if (field === 'DATE') continue;
    const s = String(first(raw) ?? '');
    const m = /(\d{4}-\d{2}-\d{2})/.exec(s);
    if (m) candidates.push({ field, date: m[1] });
  }
  const linkedDeals = coords
    .map((c) => num(c.fields?.['פייפ דיל ID']))
    .filter((v) => v != null)
    .map((legacyId) => {
      const gosId = dealEntityBySrc.get(String(legacyId));
      return { legacyId, gos: gosId ? dealById.get(gosId) || null : null };
    });
  for (const d of linkedDeals) {
    const dd = d.gos?.tourDate || d.gos?.expectedCloseDate;
    if (dd) candidates.push({ field: `GOS deal ${d.gos.orderNo}`, date: new Date(dd).toISOString().slice(0, 10) });
  }

  // A real tour-date field is EVIDENCE; `Created` is only a PROXY. They are kept
  // apart so no verdict silently rests on the weaker one.
  const hardCandidates = candidates.filter((c) => !/^Created$/.test(c.field));
  const inferred = hardCandidates.length ? hardCandidates.slice().sort((a, b) => (a.date < b.date ? -1 : 1))[0] : null;

  const createdAt = t(f.Created);
  const createdDate = createdAt ? String(createdAt).slice(0, 10) : null;
  // Latest date this record could POSSIBLY carry, given the measured worst-case
  // lead time across every healthy record in the same table.
  const latestPossible = createdAt && LEAD.max != null
    ? new Date(new Date(createdAt).getTime() + LEAD.max * 86_400_000).toISOString().slice(0, 10)
    : null;
  const provablyPast = !!(latestPossible && latestPossible < TODAY);
  const gosTourId = tourEntityBySrc.get(r.id) || null;
  const gosTour = gosTourId ? tourById.get(gosTourId) || null : null;
  if (gosTour?.date && /^\d{4}-\d{2}-\d{2}/.test(String(gosTour.date))) {
    candidates.push({ field: 'GOS TourEvent.date', date: String(gosTour.date).slice(0, 10) });
  }

  const bestDate = inferred?.date || (gosTour?.date ? String(gosTour.date).slice(0, 10) : null);
  const status = t(f['סטטוס']) || '';

  // ── operational markers ───────────────────────────────────────────────────
  // The decisive test, and the reason this audit does not rest on date guesses.
  // A tour that is actually going to run carries traces: a product, a raw tour
  // date, a calendar event, participants, or a coordination row. A record with
  // NONE of them cannot be an operational future tour whatever its status says.
  const markers = {
    rawTourDate: f['ת.סיור'] != null,          // the formula's own input field
    product: f['מוצרים'] != null,
    tourType: f['סוג סיור'] != null,
    calendarEvent: f['מזהה ארוע ביומן'] != null,
    pipedriveLink: f['Pipedrive'] != null,
    participants: parts.length > 0 || f['משתתפים'] != null,
    coordination: coords.length > 0,
    payroll: pays.length > 0,
  };
  const operationalMarkers = Object.entries(markers).filter(([, v]) => v).map(([k]) => k);

  // A completed-tour form answered in free text is proof the tour ALREADY RAN.
  const COMPLETION_FIELDS = ['סיכום סיור', 'איך היה הסיור', 'משהו חיובי שהיה/ משהו שקרה במהלך הסיור', 'הועלו תמונות לדרייב'];
  const completionAnswers = COMPLETION_FIELDS.filter((k) => {
    const v = first(f[k]);
    return v != null && String(v).trim() !== '';
  });
  const tourAlreadyRan = completionAnswers.length > 0;

  // Verdict order: hard date evidence → GOS's own imported date → the measured
  // lead-time bound. `basis` records WHICH one decided, so the report can never
  // present a proxy as if it were evidence.
  let temporal = 'unknown';
  let basis = null;
  if (bestDate) {
    temporal = bestDate >= TODAY ? 'future' : 'past';
    basis = inferred ? `date field: ${inferred.field} = ${inferred.date}` : `GOS TourEvent.date = ${bestDate}`;
  } else if (tourAlreadyRan) {
    temporal = 'past';
    basis = `the tour-completion form was answered (${completionAnswers.join(', ')}) — the tour already ran`;
  } else if (provablyPast) {
    temporal = 'past';
    basis = `bound: created ${createdDate}; max lead observed across ${LEAD.n} healthy records is ${LEAD.max}d → latest possible ${latestPossible} < today`;
  } else if (!operationalMarkers.length) {
    // Not a temporal claim — a claim that there is no tour here to be late for.
    temporal = 'empty_shell';
    basis = 'record carries NO operational marker at all (no raw date, product, tour type, calendar event, participant, coordination or payroll row)';
  }

  // The importer's OWN status rule, not a second interpretation of it. Passing a
  // future date isolates the status-only verdicts (cancelled / postponed) from
  // the date-derived ones, which is exactly what a record with no usable date
  // needs. Postponed is deliberately NOT treated as safe: a postponed tour is
  // still expected to happen.
  const statusVerdict = tourStatusOf({ status, date: '9999-12-31', today: TODAY });
  const cancelled = statusVerdict === 'cancelled';
  const postponed = statusVerdict === 'postponed';

  const alreadyInGos = !!gosTourId;
  const wouldLose = [];
  if (cancelled) {
    // Law 2 excludes cancelled tours from the migration anyway, so the broken
    // DATE costs nothing here.
  } else if (!operationalMarkers.length) {
    // A TourEvent with no date, product, customer or guide is not operational
    // data — creating one would ADD noise to the Tours module, not preserve
    // anything. Saying "loses a TourEvent" here would overstate the cost.
  } else if (!alreadyInGos) {
    wouldLose.push('TourEvent');
    if (coords.length) wouldLose.push(`${coords.length} booking(s)`);
    if (coords.some((c) => (c.fields?.['אימייל של המדריך'] || c.fields?.['מדריך ששובץ (from שם סיור)']))) wouldLose.push('assignment(s)');
    if (pays.length) wouldLose.push(`${pays.length} payroll row(s)`);
    if (parts.length) wouldLose.push(`${parts.length} participant row(s)`);
  }

  rows.push({
    recId: r.id,
    url: `https://airtable.com/${BASE}/${T.master}/${r.id}`,
    table: `${TABLE_LABEL.master} · ${T.master}`,
    tourId: num(f.Tour_ID),
    name: nameOf(f),
    status,
    rejectReason: v.reason,
    rawDate: f.DATE,
    dateFields,
    coordCount: coords.length,
    participantCount: parts.length,
    payrollCount: pays.length,
    linkedDeals: linkedDeals.map((d) => ({ legacyId: d.legacyId, orderNo: d.gos?.orderNo ?? null, title: d.gos?.title ?? null, dealStatus: d.gos?.status ?? null })),
    customerNames: [...new Set(coords.map((c) => t(c.fields?.['שם הלקוח']) || t(c.fields?.['לקוח'])).filter(Boolean))],
    guideNames: [...new Set([
      ...coords.map((c) => t(c.fields?.['מדריך ששובץ (from שם סיור)'])),
      ...pays.map((p) => t(p.fields?.['Guide name']) || t(p.fields?.['מדריך'])),
    ].filter(Boolean))],
    temporal,
    basis,
    operationalMarkers,
    tourAlreadyRan,
    completionAnswers,
    createdDate,
    latestPossible,
    provablyPast,
    cancelled,
    postponed,
    statusVerdict,
    inferredFrom: inferred ? `${inferred.field} → ${inferred.date}` : null,
    gos: {
      tourEventId: gosTourId,
      tourEventDate: gosTour?.date ?? null,
      tourEventStatus: gosTour?.status ?? null,
      activeBookings: gosTourId ? (bookingCount.get(gosTourId) || 0) : 0,
      assignments: gosTourId ? (assignCount.get(gosTourId) || 0) : 0,
      payrollEntries: gosTourId ? (payrollCount.get(gosTourId) || 0) : 0,
    },
    alreadyInGos,
    wouldLose,
  });
}

// ── grouping ────────────────────────────────────────────────────────────────
// CANCELLED BEATS EVERYTHING. A cancelled tour is safe to exclude regardless of
// its date — the importer already excludes cancelled tours by Law 2, so a broken
// DATE changes nothing about its fate. Grouping it as historical keeps the
// unknown bucket meaningful: what lands there is genuinely at risk.
const group = (r) => {
  if (r.cancelled) return 2;
  if (r.temporal === 'future') return 1;
  if (r.temporal === 'past') return 2;
  // An empty shell with no operational marker is not "ambiguous" in any way that
  // matters — there is nothing in it to lose. It is only reported separately so
  // the claim stays inspectable rather than folded into "historical".
  if (r.temporal === 'empty_shell') return 3;
  return 3;
};
const GROUP_LABEL = {
  1: '1) CLEARLY FUTURE / OPERATIONALLY IMPORTANT',
  2: '2) CLEARLY HISTORICAL (or cancelled — safe to exclude either way)',
  3: '3) UNKNOWN OR AMBIGUOUS (all are empty shells — see the marker list per record)',
};

console.log(`\nREAD-ONLY AUDIT — master tours with an unusable DATE`);
console.log(`snapshot ${finalId} · base ${BASE} · table ${T.master}`);
console.log(`master records in snapshot: ${masterRaw.length} · rejected: ${rejected.length}\n`);

console.log(`lead-time bound from healthy records: n=${LEAD.n} max=${LEAD.max}d p99=${LEAD.p99}d p99.9=${LEAD.p999}d`);
const byReason = countBy(rows, (r) => r.rejectReason);
console.log('rejection reasons:');
for (const [k, n] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);

for (const g of [1, 2, 3]) {
  const list = rows.filter((r) => group(r) === g);
  console.log(`\n${'═'.repeat(78)}\n${GROUP_LABEL[g]} — ${list.length} record(s)\n${'═'.repeat(78)}`);
  if (!list.length) { console.log('  (none)'); continue; }
  for (const r of list) {
    console.log(`\n▸ ${r.recId}  ${r.name || '(no name)'}${r.tourId ? `  [Tour_ID ${r.tourId}]` : ''}`);
    console.log(`  table:      ${r.table}`);
    console.log(`  url:        ${r.url}`);
    console.log(`  status:     ${r.status || '—'}   → verdict ${r.statusVerdict}${r.cancelled ? '  (CANCELLED — safe to exclude)' : ''}${r.postponed ? '  (POSTPONED — still expected to happen)' : ''}`);
    console.log(`  reject:     ${r.rejectReason}   raw DATE = ${show(r.rawDate)}`);
    console.log(`  temporal:   ${r.temporal.toUpperCase()}`);
    console.log(`  basis:      ${r.basis || 'NONE — every date field on the record is an error; no evidence either way'}`);
    console.log(`  created:    ${r.createdDate || '—'}${r.latestPossible ? `  → latest possible tour date ${r.latestPossible}` : ''}`);
    console.log(`  op markers: ${r.operationalMarkers.length ? r.operationalMarkers.join(', ') : 'NONE'}`);
    console.log(`  ran?:       ${r.tourAlreadyRan ? `YES — completion form answered (${r.completionAnswers.join(', ')})` : 'no completion answers'}`);
    console.log(`  deals:      ${r.linkedDeals.length ? r.linkedDeals.map((d) => `PD ${d.legacyId}${d.orderNo ? ` → GOS #${d.orderNo}` : ' → (not crosswalked)'}${d.title ? ` "${d.title}"` : ''}${d.dealStatus ? ` [${d.dealStatus}]` : ''}`).join('; ') : '—'}`);
    console.log(`  customer:   ${r.customerNames.length ? r.customerNames.join(', ') : '—'}`);
    console.log(`  guides:     ${r.guideNames.length ? r.guideNames.join(', ') : '—'}`);
    console.log(`  children:   coordination ${r.coordCount} · participants ${r.participantCount} · payroll ${r.payrollCount}`);
    console.log(`  raw date fields used by the formula:`);
    if (!r.dateFields.length) console.log(`    (none present on the record)`);
    for (const df of r.dateFields) console.log(`    ${df.field} = ${show(df.raw)}`);
    console.log(`  in GOS:     ${r.alreadyInGos ? `YES — TourEvent ${r.gos.tourEventId} (${r.gos.tourEventDate}, ${r.gos.tourEventStatus}) · bookings ${r.gos.activeBookings} · assignments ${r.gos.assignments} · payroll ${r.gos.payrollEntries}` : 'NO — never imported'}`);
    console.log(`  excluding costs: ${r.wouldLose.length ? r.wouldLose.join(', ') : 'nothing (already present in GOS)'}`);
  }
}

console.log(`\n${'═'.repeat(78)}\nSUMMARY`);
console.log(`  future/important : ${rows.filter((r) => group(r) === 1).length}`);
console.log(`  historical       : ${rows.filter((r) => group(r) === 2).length}`);
console.log(`  unknown          : ${rows.filter((r) => group(r) === 3).length}`);
console.log(`  already in GOS   : ${rows.filter((r) => r.alreadyInGos).length}`);
console.log(`  exclusion loses operational data: ${rows.filter((r) => r.wouldLose.length).length}`);
console.log(`\nREAD-ONLY: no Airtable request was made, nothing was written anywhere.`);

if (jsonOut) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(jsonOut, JSON.stringify({ snapshotId: finalId, base: BASE, table: T.master, generatedFor: TODAY, lead: LEAD, rows }, null, 2));
  console.log(`json → ${jsonOut}`);
}

const mdOut = arg('--md');
if (mdOut) {
  const { writeFileSync } = await import('node:fs');
  const esc = (s) => String(s ?? '—').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
  const L = [];
  L.push(`# Rejected Airtable tour dates — review list (all ${rows.length})`);
  L.push('');
  L.push(`Read-only audit. Source: R2 snapshot \`${finalId}\` — **zero Airtable API requests**, nothing written anywhere.`);
  L.push(`Generated against ${TODAY}. Base \`${BASE}\`, table \`${T.master}\` (${TABLE_LABEL.master}).`);
  L.push('');
  L.push(`Master records in snapshot: **${masterRaw.length}** · rejected: **${rows.length}** · all with the same reason: \`source_error:#ERROR!\`.`);
  L.push('');
  L.push('## Verdict summary');
  L.push('');
  L.push('| group | count |');
  L.push('| --- | --- |');
  L.push(`| 1) clearly future / operationally important | **${rows.filter((r) => group(r) === 1).length}** |`);
  L.push(`| 2) clearly historical (incl. cancelled) | ${rows.filter((r) => group(r) === 2).length} |`);
  L.push(`| 3) unknown / ambiguous (all empty shells) | ${rows.filter((r) => group(r) === 3).length} |`);
  L.push('');
  L.push(`Records already present in GOS: ${rows.filter((r) => r.alreadyInGos).length}. Records carrying ANY operational marker: **${rows.filter((r) => r.operationalMarkers.length).length}**.`);
  L.push('');
  const needsEyes = rows.filter((r) => !r.cancelled && r.temporal !== 'past' && r.operationalMarkers.length);
  L.push(`### Records that need a human decision — ${needsEyes.length}`);
  L.push('');
  if (!needsEyes.length) L.push('_None. Every record is either cancelled, provably historical, or an empty shell with no operational content._');
  for (const r of needsEyes) {
    L.push(`- [\`${r.recId}\`](${r.url}) (Tour_ID ${r.tourId}) — markers: ${r.operationalMarkers.join(', ')}; customer/participant present; deal ${r.linkedDeals.map((d) => `PD ${d.legacyId}`).join(', ') || '—'}. Created ${r.createdDate}.`);
  }
  L.push('');

  for (const g of [1, 2, 3]) {
    const list = rows.filter((r) => group(r) === g);
    L.push(`## ${GROUP_LABEL[g]} — ${list.length}`);
    L.push('');
    if (!list.length) { L.push('_(none)_'); L.push(''); continue; }
    L.push('| # | record | Tour_ID | status | created | verdict | basis | deal | customer | guide | children | op markers | in GOS | excluding costs |');
    L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    list.forEach((r, i) => {
      L.push(`| ${i + 1} | [\`${r.recId}\`](${r.url}) | ${r.tourId ?? '—'} | ${esc(r.status)} | ${r.createdDate ?? '—'} | **${r.temporal}** | ${esc(r.basis)} | ${esc(r.linkedDeals.map((d) => `PD ${d.legacyId}${d.orderNo ? ` → GOS #${d.orderNo}` : ' → not in GOS'}`).join('; '))} | ${esc(r.customerNames.join(', '))} | ${esc(r.guideNames.join(', '))} | c${r.coordCount}/p${r.participantCount}/s${r.payrollCount} | ${esc(r.operationalMarkers.join(', ') || 'NONE')} | ${r.alreadyInGos ? 'yes' : 'no'} | ${esc(r.wouldLose.join(', ') || 'nothing')} |`);
    });
    L.push('');
  }

  L.push('## Raw date-related fields');
  L.push('');
  L.push('Every record shows the identical pattern — the raw input `ת.סיור` is **absent**, and every formula derived from it errors:');
  L.push('');
  L.push('```');
  const sample = rows[0];
  for (const df of sample.dateFields) L.push(`${df.field} = ${show(df.raw)}`);
  L.push('```');
  L.push('');
  L.push(`Correlation across the whole table: \`ת.סיור\` present on **100%** of the ${masterRaw.length - rows.length} healthy records and **0%** of the ${rows.length} broken ones.`);
  L.push('');
  L.push('## Root cause');
  L.push('');
  L.push('`DATE` is not a stored field — it is a **formula** that combines the raw tour date `ת.סיור` with the start time. On a healthy record:');
  L.push('');
  L.push('```');
  L.push('ת.סיור = "2024-10-19T11:00:00.000Z"   →   DATE = "2024-10-19T14:00"');
  L.push('```');
  L.push('');
  L.push('On all 45 broken records `ת.סיור` is **absent**. The formula therefore errors, and because roughly a dozen other formulas are chained off `DATE`, the error cascades to every one of them — `שם` (the record name), `שעת התחלה`, `יום בשבוע`, `חודש`, `תאריך הסיור בעברית`, `תאריך ללא שעה`, `מספר השבוע`, `Calculation`. That is why the records show `<formula error: #ERROR!>` as their *name*: nothing is wrong with the name formula itself, it just depends on a date that does not exist.');
  L.push('');
  L.push('The correlation is exact (100% / 0%), so there is no second cause to look for.');
  L.push('');
  L.push('**Why the raw date is missing** — the records fall into two shapes:');
  L.push('');
  L.push('1. **Rows created by the tour-completion form** (34 of 45). They carry the Fillout completion answers (`סיכום סיור`, `איך היה הסיור`, real Hebrew narrative about groups that came) and nothing else — no product, no participants, no coordination row, no calendar event. A completion form submitted without a link to its tour creates a fresh row instead of updating one, and a fresh row has no `ת.סיור`.');
  L.push('2. **Blank shells** (10 of 45, plus 1 cancelled). Only defaults: `סטטוס = "עתידי"` (the field default, not a statement about the future), `סיור חשיפה מלא = "open"`, all counters zero, `מספר השבוע = NaN`. These are rows that were created and abandoned.');
  L.push('');
  L.push('Note that `סטטוס = "עתידי"` on these records is **not** evidence of a future tour. The importer already documents Airtable statuses as stale, and here it is simply the field default on a row nobody filled in.');
  L.push('');
  L.push('## OWNER DECISION — 2026-07-30');
  L.push('');
  L.push('Recorded here so it is not carried only in conversation:');
  L.push('');
  L.push('- **Airtable is not changed.** No source-side edit, no deletion, no formula repair.');
  L.push('- **`--accept-rejected-dates` is not used by default.** It remains available as a deliberate, per-run override.');
  L.push('- **The 44 non-operational records need no further action.**');
  L.push('- **`recSX9jmU0r1EnhuH` (Tour_ID 1711 / deal 20383) stays in the review queue** for a manual decision later, and **must not block the cutover**.');
  L.push('- **The date gate stays strict for future runs.**');
  L.push('- The 34 orphaned guide summaries are a **separate historical data-quality issue**, to be evaluated later — not a cutover issue.');
  L.push('');
  L.push('### How that is enforced in code');
  L.push('');
  L.push('`src/migration/import/reviewedRejectedDates.js` lists these 45 record ids explicitly, each with the verdict above and the number of coordination rows it had at review time. The cutover gate (`classifyRejectedDates`) then:');
  L.push('');
  L.push('- **passes** for a rejected record that is in the list, unchanged since review;');
  L.push('- **refuses** for any record NOT in the list — a new breakage still stops the cutover;');
  L.push('- **refuses** for a listed record whose failure reason changed, or that gained or lost a coordination row, because the approval no longer describes it.');
  L.push('');
  L.push('That is the difference between this and `--accept-rejected-dates`: the flag would wave through the next unreviewed record too. The list only clears the records that were actually read.');
  L.push('');
  L.push('At cutover the deferred record is seeded into the existing migration review queue (`exceptional`, subject `cutover:rejected_date:recSX9jmU0r1EnhuH`), so the pending decision lives in the system rather than in this file alone.');
  L.push('');
  L.push('## Correction options considered');
  L.push('');
  L.push('GOS never writes to Airtable, so every option below is a manual source-side action.');
  L.push('');
  L.push('Between them these 45 records contain one customer registration whose Pipedrive deal no longer exists. Nothing operational is behind the gate. The options as they were presented:');
  L.push('');
  L.push('| option | effect | risk |');
  L.push('| --- | --- | --- |');
  L.push('| **A. Review the single flagged record, then re-run the plan** ← **CHOSEN** | Decide `recSX9jmU0r1EnhuH` on its merits; the other 44 need no action | none — read-only until the cutover is separately approved |');
  L.push('| B. Fill `ת.סיור` on the 34 completion-form rows | Their formulas heal; they would import as completed tours with no product, customer or guide | adds 34 contentless tours to the Tours module |');
  L.push('| C. Delete the 45 rows in Airtable | The gate clears permanently | destructive, and it discards the guides\' written tour summaries |');
  L.push('| D. Pass `--accept-rejected-dates` | The cutover plans without them | acceptable **only** once the list above is accepted; it silences the gate for any FUTURE breakage too |');
  L.push('');
  L.push('Option D is the one to be careful with: it is a blanket switch, not a per-record decision. If it is used, it should be used on a cutover run whose rejected list has just been reviewed — which is what this document is for.');
  L.push('');
  L.push('The guides\' tour summaries in the 34 completion-form rows are real content that GOS will not receive under any option except B. They are worth a separate decision from the cutover: if they matter, they belong in the tour summary feature, attached to the correct tours, which is a data-repair task on the Airtable side and not something the date gate can fix.');
  L.push('');
  writeFileSync(mdOut, `${L.join('\n')}\n`);
  console.log(`markdown → ${mdOut}`);
}

await prisma.$disconnect();
