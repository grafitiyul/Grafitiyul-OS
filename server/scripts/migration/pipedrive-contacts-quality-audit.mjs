// ONE-TIME, READ-ONLY Pipedrive contact-quality audit (M1b).
//
// 1) Phone-format census over every raw phone value (corruption patterns).
// 2) Duplicate analysis: exact raw dupes, dupes after safe normalization,
//    name/email conflicts on shared phones, shared-number (>2 contacts) risk.
// 3) "New Contact" spam identification + linkage check (exclusion candidates).
// 4) Organizations re-pull with deal counts → prioritized duplicate clusters.
//
// GET only. No writes, no merges. Committed reports use AGGREGATES + masked
// examples; raw PII stays in the gitignored output/ dir.
import { requireEnv, getJson, log, writeOutput, failMissing, sleep } from './lib.mjs';

const SYSTEM = 'pipedrive';
const env = requireEnv(['PIPEDRIVE_API_TOKEN', 'PIPEDRIVE_COMPANY_DOMAIN']);
if (!env.ok) failMissing(env.missing, SYSTEM);

const domain = String(process.env.PIPEDRIVE_COMPANY_DOMAIN).trim().replace(/^https?:\/\//, '').replace(/\.pipedrive\.com.*$/i, '').replace(/\/.*$/, '');
const TOKEN = String(process.env.PIPEDRIVE_API_TOKEN).trim();
const HOST = `https://${domain}.pipedrive.com`;
const ORG_TAXID = '49f67a1342a56c48ed9ef2cb8a07264d4f3b58ac';

function url(pathname, params = {}) {
  const u = new URL(HOST + pathname);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  u.searchParams.set('api_token', TOKEN);
  return u.toString();
}
let lastRate = {};
async function call(pathname, params = {}) {
  const r = await getJson(url(pathname, params), { label: pathname });
  if (r.rate && Object.keys(r.rate).length) lastRate = r.rate;
  await sleep(130);
  return r;
}
async function paginateV1(pathname, params = {}) {
  const rows = []; let start = 0;
  for (;;) {
    const r = await call(pathname, { ...params, start, limit: 500 });
    if (!r.ok) throw new Error(`${pathname} HTTP ${r.status}`);
    rows.push(...(r.json?.data || []));
    const pag = r.json?.additional_data?.pagination;
    if (pag?.more_items_in_collection) start = pag.next_start; else break;
  }
  return rows;
}

// Mask a phone for report examples: keep prefix 4 + last 2 digits.
const mask = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length <= 6) return d.replace(/\d/g, '*');
  return `${d.slice(0, 4)}${'*'.repeat(d.length - 6)}${d.slice(-2)}`;
};

// ── Phone-format classifier (census; raw value → pattern class) ──────────────
function classifyRaw(raw) {
  const v = String(raw || '').trim();
  if (!v) return 'empty';
  const hasSep = /[\s\-().\/]/.test(v);
  const d = v.replace(/[^\d+]/g, '');
  const digits = d.replace(/\D/g, '');
  const cls = [];
  if (hasSep) cls.push('has_separators');
  if (/^\+972972|^972972/.test(digits)) cls.push('duplicated_972_prefix');
  else if (d.startsWith('+9720') || digits.startsWith('9720')) cls.push('prefix_972_then_zero');
  else if (d.startsWith('+972')) cls.push('plus_972');
  else if (digits.startsWith('972')) cls.push('bare_972');
  else if (d.startsWith('+')) cls.push('plus_other_country');
  else if (digits.startsWith('00')) cls.push('double_zero_intl');
  else if (digits.startsWith('0') && (digits.length === 9 || digits.length === 10)) cls.push('leading_zero_il_shape');
  else if (digits.startsWith('0') && digits.length > 10) cls.push('leading_zero_long_suspect_foreign');
  else if (digits.length >= 8 && digits.length <= 15) cls.push('bare_international_shape');
  else if (digits.length > 0 && digits.length < 8) cls.push('too_short');
  else cls.push('other');
  return cls.join('+');
}

