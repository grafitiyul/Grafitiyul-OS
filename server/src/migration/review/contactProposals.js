// Contacts review — duplicate-cluster proposals from Snapshot #1.
//
// PURE functions; the bounded pass streams the snapshot once and calls these.
//
// Workload rule: the queue contains CLUSTERS (≈1,151), never the 32,475 contacts.
// A contact that is not part of a duplicate cluster is not a decision — it simply
// migrates. Only clusters need a human, and the `safe` ones can be batch-approved.
//
// The classifier is byte-identical to the M1b audit so the approved numbers
// reconcile: 647 safe / 363 probable / 141 (ambiguous ∪ shared).
import { normalizeForCompare, isComparable, isNewContactName } from '../phoneCompare.js';

export const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
export const personName = (p) => norm(`${p.firstName || ''} ${p.lastName || ''}`);

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

// The audit's exact grouping, with `shared` (>2 on one number) split out of the
// ambiguous bucket because it needs a different human judgement.
export function classifyCluster(members) {
  const names = new Set(members.map((m) => personName(m)).filter(Boolean));
  const emailSets = members.map((m) => new Set((m.emails || []).map((e) => norm(e))));
  const shareEmail = members.length === 2 && [...emailSets[0]].some((e) => emailSets[1].has(e));
  const bothHaveEmails = members.every((m) => (m.emails || []).length);
  const disjointEmails = bothHaveEmails && !members.some((m, i) =>
    members.some((o, j) => i < j && [...emailSets[i]].some((e) => emailSets[j].has(e))));
  const nameConflict = names.size > 1;

  let confidence;
  if (members.length > 2) confidence = 'shared';
  else if (!nameConflict || shareEmail) confidence = 'safe';
  else if (nameConflict && !disjointEmails) confidence = 'probable';
  else confidence = 'ambiguous';

  return { confidence, nameConflict, shareEmail, disjointEmails, names: [...names] };
}

// The record to KEEP: most deals → most complete → oldest id (deterministic).
const completeness = (m) => (m.emails?.length ? 2 : 0) + (m.phones?.length ? 1 : 0) + (m.firstName ? 1 : 0) + (m.lastName ? 1 : 0) + (m.orgName ? 1 : 0);
export function pickPrimary(members) {
  return [...members].sort(
    (a, b) => (b.dealCount || 0) - (a.dealCount || 0) || completeness(b) - completeness(a) || a.legacyId - b.legacyId,
  )[0];
}

function reasonFor(cls, members, clusterKind) {
  if (clusterKind === 'email') return 'כתובת אימייל זהה בדיוק — ראיה חזקה לאותו אדם.';
  if (cls.confidence === 'shared') {
    return `אותו מספר טלפון משותף ל-${members.length} אנשי קשר — כנראה מספר משרד/מרכזייה ולא אותו אדם. לעולם לא מאוחד אוטומטית.`;
  }
  if (cls.confidence === 'safe') {
    return cls.nameConflict
      ? 'אותו טלפון ואותה כתובת אימייל — אותו אדם, גם אם השם נכתב אחרת.'
      : 'אותו טלפון ואותו שם — אותו אדם.';
  }
  if (cls.confidence === 'probable') {
    return 'אותו טלפון, אבל השם שונה. אין אימיילים סותרים — סביר שזה אותו אדם, נדרשת הכרעה.';
  }
  return 'אותו טלפון, אבל גם השם שונה וגם כתובות האימייל שונות לגמרי — ייתכן שאלה שני אנשים שונים שחולקים מספר.';
}

function buildCluster({ clusterKind, clusterKey, members, today }) {
  const cls = classifyCluster(members);
  const primary = pickPrimary(members);

  const totals = members.reduce(
    (a, m) => ({
      deals: a.deals + (m.dealCount || 0),
      activeDeals: a.activeDeals + (m.activeDealCount || 0),
      futureTourDeals: a.futureTourDeals + (m.futureTourDeals || 0),
    }),
    { deals: 0, activeDeals: 0, futureTourDeals: 0 },
  );

  const exact = [];
  const inferred = [];
  const conflicts = [];
  if (clusterKind === 'phone') exact.push(`אותו מספר טלפון (${members[0].matchedOn})`);
  if (clusterKind === 'email') exact.push('אותה כתובת אימייל');
  if (cls.shareEmail) exact.push('כתובת אימייל משותפת');
  if (!cls.nameConflict) exact.push('שם זהה');
  if (cls.nameConflict) conflicts.push(`שמות שונים: ${cls.names.join(' · ')}`);
  if (cls.disjointEmails) conflicts.push('אין אף כתובת אימייל משותפת');
  if (members.length > 2) conflicts.push(`${members.length} אנשי קשר על אותו מספר`);
  const orgNames = [...new Set(members.map((m) => m.orgName).filter(Boolean))];
  if (orgNames.length === 1 && members.filter((m) => m.orgName).length > 1) inferred.push(`אותו ארגון: ${orgNames[0]}`);
  if (orgNames.length > 1) conflicts.push(`ארגונים שונים: ${orgNames.join(' · ')}`);

  const missing = [];
  if (!members.some((m) => (m.emails || []).length)) missing.push('אימייל');
  if (!members.some((m) => m.orgName)) missing.push('ארגון מקושר');

  return {
    kind: 'contact_cluster',
    clusterKind,
    clusterKey,
    confidence: cls.confidence,
    reason: reasonFor(cls, members, clusterKind),
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
      operationallyActive: (m.activeDealCount || 0) > 0 || (m.futureTourDeals || 0) > 0,
      addTime: m.addTime || null,
      matchRule: m.matchRule || null,
      source: { entity: 'pipedrive/persons', id: m.legacyId },
    })),
    proposedPrimaryLegacyId: primary.legacyId,
    // `safe` clusters propose a merge; `shared` never does.
    proposedMergeLegacyIds: cls.confidence === 'shared' ? [] : members.filter((m) => m.legacyId !== primary.legacyId).map((m) => m.legacyId),
    proposedSeparateLegacyIds: cls.confidence === 'shared' ? members.filter((m) => m.legacyId !== primary.legacyId).map((m) => m.legacyId) : [],
    evidence: { exact, inferred, conflicts, missing },
    totals,
    operationallyActive: totals.activeDeals > 0 || totals.futureTourDeals > 0,
    batchApprovable: cls.confidence === 'safe',
  };
}

// Tier-2 impact → deals → cluster size → confidence.
export function compareContactProposals(a, b) {
  const impact = (p) => p.totals.activeDeals + p.totals.futureTourDeals;
  return (
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
      ruleCounts,
    },
  };
}

export const contactSubjectKey = (p) => `contact:${p.clusterKind}:${p.clusterKey}`;
