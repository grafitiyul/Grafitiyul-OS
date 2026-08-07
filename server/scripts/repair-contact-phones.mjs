// TASK 2 — one-time production cleanup of the Pipedrive-era ContactPhone damage.
//
// PHONE ARCHITECTURE (audited; NOT changed by this sweep)
//   ContactPhone { value, label, isPrimary, sortOrder } — `value` is the RAW,
//   human-facing string. There is no normalized column and no country column.
//   Canonical identity is DERIVED on every read by normalizePhoneIntl
//   (shared/phone.mjs), which is what WhatsApp matching (buildPhoneIndex /
//   matchContactId) and global search (phoneQuery) both use.
//   → rewriting `value` is safe for matching iff its normalized form is
//     unchanged. That is asserted per row before every Israeli reformat.
//
// WHAT IT DOES (all three are deterministic; everything else is reported only)
//   1. Israeli display canonicalization — a provably Israeli number stored as
//      '+972…' / '972…' / '00972…' is rewritten to the local '05X-XXX-XXXX'
//      form using THE client display formatter, so the stored value and the UI
//      agree. Canonical identity is bit-identical before and after.
//   2. Same-contact duplicates — rows that are the SAME phone after canonical
//      normalization are consolidated to one row. Never by string similarity.
//      Primary status and labels are carried to the survivor.
//   3. Foreign numbers corrupted by a prepended 972 — repaired ONLY when an
//      independent source ON THE SAME CONTACT (a sibling phone row, or the
//      phoneNumber/phoneJid of a linked WhatsApp chat) already holds the real
//      international number. No proof → reported, never written.
//
// WHAT IT NEVER DOES
//   • never infers a country from length, name, organization, email domain or
//     conversation language
//   • never converts a foreign number into an Israeli one
//   • never merges or deletes Contacts, Deals or Chats
//   • never touches a row whose situation is ambiguous
//
// SAFETY: dry run by default (--apply to write); idempotent by construction.
//
// USAGE
//   export DATABASE_URL="$(railway variables --service Postgres --json | jq -r .DATABASE_PUBLIC_URL)"
//   node server/scripts/repair-contact-phones.mjs            # census only
//   node server/scripts/repair-contact-phones.mjs --apply    # write

import { PrismaClient } from '@prisma/client';
import {
  classifyPhoneRow,
  planIsraeliDisplay,
  planDuplicates,
  planForeign972,
  isCountryAuthoritative,
  normalizePhoneIntl,
} from '../src/maintenance/contactPhoneCleanup.js';
import { jidDigits } from '../src/whatsapp/selfIdentity.js';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const EX_FLAG = process.argv.indexOf('--examples');
const MAX_EX = EX_FLAG > -1 ? Number(process.argv[EX_FLAG + 1]) || 8 : 8;

const pad = (s, n) => String(s).padEnd(n);
const head = (t) => console.log(`\n── ${t} ──`);

const [phones, chats] = await Promise.all([
  prisma.contactPhone.findMany({
    select: {
      id: true, contactId: true, value: true, label: true,
      isPrimary: true, sortOrder: true, createdAt: true,
    },
    orderBy: [{ contactId: 'asc' }, { sortOrder: 'asc' }],
  }),
  prisma.whatsAppChat.findMany({
    where: { contactId: { not: null } },
    select: { id: true, contactId: true, phoneNumber: true, phoneJid: true, lidJid: true },
  }),
]);

const contactIds = [...new Set(phones.map((p) => p.contactId))];
const contactRows = await prisma.contact.findMany({
  where: { id: { in: contactIds } },
  select: { id: true, contactNo: true, firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true },
});
const contactById = new Map(contactRows.map((c) => [c.id, c]));
const who = (cid) => {
  const c = contactById.get(cid);
  if (!c) return cid;
  const n = [c.firstNameHe || c.firstNameEn, c.lastNameHe || c.lastNameEn].filter(Boolean).join(' ');
  return `#${c.contactNo ?? '—'} ${n || cid}`;
};

// Group phones by contact.
const byContact = new Map();
for (const p of phones) {
  if (!byContact.has(p.contactId)) byContact.set(p.contactId, []);
  byContact.get(p.contactId).push(p);
}

