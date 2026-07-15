// Contacts review — duplicate-cluster proposals from Snapshot #1.
//
// PURE functions; the bounded pass streams the snapshot once and calls these.
//
// Workload rule: the queue contains CLUSTERS, never the 32,475 contacts. A contact
// with no duplicate is not a decision — it simply migrates.
//
// ── THE CORROBORATION PRINCIPLE ────────────────────────────────────────────────
// A cluster's KEY can never be its own evidence. This is not a style preference;
// violating it is what produced every measured false positive. The old rule read
// `!nameConflict || shareEmail → safe`, and for an EMAIL cluster `shareEmail` is
// true BY CONSTRUCTION (it IS the key) — so every email cluster was SAFE and
// batch-approvable regardless of the evidence. Two unrelated people who happened to
// share one free-mail address were one batch-approve away from being merged.
// So: a phone cluster must be confirmed by name/email/org; an email cluster must be
// confirmed by name/phone/org. And no other signal may disagree.
//
// SAFE means exactly one thing, per the owner: "I would personally merge these
// records without asking." Everything else is REVIEW. Measured precision of the
// promotion rules is ~99-100% (audit of 2026-07-15).
import { normalizeForCompare, isComparable, isNewContactName } from '../phoneCompare.js';
import { sectionFor, sectionRank, isImportable } from './contactSections.js';

export const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
export const personName = (p) => norm(`${p.firstName || ''} ${p.lastName || ''}`);
// The name we actually compare on: structured first+last, else the raw name field.
// A record with neither is `missing` — never "identical to" another blank.
export const fullName = (p) => personName(p) || norm(p.name);

const CONF_RANK = { safe: 4, probable: 3, ambiguous: 2, shared: 1 };

// Build phone → members index using ONLY trustworthy candidates.
export function buildPhoneClusters(contacts) {
  const idx = new Map();
  const ruleCounts = {};
  for (const c of contacts) {
    for (const raw of c.phones || []) {
      const n = normalizeForCompare(raw);
      ruleCounts[n.rule] = (ruleCounts[n.rule] || 0) + 1;
      if (!isComparable(n)) continue;
      if (!idx.has(n.candidate)) idx.set(n.candidate, []);
      const arr = idx.get(n.candidate);
      if (!arr.some((m) => m.legacyId === c.legacyId)) arr.push({ ...c, matchedOn: n.candidate, matchRule: n.rule });
    }
  }
  return { index: idx, ruleCounts };
}

// ── name comparison ───────────────────────────────────────────────────────────
const tokens = (s) => new Set(String(s).split(' ').filter((t) => t.length > 1));
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const HEBREW = /[֐-׿]/, LATIN = /[A-Za-z]/;
const scriptOf = (s) => (HEBREW.test(s) && LATIN.test(s) ? 'mixed' : HEBREW.test(s) ? 'he' : LATIN.test(s) ? 'lat' : 'other');

// How two names relate. Deliberately conservative: anything we cannot explain as
// the SAME name written twice is `different`.
export function nameClass(a, b) {
  const na = fullName(a), nb = fullName(b);
  if (!na || !nb) return 'missing';
  // An email address or a company in the name field is not a person's name, so it
  // cannot testify that two people are one person.
  if (na.includes('@') || nb.includes('@')) return 'not-a-name';
  if (na === nb) return 'identical';
  // Transliteration (Hebrew vs Latin) is unverifiable here and the measured bucket
  // was polluted with company names — never auto-merged.
  if (scriptOf(na) !== scriptOf(nb)) return 'cross-script';
  const ta = tokens(na), tb = tokens(nb);
  // Guard the empty set: `[].every(...)` is vacuously TRUE, so two names built only
  // of one-letter tokens ("א" vs "ב") would otherwise read as a subset — and merge.
  if (ta.size && tb.size && ([...ta].every((t) => tb.has(t)) || [...tb].every((t) => ta.has(t)))) {
    // A subset is a NAME COMPLETION only when at most one token is added
    // (first-name → first+surname, or an inserted middle name). Longer tails are
    // usually not a name at all: measured cases include an organisation typed into
    // the name field, and a couple ("<name> and <name> <surname>") in one record.
    // Those must stay in REVIEW.
    return Math.abs(ta.size - tb.size) <= 1 ? 'subset' : 'subset-long';
  }
  if (editDistance(na, nb) <= 2 && Math.min(na.length, nb.length) >= 6) return 'near';
  return [...ta].some((t) => tb.has(t)) ? 'overlap' : 'different';
}