// ── Comparison normalizer (proposed rules R1-R8; NEVER stored, compare-only) ──
// Returns { candidate, confidence, rule } — candidate is intl digits, no '+'.
function normalizeForCompare(raw) {
  const v = String(raw || '').trim();
  if (!v) return { candidate: null, confidence: 'none', rule: 'empty' };
  let d = v.replace(/[^\d+]/g, '');
  let digits = d.replace(/\D/g, '');
  // R0: collapse duplicated 972 prefix (972972…, +972972…)
  if (/^972972/.test(digits)) digits = digits.slice(3);
  // R2: 9720XXXXXXXX (or +9720…) — the classic corruption: keep 972, drop the stray 0
  if (/^9720/.test(digits)) {
    const rest = digits.slice(4);
    if (rest.length === 8 || rest.length === 9) return { candidate: `972${rest}`, confidence: 'high', rule: 'R2_9720_strip_zero' };
    return { candidate: null, confidence: 'review', rule: 'R2_9720_bad_length' };
  }
  // R1: +972 / 972 with valid IL national length (8-9 after 972, not starting 0)
  if (/^972/.test(digits)) {
    const rest = digits.slice(3);
    if ((rest.length === 8 || rest.length === 9) && !rest.startsWith('0')) return { candidate: digits, confidence: 'high', rule: 'R1_il_972' };
    return { candidate: null, confidence: 'review', rule: 'R1_972_invalid_length_maybe_foreign' };
  }
  // R4: 00 international prefix → drop 00, take as-is (no country repair)
  if (digits.startsWith('00')) {
    const rest = digits.slice(2);
    if (rest.length >= 8 && rest.length <= 15 && !rest.startsWith('0')) return { candidate: rest, confidence: 'medium', rule: 'R4_double_zero' };
    return { candidate: null, confidence: 'review', rule: 'R4_bad' };
  }
  // R3: Israeli local 0XXXXXXXX(X) (9-10 digits)
  if (digits.startsWith('0') && (digits.length === 9 || digits.length === 10)) {
    return { candidate: `972${digits.slice(1)}`, confidence: 'high', rule: 'R3_il_local' };
  }
  // R7: leading 0 + >10 digits → possibly foreign with '+'→'0'; NEVER auto-repair
  if (digits.startsWith('0') && digits.length > 10) return { candidate: null, confidence: 'review', rule: 'R7_zero_replaced_plus_suspect' };
  // R5: +<other country> valid shape
  if (d.startsWith('+') && digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0')) {
    return { candidate: digits, confidence: 'high', rule: 'R5_plus_foreign' };
  }
  // R6: bare 8-15 digits, not 0/972-leading → international as-is (weaker)
  if (digits.length >= 10 && digits.length <= 15 && !digits.startsWith('0')) return { candidate: digits, confidence: 'medium', rule: 'R6_bare_intl' };
  if (digits.length >= 8 && digits.length < 10) return { candidate: null, confidence: 'review', rule: 'R8_short_no_country' };
  return { candidate: null, confidence: 'none', rule: 'R8_unusable' };
}