// COUNTRY-AUTHORITATIVE identities per contact — the only evidence allowed to
// drive a foreign-972 repair. Two sources qualify:
//
//   1. a LINKED WhatsApp chat's phoneNumber / phoneJid — WhatsApp reports true
//      international digits, independently of our import;
//   2. a sibling phone row written with an explicit '+' or '00' prefix — a
//      human or an import declaring the dial code.
//
// Bare digit strings are deliberately EXCLUDED. Production contains US numbers
// in national form ('(650) 814-6172', '7186440498', '9177346364') that, read as
// bare international digits, masquerade as Singapore / Russia / India. Trusting
// them would invent a country — exactly what this sweep must never do.
const proofsByContact = new Map();
const proofSource = new Map(); // `${cid}|${intl}` → 'whatsapp' | 'explicit_intl_sibling'
const addProof = (cid, intl, src) => {
  if (!cid || !intl) return;
  if (!proofsByContact.has(cid)) proofsByContact.set(cid, new Set());
  proofsByContact.get(cid).add(intl);
  if (!proofSource.has(`${cid}|${intl}`)) proofSource.set(`${cid}|${intl}`, src);
};
for (const p of phones) {
  if (!isCountryAuthoritative(p.value)) continue;
  addProof(p.contactId, normalizePhoneIntl(p.value), 'explicit_intl_sibling');
}
for (const ch of chats) {
  addProof(ch.contactId, normalizePhoneIntl(ch.phoneNumber), 'whatsapp');
  addProof(ch.contactId, normalizePhoneIntl(jidDigits(ch.phoneJid)), 'whatsapp');
}

console.log('══════════════════════════════════════════════════════════════');
console.log('  TASK 2 — CONTACT PHONE CLEANUP CENSUS');
console.log('══════════════════════════════════════════════════════════════');
console.log(`mode:              ${APPLY ? 'APPLY (will write)' : 'DRY RUN (nothing written)'}`);
console.log(`ContactPhone rows: ${phones.length}`);
console.log(`Contacts w/ phone: ${byContact.size}`);
console.log(`linked WA chats:   ${chats.length} (independent proof source)`);