// ── independent signals ───────────────────────────────────────────────────────
const phoneSet = (m) => new Set((m.phones || []).map((p) => normalizeForCompare(p)).filter(isComparable).map((n) => n.candidate));
function phoneRelation(members) {
  const sets = members.map(phoneSet);
  if (sets.some((s) => !s.size)) return 'missing';
  const shared = sets.some((s, i) => sets.some((o, j) => i < j && [...s].some((v) => o.has(v))));
  return shared ? 'same' : 'different';
}
function orgRelation(members) {
  const ids = members.map((m) => m.orgId ?? null);
  if (ids.some((v) => v == null)) return 'missing';
  return ids.every((v) => v === ids[0]) ? 'same' : 'different';
}

// Free-mail and role mailboxes are shared by construction — an address at one of
// these can belong to a household, a secretary, or an office, so it is never
// treated as proof of one identity.
const FREE_MAIL = /^(gmail|walla|hotmail|outlook|yahoo|icloud|live|msn|aol|zahav|bezeqint|012|013|netvision|nana)\./i;
const ROLE_LOCAL = /^(info|office|mail|admin|contact|sales|support|service|hr|jobs|team|bookings?|reservations?|no-?reply|marketing|finance|accounts?)$/i;
const domainOf = (e) => (/@([^\s@]+)$/.exec(String(e || '')) || [])[1]?.toLowerCase() || '';
const localOf = (e) => String(e || '').split('@')[0]?.toLowerCase() || '';
// A personal mailbox at a real (non-free) domain — the only email key strong
// enough to carry a merge on its own.
export const isPersonalCorporateEmail = (address) => !!address && !FREE_MAIL.test(domainOf(address)) && !ROLE_LOCAL.test(localOf(address));

// The audit's grouping, with `shared` (>2 on one key) split out because it needs a
// different human judgement.
export function classifyCluster(members, clusterKind = 'phone') {
  const allNames = members.map((m) => fullName(m));
  const names = new Set(allNames.filter(Boolean));
  const emailSets = members.map((m) => new Set((m.emails || []).map((e) => norm(e))));
  const shareEmail = members.length === 2 && [...emailSets[0]].some((e) => emailSets[1].has(e));
  const bothHaveEmails = members.every((m) => (m.emails || []).length);
  const disjointEmails = bothHaveEmails && !members.some((m, i) =>
    members.some((o, j) => i < j && [...emailSets[i]].some((e) => emailSets[j].has(e))));
  // A blank name is a conflict, not a match: a record with no name can never be
  // "the same name" as another. (A Set dedupes, so counting it is not enough.)
  const nameConflict = names.size > 1 || allNames.some((n) => !n);
  const phoneRel = phoneRelation(members);
  const orgRel = orgRelation(members);

  let confidence;
  if (members.length > 2) confidence = 'shared';
  else if (!nameConflict) confidence = 'safe';
  // `shareEmail` is INDEPENDENT evidence for a phone cluster, but for an email
  // cluster it IS the key and proves nothing. See the corroboration principle.
  else if (clusterKind === 'phone' && shareEmail) confidence = 'safe';
  else if (!disjointEmails) confidence = 'probable';
  else confidence = 'ambiguous';

  return { confidence, nameConflict, shareEmail, disjointEmails, phoneRel, orgRel, names: [...names] };
}