const normName = (p) => `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
const NEW_CONTACT_RE = /^new contact\b/i;

async function main() {
  log(`[contacts-quality] audit — host ${domain}.pipedrive.com`);
  const report = { system: SYSTEM, startedAt: new Date().toISOString() };

  log('[contacts-quality] paginating persons…');
  const persons = await paginateV1('/api/v1/persons');
  report.personsTotal = persons.length;

  // ── 1) Phone-format census ──────────────────────────────────────────────────
  const patternCounts = {};
  const ruleCounts = {};
  let phoneValues = 0, personsWithPhone = 0, personsMultiPhone = 0, exactRawDupPairsBase = {};
  const phoneIndex = new Map(); // candidate → [{personId, name, emails, confidence}]
  for (const p of persons) {
    const phones = (p.phone || []).map((x) => x?.value).filter((v) => String(v || '').trim());
    if (phones.length) personsWithPhone++;
    if (phones.length > 1) personsMultiPhone++;
    const emails = (p.email || []).map((x) => String(x?.value || '').toLowerCase().trim()).filter(Boolean);
    for (const raw of phones) {
      phoneValues++;
      const cls = classifyRaw(raw);
      patternCounts[cls] = (patternCounts[cls] || 0) + 1;
      exactRawDupPairsBase[String(raw).trim()] = (exactRawDupPairsBase[String(raw).trim()] || 0) + 1;
      const n = normalizeForCompare(raw);
      ruleCounts[n.rule] = (ruleCounts[n.rule] || 0) + 1;
      if (n.candidate && (n.confidence === 'high' || n.confidence === 'medium')) {
        if (!phoneIndex.has(n.candidate)) phoneIndex.set(n.candidate, []);
        const arr = phoneIndex.get(n.candidate);
        if (!arr.some((e) => e.personId === p.id)) {
          arr.push({ personId: p.id, name: normName(p), rawName: `${p.first_name || ''}|${p.last_name || ''}`, emails, confidence: n.confidence, isNewContact: NEW_CONTACT_RE.test(String(p.first_name || p.name || '')) });
        }
      }
    }
  }
  const exactRawDupValues = Object.values(exactRawDupPairsBase).filter((n) => n > 1);
  report.phoneCensus = {
    phoneValuesTotal: phoneValues,
    personsWithPhone, personsWithoutPhone: persons.length - personsWithPhone, personsMultiPhone,
    patternCounts: Object.fromEntries(Object.entries(patternCounts).sort((a, b) => b[1] - a[1])),
    normalizationRuleCounts: Object.fromEntries(Object.entries(ruleCounts).sort((a, b) => b[1] - a[1])),
    exactRawDuplicateValues: exactRawDupValues.length,
    exactRawDuplicateOccurrences: exactRawDupValues.reduce((n, c) => n + c, 0),
  };

  // ── 2) Duplicate clusters after safe normalization ──────────────────────────
  let clusters2 = 0, clustersGt2 = 0, contactsInClusters = 0, nameConflicts = 0, emailConflicts = 0, emailSupports = 0;
  const examplesHighRisk = [];
  const groups = { safeAuto: 0, strongProbable: 0, ambiguous: 0 };
  for (const [cand, arr] of phoneIndex) {
    const members = arr.filter((m) => !m.isNewContact); // spam excluded from dedup
    if (members.length < 2) continue;
    contactsInClusters += members.length;
    if (members.length === 2) clusters2++; else clustersGt2++;
    const names = new Set(members.map((m) => m.name).filter(Boolean));
    const allEmails = members.map((m) => new Set(m.emails));
    const shareEmail = members.length === 2 && members[0].emails.some((e) => allEmails[1].has(e));
    const bothHaveEmails = members.every((m) => m.emails.length);
    const disjointEmails = bothHaveEmails && !members.some((m, i) => members.some((o, j) => i < j && m.emails.some((e) => new Set(o.emails).has(e))));
    const nameConflict = names.size > 1;
    if (nameConflict) nameConflicts++;
    if (shareEmail) emailSupports++;
    if (disjointEmails && members.length >= 2) emailConflicts++;
    // Confidence grouping (estimate for the census; final grouping runs in M4):
    if (members.length === 2 && (!nameConflict || shareEmail)) groups.safeAuto++;
    else if (members.length === 2 && nameConflict && !disjointEmails) groups.strongProbable++;
    else groups.ambiguous++;
    if ((members.length > 2 || (nameConflict && disjointEmails)) && examplesHighRisk.length < 8) {
      examplesHighRisk.push({
        phoneMasked: mask(cand), contacts: members.length,
        names: [...names].slice(0, 4),
        conflictingEmails: disjointEmails,
      });
    }
  }
  report.duplicateAnalysis = {
    clustersOf2: clusters2, clustersOver2: clustersGt2,
    contactsInvolvedInPhoneClusters: contactsInClusters,
    phoneMatchesWithConflictingNames: nameConflicts,
    phoneMatchesWithConflictingEmails: emailConflicts,
    phoneMatchesWithSupportingSharedEmail: emailSupports,
    sharedNumbersUsedByMoreThan2Contacts: clustersGt2,
    proposedConfidenceGroups: groups,
    highRiskExamples: examplesHighRisk,
  };

  // ── 3) New Contact spam ─────────────────────────────────────────────────────
  const spam = persons.filter((p) => NEW_CONTACT_RE.test(String(p.first_name || '').trim()) || NEW_CONTACT_RE.test(String(p.name || '').trim()));
  const linked = spam.filter((p) => (p.open_deals_count || 0) > 0 || (p.won_deals_count || 0) > 0 || (p.undone_activities_count || 0) > 0);
  const withAnyHistory = spam.filter((p) => (p.closed_deals_count || 0) > 0 || (p.activities_count || 0) > 0 || (p.email_messages_count || 0) > 0);
  // Other placeholder-name candidates: high-frequency identical latin first names.
  const freq = {};
  for (const p of persons) {
    const f = String(p.first_name || '').trim();
    if (f && /^[A-Za-z][A-Za-z .'-]*$/.test(f)) freq[f] = (freq[f] || 0) + 1;
  }
  const placeholderCandidates = Object.entries(freq).filter(([, n]) => n >= 50).sort((a, b) => b[1] - a[1]).slice(0, 12);
  report.newContactSpam = {
    pattern: '^new contact\\b (case-insensitive) on first_name or full name',
    total: spam.length,
    linkedToOpenDeals_wonDeals_orOpenActivities: linked.length,
    withAnyHistoricalActivityOrClosedDeals: withAnyHistory.length,
    exceptionalForReview: linked.slice(0, 10).map((p) => ({
      id: p.id, name: String(p.name || '').slice(0, 40),
      openDeals: p.open_deals_count || 0, wonDeals: p.won_deals_count || 0,
      openActivities: p.undone_activities_count || 0,
    })),
    otherPlaceholderCandidates: placeholderCandidates.map(([name, n]) => ({ name, count: n })),
  };

  // ── 4) Organizations with deal counts → prioritized clusters ────────────────
  log('[contacts-quality] paginating organizations…');
  const orgs = await paginateV1('/api/v1/organizations');
  const normOrg = (n) => String(n || '').toLowerCase()
    .replace(/["'’`.,\-–_()|]/g, ' ')
    .replace(/\b(בע"?מ|בעמ|ltd|inc|llc|co|company|עמותה|בית ספר|ביה"?ס|עיריית|מועצה|חברת)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  const byName = {};
  for (const o of orgs) {
    const nn = normOrg(o.name);
    if (nn) (byName[nn] = byName[nn] || []).push(o);
  }
  const dealsOf = (o) => (o.open_deals_count || 0) + (o.won_deals_count || 0) + (o.lost_deals_count || 0) + (o.closed_deals_count && !o.won_deals_count && !o.lost_deals_count ? o.closed_deals_count : 0);
  const clusters = Object.entries(byName)
    .filter(([, arr]) => arr.length > 1)
    .map(([key, arr]) => ({
      key, size: arr.length,
      totalDeals: arr.reduce((n, o) => n + dealsOf(o), 0),
      members: arr.map((o) => ({
        id: o.id, name: o.name, address: o.address || null,
        deals: dealsOf(o), people: o.people_count || 0,
        hasTaxId: !!String(o[ORG_TAXID] || '').trim(),
      })).sort((a, b) => b.deals - a.deals),
    }))
    .sort((a, b) => b.totalDeals - a.totalDeals);
  report.orgClustersPrioritized = { count: clusters.length, top30: clusters.slice(0, 30) };

  report.rateLimit = lastRate;
  report.finishedAt = new Date().toISOString();
  const out = writeOutput('pipedrive-contacts-quality-audit.json', report);

  log('\n──────── CONTACTS QUALITY ────────');
  log(`persons: ${persons.length} | phone values: ${phoneValues} (with phone: ${personsWithPhone}, multi: ${personsMultiPhone})`);
  log(`patterns: ${JSON.stringify(report.phoneCensus.patternCounts)}`);
  log(`rules: ${JSON.stringify(report.phoneCensus.normalizationRuleCounts)}`);
  log(`exact raw dup values: ${report.phoneCensus.exactRawDuplicateValues} (occurrences ${report.phoneCensus.exactRawDuplicateOccurrences})`);
  log(`clusters: 2=${clusters2} >2=${clustersGt2} contacts=${contactsInClusters} nameConflicts=${nameConflicts} emailConflicts=${emailConflicts} sharedEmailSupport=${emailSupports}`);
  log(`confidence groups: ${JSON.stringify(groups)}`);
  log(`high-risk examples: ${JSON.stringify(examplesHighRisk)}`);
  log(`NEW CONTACT spam: total=${spam.length} linked(open/won/openAct)=${linked.length} anyHistory=${withAnyHistory.length}`);
  log(`placeholder candidates: ${JSON.stringify(report.newContactSpam.otherPlaceholderCandidates)}`);
  log(`org clusters (prioritized): ${clusters.length}; top5: ${clusters.slice(0, 5).map((c) => `${c.key}×${c.size}(${c.totalDeals} deals)`).join(' | ')}`);
  log(`\nfull → ${out}`);
}
main().catch((e) => { log(`[contacts-quality] error: ${e?.message || e}`); process.exit(1); });
