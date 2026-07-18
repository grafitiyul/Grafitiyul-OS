// ENRICHMENT SOURCE AUDIT — read-only over Snapshot #1 (R2 only, zero API calls).
// Field-population census for everything Parts C–H need: notes, activities,
// deal/person/org custom fields (incl. סוג העסק values), Airtable tour fields.
//   railway run --service Grafitiyul-OS node server/scripts/migration/audit-enrichment-sources.mjs
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';

const SNAP = 'snap-20260714T125052Z-aaaa';
const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId: SNAP });
async function stream(key, visit) {
  const man = await reader.entityManifest(key);
  for (const s of man.shards || []) { for (const r of await reader.readShard(s.key)) visit(r); reader._shardCache.clear(); }
}
const pid = (v) => (v && typeof v === 'object' ? v.value : v) ?? null;
const t = (s) => String(s ?? '').trim();

const ref = JSON.parse(await r2.getObjectText(`snapshots/${SNAP}/pipedrive/reference/reference.json`));
const labelOf = (fields) => { const m = new Map(); for (const f of fields || []) m.set(f.key, { name: f.name, type: f.field_type, options: f.options?.map((o) => o.label) }); return m; };
const dealF = labelOf(ref.dealFields), personF = labelOf(ref.personFields), orgF = labelOf(ref.organizationFields);

// ── notes ─────────────────────────────────────────────────────────────────────
let notes = { total: 0, onDeal: 0, onPersonOnly: 0, onOrgOnly: 0, empty: 0, htmlish: 0, maxLen: 0 };
const notesPerDeal = new Map();
await stream('pipedrive/notes', (n) => {
  notes.total++;
  const c = t(n.content);
  if (!c) { notes.empty++; return; }
  if (/<[a-z][^>]*>/i.test(c)) notes.htmlish++;
  notes.maxLen = Math.max(notes.maxLen, c.length);
  if (pid(n.deal_id)) { notes.onDeal++; notesPerDeal.set(pid(n.deal_id), (notesPerDeal.get(pid(n.deal_id)) || 0) + 1); }
  else if (pid(n.person_id)) notes.onPersonOnly++;
  else if (pid(n.org_id)) notes.onOrgOnly++;
});
console.log('NOTES', JSON.stringify(notes));
console.log('  deals with notes:', notesPerDeal.size, '· max per deal:', Math.max(...notesPerDeal.values()));

// ── activities ────────────────────────────────────────────────────────────────
const acts = { total: 0, done: 0, open: 0, onDeal: 0, openOnDeal: 0, byType: {}, withNote: 0, withDue: 0, openFuture: 0, openPast: 0 };
const openByDeal = new Map();
const today = '2026-07-18';
await stream('pipedrive/activities', (a) => {
  acts.total++;
  const done = a.done === true || a.done === 1;
  done ? acts.done++ : acts.open++;
  acts.byType[a.type] = (acts.byType[a.type] || 0) + 1;
  if (t(a.note)) acts.withNote++;
  if (a.due_date) acts.withDue++;
  const dealId = pid(a.deal_id);
  if (dealId) { acts.onDeal++; if (!done) { acts.openOnDeal++; openByDeal.set(dealId, (openByDeal.get(dealId) || 0) + 1); } }
  if (!done && a.due_date) (String(a.due_date) >= today ? acts.openFuture++ : acts.openPast++);
});
const topTypes = Object.entries(acts.byType).sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('ACTIVITIES', JSON.stringify({ ...acts, byType: undefined }));
console.log('  top types:', topTypes.map(([k, v]) => `${k}:${v}`).join(' · '));
console.log('  deals with OPEN activities:', openByDeal.size);

// ── deal custom-field population ─────────────────────────────────────────────
const dealPop = new Map();
let dealCount = 0;
const dealSamples = new Map();
await stream('pipedrive/deals', (d) => {
  dealCount++;
  for (const [k, v] of Object.entries(d)) {
    if (!/^[0-9a-f]{40}$/.test(k)) continue;
    const val = pid(v);
    if (val == null || t(String(val)) === '') continue;
    dealPop.set(k, (dealPop.get(k) || 0) + 1);
    if (!dealSamples.has(k)) dealSamples.set(k, []);
    const s = dealSamples.get(k);
    if (s.length < 3 && !s.includes(String(val).slice(0, 60))) s.push(String(val).slice(0, 60));
  }
});
console.log(`\nDEAL CUSTOM FIELDS (of ${dealCount} deals; populated ≥ 50):`);
for (const [k, n] of [...dealPop.entries()].sort((a, b) => b[1] - a[1])) {
  if (n < 50) continue;
  const f = dealF.get(k);
  console.log(`  ${n}\t${f?.name || k}\t[${f?.type}]\t${k.slice(0, 8)}\te.g. ${JSON.stringify(dealSamples.get(k))}`);
}