// SAFE = "I would personally merge these without asking the owner."
//
// Requires (1) a confirming signal INDEPENDENT of the cluster key, and (2) that no
// other signal disagrees. Returns the reason so the UI can state why, or null.
export function safeMergeReason({ members, clusterKind, clusterKey, cls }) {
  if (members.length > 2) return null; // a key shared by >2 is an office/role, never one person
  const nc = nameClass(members[0], members[1]);
  // "Nothing else disagrees": a different organisation or wholly disjoint email
  // sets veto every promotion rule below.
  const noDissent = cls.orgRel !== 'different' && !cls.disjointEmails;
  const someTokenShared = (() => {
    const ta = tokens(fullName(members[0])), tb = tokens(fullName(members[1]));
    return [...ta].some((t) => tb.has(t));
  })();

  if (clusterKind === 'phone') {
    if (nc === 'identical') return 'אותו טלפון ואותו שם בדיוק.';
    if (cls.shareEmail && someTokenShared) return 'אותו טלפון וגם אותה כתובת אימייל — שתי ראיות בלתי תלויות.';
    if (noDissent && nc === 'near') return 'אותו טלפון, והשם נבדל בתו אחד או שניים — שגיאת הקלדה.';
    if (noDissent && nc === 'subset') return 'אותו טלפון, ורשומה אחת מכילה את השם המלא של השנייה.';
    return null;
  }
  // Email cluster: the shared address is the KEY, so it cannot confirm itself.
  if (nc === 'identical' && cls.phoneRel !== 'different') return 'אותה כתובת אימייל ואותו שם, ללא טלפון סותר.';
  if (isPersonalCorporateEmail(clusterKey) && noDissent) {
    if (nc === 'identical') return 'תיבת אימייל אישית בארגון ואותו שם בדיוק.';
    if (nc === 'near') return 'תיבת אימייל אישית בארגון, והשם נבדל בתו אחד או שניים.';
    if (nc === 'subset') return 'תיבת אימייל אישית בארגון, ורשומה אחת מכילה את השם המלא של השנייה.';
  }
  return null;
}

// The record to KEEP: most deals → most complete → oldest id (deterministic).
const completeness = (m) => (m.emails?.length ? 2 : 0) + (m.phones?.length ? 1 : 0) + (m.firstName ? 1 : 0) + (m.lastName ? 1 : 0) + (m.orgName ? 1 : 0);
export function pickPrimary(members) {
  return [...members].sort(
    (a, b) => (b.dealCount || 0) - (a.dealCount || 0) || completeness(b) - completeness(a) || a.legacyId - b.legacyId,
  )[0];
}

function reasonFor(cls, members, clusterKind, safeReason) {
  if (safeReason) return safeReason;
  const key = clusterKind === 'phone' ? 'מספר טלפון' : 'כתובת אימייל';
  if (members.length > 2) {
    return `אותה ${key} משותפת ל-${members.length} אנשי קשר — כנראה מספר משרד/תיבה משותפת ולא אותו אדם. לעולם לא מאוחד אוטומטית.`;
  }
  const nc = nameClass(members[0], members[1]);
  if (nc === 'missing') return `אותה ${key}, אבל לפחות לרשומה אחת אין שם — אי אפשר לאשר איחוד בלי שם.`;
  if (nc === 'not-a-name') return `אותה ${key}, אבל בשדה השם מופיעה כתובת אימייל או שם חברה ולא שם של אדם.`;
  if (nc === 'cross-script') return `אותה ${key}, אבל שם אחד בעברית והשני באנגלית — תעתיק לא ניתן לאימות, נדרשת הכרעה.`;
  if (nc === 'subset-long') return `אותה ${key}, ורשומה אחת מכילה את השם של השנייה בתוספת מילים רבות — ייתכן שזה ארגון או זוג ולא אותו אדם.`;
  if (cls.disjointEmails) return `אותה ${key}, אבל גם השם שונה וגם כתובות האימייל שונות לגמרי — ייתכן שאלה שני אנשים שונים.`;
  if (cls.orgRel === 'different') return `אותה ${key}, אבל הרשומות שייכות לארגונים שונים — ייתכן ששני עמיתים חולקים קו משרדי.`;
  return `אותה ${key}, אבל השם שונה. אין ראיה בלתי תלויה שמאשרת שזה אותו אדם — נדרשת הכרעה.`;
}