// ── A. Shape census ──────────────────────────────────────────────────────────
const kinds = {};
const kindEx = {};
for (const p of phones) {
  const c = classifyPhoneRow(p.value);
  kinds[c.kind] = (kinds[c.kind] || 0) + 1;
  (kindEx[c.kind] ||= []).length < MAX_EX && kindEx[c.kind].push(`${who(p.contactId)}  "${p.value}"`);
}
head('stored-shape census');
for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pad(k, 16)} ${v}`);
}
for (const k of ['bad_972', 'unusable', 'foreign']) {
  if (!kindEx[k]?.length) continue;
  console.log(`\n  examples — ${k}:`);
  for (const e of kindEx[k]) console.log(`    · ${e}`);
}

const multi = [...byContact.values()].filter((r) => r.length > 1);
console.log(`\n  Contacts with 2+ phone rows: ${multi.length}`);

// ═══ THE STAGED PLAN ═════════════════════════════════════════════════════════
// Order matters and is not cosmetic. Repairing a 972-corrupted foreign number
// often reveals a duplicate of a CLEAN sibling the contact already had (e.g.
// #33423 holds both '+16179472597' and '+97216179472597'). Deduping first would
// leave that new duplicate behind, so a second run would still have work to do
// and the sweep would not be idempotent. Hence:
//
//   stage 1  proven foreign-972 repairs   (may create new duplicates)
//   stage 2  same-contact deduplication   (absorbs them)
//   stage 3  Israeli display formatting   (survivors only — no wasted writes)
//
// Every stage plans against the in-memory result of the previous one, so the
// dry-run report predicts the apply exactly.
const work = new Map(); // contactId → mutable row copies
for (const [cid, rows] of byContact) work.set(cid, rows.map((r) => ({ ...r })));

// ── D. STAGE 1 — foreign numbers corrupted by a prepended 972 ────────────────
const proven = [];
const foreignUnknown = [];
const ambiguous = [];
for (const [cid, rows] of work) {
  for (const p of rows) {
    const r = planForeign972(p, proofsByContact.get(cid) || new Set());
    if (r.verdict === 'proven') {
      proven.push({ p: { ...p }, r });
      p.value = r.to; // stage 2 sees the repaired value
    } else if (r.verdict === 'foreign_unknown') foreignUnknown.push({ p, r });
    else if (r.verdict === 'ambiguous') ambiguous.push({ p, r });
  }
}
head('foreign numbers with an erroneous 972 prefix');
console.log(`  A. PROVABLY CORRECTABLE (independent source on the same contact): ${proven.length}`);
console.log(`  B. provably NOT Israeli, true country unknown — REPORT ONLY:      ${foreignUnknown.length}`);
console.log(`  C. fully ambiguous — REPORT ONLY:                                 ${ambiguous.length}`);
for (const [label, rows] of [['A proven', proven], ['B foreign_unknown', foreignUnknown], ['C ambiguous', ambiguous]]) {
  if (!rows.length) continue;
  console.log(`\n  examples — ${label}:`);
  for (const { p, r } of rows.slice(0, MAX_EX)) {
    const src = proofSource.get(`${p.contactId}|${r.candidate}`);
    const arrow = r.to
      ? `→ "${r.to}"  (proof: ${src})`
      : `→ candidate ${r.candidate || 'none'} — NOT written`;
    const sib = (byContact.get(p.contactId) || []).map((x) => `"${x.value}"`).join(' ');
    console.log(`    · ${who(p.contactId)}  "${p.value}"  ${arrow}`);
    console.log(`        all rows on this contact: ${sib}`);
  }
  if (rows.length > MAX_EX) console.log(`    … and ${rows.length - MAX_EX} more`);
}

// ── B. STAGE 2 — same-contact duplicates (post-repair state) ─────────────────
const dupPlans = [];
for (const [cid, rows] of work) {
  const plan = planDuplicates(rows);
  if (!plan.groups.length) continue;
  dupPlans.push({ cid, plan });
  // Apply the consolidation in memory so stage 3 only formats survivors.
  const dropped = new Set(plan.dropIds);
  for (const g of plan.groups) Object.assign(g.survivor, g.patch);
  work.set(cid, rows.filter((r) => !dropped.has(r.id)));
}
const dropTotal = dupPlans.reduce((n, d) => n + d.plan.dropIds.length, 0);
const groupTotal = dupPlans.reduce((n, d) => n + d.plan.groups.length, 0);
const absorbed = dupPlans.reduce(
  (n, d) => n + d.plan.groups.filter((g) => g.drop.some((r) => proven.some((x) => x.p.id === r.id))
    || proven.some((x) => x.p.id === g.survivor.id)).length,
  0,
);
head('same-contact duplicates (canonical identity, not string similarity)');
console.log(`  contacts affected:      ${dupPlans.length}`);
console.log(`  duplicate groups:       ${groupTotal}`);
console.log(`  redundant rows to drop: ${dropTotal}`);
console.log(`  of which groups created by a stage-1 foreign repair: ${absorbed}`);
for (const { cid, plan } of dupPlans.slice(0, MAX_EX)) {
  for (const g of plan.groups) {
    const keep = `"${g.survivor.value}"${g.survivor.isPrimary ? ' [primary]' : ''}`;
    const gone = g.drop.map((r) => `"${r.value}"${r.isPrimary ? ' [primary]' : ''}`).join(', ');
    const inherit = Object.keys(g.patch).length ? `  +inherit ${JSON.stringify(g.patch)}` : '';
    console.log(`    · ${who(cid)}  [${g.intl}]  keep ${keep}  drop ${gone}${inherit}`);
  }
}
if (dupPlans.length > MAX_EX) console.log(`    … and ${dupPlans.length - MAX_EX} more contacts`);

// ── C. STAGE 3 — Israeli display canonicalization (survivors only) ──────────
const reformat = [];
for (const rows of work.values()) {
  for (const p of rows) {
    const plan = planIsraeliDisplay(p);
    if (plan.action === 'reformat') reformat.push({ p, plan });
  }
}
head('Israeli numbers whose STORED value is not the friendly local form');
console.log(`  surviving rows to reformat: ${reformat.length}`);
for (const { p, plan } of reformat.slice(0, MAX_EX)) {
  console.log(`    · ${who(p.contactId)}  "${plan.from}"  →  "${plan.to}"   (identity ${plan.intl} unchanged)`);
}
if (reformat.length > MAX_EX) console.log(`    … and ${reformat.length - MAX_EX} more`);

// ── E. Cross-contact duplicates (CENSUS ONLY — nothing is merged) ────────────
const acrossContacts = new Map();
for (const p of phones) {
  const intl = normalizePhoneIntl(p.value);
  if (!intl) continue;
  if (!acrossContacts.has(intl)) acrossContacts.set(intl, new Set());
  acrossContacts.get(intl).add(p.contactId);
}
const shared = [...acrossContacts.entries()]
  .filter(([, s]) => s.size > 1)
  .sort((a, b) => b[1].size - a[1].size);
head('cross-contact shared numbers (CENSUS ONLY — no Contact is merged)');
console.log(`  distinct numbers on 2+ Contacts: ${shared.length}`);
console.log(`  Contacts involved:               ${new Set(shared.flatMap(([, s]) => [...s])).size}`);
console.log('\n  NOTE: a shared number blocks WhatsApp auto-linking by design —');
console.log('  matchContactId only links when EXACTLY one Contact owns the number.');
for (const [intl, set] of shared.slice(0, MAX_EX)) {
  console.log(`    · ${pad(intl, 16)} ${set.size} contacts: ${[...set].map(who).join(' | ')}`);
}
if (shared.length > MAX_EX) console.log(`    … and ${shared.length - MAX_EX} more`);

// ── APPLY ────────────────────────────────────────────────────────────────────
const stats = { reformatted: 0, dropped: 0, survivorPatched: 0, foreignRepaired: 0 };
if (APPLY) {
  head('applying (same staged order the plan was built in)');
  const dropIds = new Set(dupPlans.flatMap((d) => d.plan.dropIds));

  // STAGE 1 — proven foreign-972 repairs. Skipped for a row that stage 2 is
  // about to delete as a duplicate (the survivor already carries the number).
  for (const { p, r } of proven) {
    if (dropIds.has(p.id)) continue;
    await prisma.contactPhone.update({ where: { id: p.id }, data: { value: r.to } });
    stats.foreignRepaired += 1;
  }
  // STAGE 2 — duplicate consolidation. Survivor metadata is inherited BEFORE
  // the redundant rows go, so nothing useful is lost even if the run is
  // interrupted between the two.
  for (const { plan } of dupPlans) {
    for (const g of plan.groups) {
      if (!Object.keys(g.patch).length) continue;
      await prisma.contactPhone.update({ where: { id: g.survivor.id }, data: g.patch });
      stats.survivorPatched += 1;
    }
  }
  const allDrops = [...dropIds];
  for (let i = 0; i < allDrops.length; i += 500) {
    const chunk = allDrops.slice(i, i + 500);
    const { count } = await prisma.contactPhone.deleteMany({ where: { id: { in: chunk } } });
    stats.dropped += count;
  }
  // STAGE 3 — Israeli display canonicalization on survivors.
  for (const { p, plan } of reformat) {
    if (dropIds.has(p.id)) continue;
    await prisma.contactPhone.update({ where: { id: p.id }, data: { value: plan.to } });
    stats.reformatted += 1;
  }
  console.log(`  foreign repaired:   ${stats.foreignRepaired}`);
  console.log(`  duplicates dropped: ${stats.dropped}`);
  console.log(`  survivors patched:  ${stats.survivorPatched}`);
  console.log(`  reformatted:        ${stats.reformatted}`);

  // ── POST-APPLY VERIFICATION (re-read from the database) ───────────────────
  const after = await prisma.contactPhone.findMany({
    select: { id: true, contactId: true, value: true, isPrimary: true, sortOrder: true, createdAt: true },
  });
  const afterByContact = new Map();
  for (const p of after) {
    if (!afterByContact.has(p.contactId)) afterByContact.set(p.contactId, []);
    afterByContact.get(p.contactId).push(p);
  }

  // 1. no canonical duplicate remains on any one contact
  let dupLeft = 0;
  for (const rows of afterByContact.values()) dupLeft += planDuplicates(rows).dropIds.length;

  // 2. Every Israeli number the planner CAN localize is now local 05… / 0X…
  //    form. Rows still in +972 shape are only acceptable when the round-trip
  //    guard refuses them — production holds placeholder junk like
  //    '+97200000000', whose local rendering ('00-000-0000') does NOT normalize
  //    back to the same identity. Refusing to rewrite those is the guard doing
  //    its job, not a missed repair, so they are counted separately.
  const israeliNotLocal = after.filter((p) => planIsraeliDisplay(p).action === 'reformat');
  const guardRefused = after.filter(
    (p) => classifyPhoneRow(p.value).kind === 'israeli_intl' && planIsraeliDisplay(p).action === 'none',
  );

  // 3. canonical identity preserved — the before/after multiset of identities
  //    may only GAIN the proven foreign repairs and LOSE nothing.
  const idsBefore = new Set(phones.map((p) => normalizePhoneIntl(p.value)).filter(Boolean));
  const idsAfter = new Set(after.map((p) => normalizePhoneIntl(p.value)).filter(Boolean));
  const lost = [...idsBefore].filter((i) => !idsAfter.has(i));
  const gained = [...idsAfter].filter((i) => !idsBefore.has(i));

  // 4. no foreign number became Israeli, no country invented
  const provenSet = new Set(proven.map((x) => x.r.candidate));
  const badGain = gained.filter((g) => !provenSet.has(g));
  const israelified = gained.filter((g) => g.startsWith('972'));

  // 5. primary semantics — at most one primary per contact, and no contact
  //    that HAD a primary lost it
  const hadPrimary = new Set(phones.filter((p) => p.isPrimary).map((p) => p.contactId));
  let multiPrimary = 0;
  const lostPrimary = [];
  for (const [cid, rows] of afterByContact) {
    const n = rows.filter((r) => r.isPrimary).length;
    if (n > 1) multiPrimary += 1;
    if (n === 0 && hadPrimary.has(cid)) lostPrimary.push(cid);
  }

  head('post-apply verification (re-read from DB)');
  console.log(`  rows now:                                  ${after.length} (was ${phones.length})`);
  console.log(`  canonical duplicates left on a contact:    ${dupLeft}          (expect 0)`);
  console.log(`  Israeli rows still awaiting localization:  ${israeliNotLocal.length}          (expect 0)`);
  console.log(`  +972 rows the round-trip guard refused:    ${guardRefused.length}          (placeholder junk — correctly untouched)`);
  for (const p of guardRefused.slice(0, 5)) console.log(`    · "${p.value}" — local form would not normalize back`);
  console.log(`  canonical identities LOST:                 ${lost.length}          (expect 0)`);
  console.log(`  canonical identities gained:               ${gained.length}          (= proven repairs)`);
  console.log(`  gained without proof:                      ${badGain.length}          (expect 0)`);
  console.log(`  foreign numbers turned Israeli:            ${israelified.length}          (expect 0)`);
  console.log(`  contacts with >1 primary phone:            ${multiPrimary}          (expect 0)`);
  console.log(`  contacts that LOST their primary phone:    ${lostPrimary.length}          (expect 0)`);
  for (const i of lost.slice(0, 10)) console.log(`    ✗ lost identity ${i}`);
  for (const i of badGain.slice(0, 10)) console.log(`    ✗ unproven new identity ${i}`);

  // 6. WhatsApp linkage — every currently-linked chat must still resolve to the
  //    SAME contact through the canonical phone index.
  const { buildPhoneIndex, matchContactId } = await import('../src/whatsapp/phone.js');
  const index = buildPhoneIndex(after);
  let waStillLinked = 0;
  let waChanged = 0;
  for (const ch of chats) {
    const intl = normalizePhoneIntl(ch.phoneNumber) || normalizePhoneIntl(jidDigits(ch.phoneJid));
    if (!intl) continue;
    const m = matchContactId(intl, index);
    if (m === ch.contactId) waStillLinked += 1;
    else if (m && m !== ch.contactId) waChanged += 1;
  }
  console.log(`  WA chats still resolving to their contact: ${waStillLinked}`);
  console.log(`  WA chats now resolving ELSEWHERE:          ${waChanged}          (expect 0)`);
}

console.log('\n─── summary ───');
console.log(`mode:                       ${APPLY ? 'APPLY' : 'DRY RUN'}`);
console.log(`rows scanned:               ${phones.length}`);
console.log(`proven foreign repairs:     ${proven.length}   applied: ${stats.foreignRepaired}`);
console.log(`duplicate rows planned:     ${dropTotal}   applied: ${stats.dropped}`);
console.log(`Israeli reformat planned:   ${reformat.length}   applied: ${stats.reformatted}`);
console.log(`AMBIGUOUS QUEUE (untouched): ${foreignUnknown.length} foreign-unknown + ${ambiguous.length} ambiguous + ${kinds.unusable || 0} unusable`);
console.log(`cross-contact shared numbers (census only): ${shared.length}`);
if (!APPLY) console.log('\nRe-run with --apply to write these repairs.');

await prisma.$disconnect();