// ── person custom fields ──────────────────────────────────────────────────────
const personPop = new Map();
let personCount = 0;
await stream('pipedrive/persons', (p) => {
  personCount++;
  for (const [k, v] of Object.entries(p)) {
    if (!/^[0-9a-f]{40}$/.test(k)) continue;
    const val = pid(v);
    if (val == null || t(String(val)) === '') continue;
    personPop.set(k, (personPop.get(k) || 0) + 1);
  }
});
console.log(`\nPERSON CUSTOM FIELDS (of ${personCount}; ≥ 50):`);
for (const [k, n] of [...personPop.entries()].sort((a, b) => b[1] - a[1])) {
  if (n >= 50) console.log(`  ${n}\t${personF.get(k)?.name || k}\t[${personF.get(k)?.type}]`);
}

// ── org custom fields + סוג העסק values ──────────────────────────────────────
const orgPop = new Map();
const bizTypeValues = new Map();
let orgCount = 0;
let bizKey = null;
for (const [k, f] of orgF) if (f.name === 'סוג העסק') bizKey = k;
await stream('pipedrive/organizations', (o) => {
  orgCount++;
  for (const [k, v] of Object.entries(o)) {
    if (!/^[0-9a-f]{40}$/.test(k)) continue;
    const val = pid(v);
    if (val == null || t(String(val)) === '') continue;
    orgPop.set(k, (orgPop.get(k) || 0) + 1);
    if (k === bizKey) {
      // enum: value is the option id — resolve via reference options
      const f = (ref.organizationFields || []).find((x) => x.key === k);
      const opt = f?.options?.find((op) => String(op.id) === String(val));
      const label = opt?.label || String(val);
      bizTypeValues.set(label, (bizTypeValues.get(label) || 0) + 1);
    }
  }
});
console.log(`\nORG CUSTOM FIELDS (of ${orgCount}; ≥ 20):`);
for (const [k, n] of [...orgPop.entries()].sort((a, b) => b[1] - a[1])) {
  if (n >= 20) console.log(`  ${n}\t${orgF.get(k)?.name || k}\t[${orgF.get(k)?.type}]`);
}
console.log(`\nסוג העסק (key ${bizKey?.slice(0, 8)}…) values:`);
for (const [label, n] of [...bizTypeValues.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${label}`);

// ── Airtable tours: field census ──────────────────────────────────────────────
const tourFieldPop = new Map();
const tourSamples = new Map();
let tourCount = 0;
await stream('airtable/main/tblTI7iaGm6qsQA4a', (r) => {
  tourCount++;
  for (const [k, v] of Object.entries(r.fields || {})) {
    if (v == null || (Array.isArray(v) && !v.length) || t(String(v)) === '') continue;
    tourFieldPop.set(k, (tourFieldPop.get(k) || 0) + 1);
    if (!tourSamples.has(k)) tourSamples.set(k, String(Array.isArray(v) ? v[0] : v).slice(0, 70));
  }
});
console.log(`\nAIRTABLE TOUR FIELDS (of ${tourCount}; ≥ 100):`);
for (const [k, n] of [...tourFieldPop.entries()].sort((a, b) => b[1] - a[1])) {
  if (n >= 100) console.log(`  ${n}\t${k}\te.g. ${JSON.stringify(tourSamples.get(k))}`);
}

// ── Airtable participants (משתתפים) field census ─────────────────────────────
const partPop = new Map();
const partSamples = new Map();
let partCount = 0;
await stream('airtable/main/tbl1JaGS5oKRIkJ9z', (r) => {
  partCount++;
  for (const [k, v] of Object.entries(r.fields || {})) {
    if (v == null || (Array.isArray(v) && !v.length) || t(String(v)) === '') continue;
    partPop.set(k, (partPop.get(k) || 0) + 1);
    if (!partSamples.has(k)) partSamples.set(k, String(Array.isArray(v) ? v[0] : v).slice(0, 70));
  }
});
console.log(`\nAIRTABLE PARTICIPANTS FIELDS (of ${partCount}; ≥ 200):`);
for (const [k, n] of [...partPop.entries()].sort((a, b) => b[1] - a[1])) {
  if (n >= 200) console.log(`  ${n}\t${k}\te.g. ${JSON.stringify(partSamples.get(k))}`);
}
console.log('\naudit complete (read-only).');