function buildCluster({ clusterKind, clusterKey, members, today }) {
  const cls = classifyCluster(members, clusterKind);
  const safeReason = safeMergeReason({ members, clusterKind, clusterKey, cls });
  const primary = pickPrimary(members);

  const totals = members.reduce(
    (a, m) => ({
      deals: a.deals + (m.dealCount || 0),
      activeDeals: a.activeDeals + (m.activeDealCount || 0),
      futureTourDeals: a.futureTourDeals + (m.futureTourDeals || 0),
      openDeals: a.openDeals + (m.openDealCount || 0),
      wonRecentDeals: a.wonRecentDeals + (m.wonRecentDealCount || 0),
    }),
    { deals: 0, activeDeals: 0, futureTourDeals: 0, openDeals: 0, wonRecentDeals: 0 },
  );

  const exact = [];
  const inferred = [];
  const conflicts = [];
  // The cluster key is stated as what it is — the reason these records met — and is
  // NEVER also listed as corroborating evidence. (See the corroboration principle.)
  if (clusterKind === 'phone') exact.push(`אותו מספר טלפון (${members[0].matchedOn})`);
  if (clusterKind === 'email') exact.push('אותה כתובת אימייל');
  if (clusterKind === 'phone' && cls.shareEmail) exact.push('כתובת אימייל משותפת (ראיה בלתי תלויה)');
  if (clusterKind === 'email' && cls.phoneRel === 'same') exact.push('אותו מספר טלפון (ראיה בלתי תלויה)');
  if (!cls.nameConflict) exact.push('שם זהה');
  if (cls.nameConflict) conflicts.push(`שמות שונים: ${cls.names.join(' · ') || '(ללא שם)'}`);
  if (cls.disjointEmails) conflicts.push('אין אף כתובת אימייל משותפת');
  if (clusterKind === 'email' && cls.phoneRel === 'different') conflicts.push('מספרי הטלפון שונים לגמרי');
  if (members.length > 2) conflicts.push(`${members.length} אנשי קשר על אותו ${clusterKind === 'phone' ? 'מספר' : 'אימייל'}`);
  const orgNames = [...new Set(members.map((m) => m.orgName).filter(Boolean))];
  if (cls.orgRel === 'same' && orgNames.length === 1) inferred.push(`אותו ארגון: ${orgNames[0]}`);
  if (cls.orgRel === 'different') conflicts.push(`ארגונים שונים: ${orgNames.join(' · ')}`);

  const missing = [];
  if (!members.some((m) => (m.emails || []).length)) missing.push('אימייל');
  if (!members.some((m) => m.orgName)) missing.push('ארגון מקושר');

  const batchApprovable = !!safeReason;
  const section = sectionFor({ members, batchApprovable });
  const importableCount = members.filter(isImportable).length;

  return {
    kind: 'contact_cluster',
    clusterKind,
    clusterKey,
    confidence: cls.confidence,
    reason: reasonFor(cls, members, clusterKind, safeReason),
    members: members.map((m) => ({
      legacyId: m.legacyId,
      name: `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.name || '(ללא שם)',
      firstName: m.firstName || null,
      lastName: m.lastName || null,
      // RAW values, exactly as typed in the legacy system — never normalised.
      phones: m.phones || [],
      emails: m.emails || [],
      orgName: m.orgName || null,
      orgId: m.orgId || null,
      dealCount: m.dealCount || 0,
      activeDealCount: m.activeDealCount || 0,
      futureTourDeals: m.futureTourDeals || 0,
      openDealCount: m.openDealCount || 0,
      wonRecentDealCount: m.wonRecentDealCount || 0,
      activityCount: m.activityCount || 0,
      noteCount: m.noteCount || 0,
      fileCount: m.fileCount || 0,
      // Empty shells are archived, never created in GOS — so they can never
      // duplicate anything and never cost the owner a decision.
      importable: isImportable(m),
      operationallyActive: (m.activeDealCount || 0) > 0 || (m.futureTourDeals || 0) > 0,
      addTime: m.addTime || null,
      matchRule: m.matchRule || null,
      source: { entity: 'pipedrive/persons', id: m.legacyId },
    })),
    proposedPrimaryLegacyId: primary.legacyId,
    // ONLY a batch-approvable (SAFE) cluster proposes a merge. Everything else
    // proposes SEPARATE — an unreviewed cluster must never carry a latent merge an
    // importer could apply by accident, and the review form must not pre-tick the
    // riskier option on the owner's behalf. Never merge without an explicit human.
    proposedMergeLegacyIds: batchApprovable ? members.filter((m) => m.legacyId !== primary.legacyId).map((m) => m.legacyId) : [],
    proposedSeparateLegacyIds: batchApprovable ? [] : members.filter((m) => m.legacyId !== primary.legacyId).map((m) => m.legacyId),
    evidence: { exact, inferred, conflicts, missing },
    totals,
    operationallyActive: totals.activeDeals > 0 || totals.futureTourDeals > 0,
    batchApprovable,
    // Business-impact routing — precomputed once here so the queue never re-derives it.
    section,
    importableCount,
    decisionRequired: importableCount >= 2 && !batchApprovable,
  };
}

// Section (business impact) → Tier-2 impact → deals → cluster size → confidence.
export function compareContactProposals(a, b) {
  const impact = (p) => p.totals.activeDeals + p.totals.futureTourDeals;
  return (
    sectionRank(a.section) - sectionRank(b.section) ||
    impact(b) - impact(a) ||
    b.totals.deals - a.totals.deals ||
    b.members.length - a.members.length ||
    CONF_RANK[a.confidence] - CONF_RANK[b.confidence] || // riskiest first among equals
    String(a.clusterKey).localeCompare(String(b.clusterKey))
  );
}

export function buildContactProposals({ contacts, today }) {
  // Auto-generated junk is excluded from dedup AND from Contact creation.
  const spam = contacts.filter((c) => isNewContactName(`${c.firstName || ''} ${c.name || ''}`));
  const spamIds = new Set(spam.map((c) => c.legacyId));
  const real = contacts.filter((c) => !spamIds.has(c.legacyId));

  const { index, ruleCounts } = buildPhoneClusters(real);
  const proposals = [];
  const claimed = new Set();
  for (const [candidate, members] of index) {
    if (members.length < 2) continue;
    proposals.push(buildCluster({ clusterKind: 'phone', clusterKey: candidate, members, today }));
    for (const m of members) claimed.add(m.legacyId);
  }

  // Exact-email clusters add duplicates that share no phone at all.
  const byEmail = new Map();
  for (const c of real) {
    for (const e of c.emails || []) {
      const k = norm(e);
      if (!k) continue;
      if (!byEmail.has(k)) byEmail.set(k, []);
      const arr = byEmail.get(k);
      if (!arr.some((m) => m.legacyId === c.legacyId)) arr.push(c);
    }
  }
  let roleEmailSkipped = 0;
  for (const [email, members] of byEmail) {
    if (members.length < 2) continue;
    // An address shared by MORE than two contacts is a role/shared mailbox
    // (info@, office@…), not evidence that those people are the same person —
    // exactly as a phone shared by >2 is never treated as a duplicate. Proposing
    // these would only spend the owner's attention for nothing.
    if (members.length > 2) { roleEmailSkipped++; continue; }
    if (members.every((m) => claimed.has(m.legacyId))) continue; // already proposed via phone
    proposals.push(buildCluster({ clusterKind: 'email', clusterKey: email, members, today }));
  }

  proposals.sort(compareContactProposals);
  proposals.forEach((p, i) => { p.rank = i + 1; });

  const tally = (list) => list.reduce((a, p) => ({ ...a, [p.confidence]: (a[p.confidence] || 0) + 1 }), {});
  const byConfidence = tally(proposals);
  const phoneProposals = proposals.filter((p) => p.clusterKind === 'phone');
  const emailProposals = proposals.filter((p) => p.clusterKind === 'email');
  const phoneByConfidence = tally(phoneProposals);
  return {
    proposals,
    stats: {
      contacts: contacts.length,
      newContactSpamExcluded: spam.length,
      contactsConsidered: real.length,
      phoneClusters: phoneProposals.length,
      // Distinct contacts. (The audit summed member counts across clusters, so a
      // contact in two clusters counted twice — hence its slightly higher figure.)
      contactsInPhoneClusters: new Set(phoneProposals.flatMap((p) => p.members.map((m) => m.legacyId))).size,
      contactsInPhoneClustersSummed: phoneProposals.reduce((n, p) => n + p.members.length, 0),
      emailOnlyClusters: emailProposals.length,
      roleEmailClustersSkipped: roleEmailSkipped,
      proposals: proposals.length,
      byConfidence,
      // Phone-only breakdown — this is what reconciles with the M1b audit.
      phoneByConfidence,
      emailByConfidence: tally(emailProposals),
      // The audit reported ambiguous ∪ shared as one bucket (phone clusters only).
      auditAmbiguousBucket: (phoneByConfidence.ambiguous || 0) + (phoneByConfidence.shared || 0),
      batchApprovable: proposals.filter((p) => p.batchApprovable).length,
      needsIndividualReview: proposals.filter((p) => !p.batchApprovable).length,
      operationallyActive: proposals.filter((p) => p.operationallyActive).length,
      // The owner's real workload: what the sections route to.
      bySection: proposals.reduce((a, p) => ({ ...a, [p.section]: (a[p.section] || 0) + 1 }), {}),
      decisionRequired: proposals.filter((p) => p.decisionRequired).length,
      noDecisionRequired: proposals.filter((p) => !p.batchApprovable && !p.decisionRequired).length,
      ruleCounts,
    },
  };
}

export const contactSubjectKey = (p) => `contact:${p.clusterKind}:${p.clusterKey}`;
