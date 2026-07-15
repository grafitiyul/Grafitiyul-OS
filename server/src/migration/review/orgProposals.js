// Organizations review — proposal generation from Snapshot #1.
//
// PURE functions: all data is passed in (the bounded pass streams the snapshot
// once and calls these). No I/O, no Pipedrive/Airtable, no writes.
//
// Rules that matter:
//   * An exact tax id is the ONLY evidence strong enough to call a cluster "safe".
//   * Name similarity ALONE is never auto-approved — it is always owner review.
//   * Organization TYPE is never inferred from name keywords (no hardcoded
//     "bank"/"health fund"/"university"). A type is proposed only when an existing
//     GOS organization match already carries one from the configurable list.

// Pipedrive custom-field keys (values, never names, are read at runtime).
export const ORG_TAXID = '49f67a1342a56c48ed9ef2cb8a07264d4f3b58ac';
export const ORG_ICOUNT = 'b57596667582c03433c8f2d05d60ad0d8efba283';
export const DEAL_TOURDATE = 'a860fcf9681c2bb1f71200514cffdb5c8cadedb7';

// Legal-suffix stripping. The ORIGINAL audit normaliser had a measured defect:
// punctuation was removed FIRST (so `בע"מ` became `בע מ`), and JS `\b` is an ASCII
// word boundary that never matches beside Hebrew letters — so Hebrew suffixes were
// never stripped and only the Latin ones (ltd/inc/…) worked.
//
// Fixed here (owner-approved): punctuation → collapse → strip suffixes tolerant of
// the space the punctuation left behind. Measured effect: name clusters
// 169 → 173 (+4 clusters / +8 orgs), e.g. `גולמט` ≡ `גולמט בע"מ`. All true
// positives; no first-token/brand matching is added (measured unusable).
const LEGAL_SUFFIX = /(^|\s)(בע"?מ|בעמ|בע\s*מ|בע”מ|חל"?צ|עמותה|ltd|inc|llc|co|company)(\s|$)/gi;

export function normName(n) {
  return String(n || '')
    .toLowerCase()
    .replace(/["'’`.,\-–_()|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(LEGAL_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Meaningful tokens for corroboration (short tokens are noise).
export const nameTokens = (n) => new Set(normName(n).split(' ').filter((t) => t.length > 2));

export const digits = (v) => String(v || '').replace(/\D/g, '');
export const emailDomain = (e) => {
  const m = /@([^\s@]+)$/.exec(String(e || '').trim());
  return m ? m[1].toLowerCase() : null;
};

// Tier-2 "operationally active" — the measured union from the M1 audit.
export function isActiveDeal(d, today) {
  const tour = d?.[DEAL_TOURDATE] ? String(d[DEAL_TOURDATE]).slice(0, 10) : null;
  return (
    d?.status === 'open' ||
    (tour && tour >= today) ||
    (d?.next_activity_date && String(d.next_activity_date) >= today) ||
    (d?.undone_activities_count || 0) > 0
  );
}
export const hasFutureTour = (d, today) => {
  const tour = d?.[DEAL_TOURDATE] ? String(d[DEAL_TOURDATE]).slice(0, 10) : null;
  return !!(tour && tour >= today);
};

const CONF_RANK = { safe: 3, high: 2, review: 1 };

// Group orgs by a key function; keep only groups with >1 member.
function clusterBy(orgs, keyFn) {
  const idx = new Map();
  for (const o of orgs) {
    const k = keyFn(o);
    if (!k) continue;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(o);
  }
  return [...idx.entries()].filter(([, arr]) => arr.length > 1);
}

// Shared attributes across a cluster → the "inferred" evidence that can lift a
// name cluster to high confidence.
const memberPhones = (m) => (m.phones?.length ? m.phones : m.phone ? [m.phone] : []);

function sharedSignals(members) {
  const phones = new Set(), addresses = new Set(), domains = new Set();
  let withPhone = 0, withAddress = 0, withDomain = 0;
  for (const m of members) {
    const ph = memberPhones(m);
    if (ph.length) { for (const p of ph) phones.add(digits(p)); withPhone++; }
    if (m.address) { addresses.add(String(m.address).trim().toLowerCase()); withAddress++; }
    for (const d of m.emailDomains) domains.add(d);
    if (m.emailDomains.length) withDomain++;
  }
  return {
    sharedPhone: phones.size === 1 && withPhone === members.length,
    sharedAddress: addresses.size === 1 && withAddress === members.length,
    sharedEmailDomain: domains.size === 1 && withDomain >= 2,
    domains: [...domains],
  };
}

// Canonical name = the member with the most deals; ties → the shortest name
// (usually the parent, e.g. "בנק לאומי" over "בנק לאומי סניף רמת גן").
function pickCanonical(members) {
  return [...members].sort(
    (a, b) => b.dealCount - a.dealCount || a.name.length - b.name.length || String(a.legacyId).localeCompare(String(b.legacyId)),
  )[0];
}

// A member is a UNIT candidate when it is not the canonical row AND its name
// extends the canonical name (a branch/department pattern) — evidence-based, no
// keyword lists. Returns the SUGGESTED unit name (the distinguishing tail, which
// is what a human usually wants: "Clalit Platinum" under "Clalit" → "Platinum").
function unitName(canonicalName, memberName) {
  const c = normName(canonicalName);
  const m = normName(memberName);
  if (m === c) return null;
  if (!(m.startsWith(c) && m.length > c.length)) return null;
  // Suggest the tail of the ORIGINAL (un-normalised) name where possible, else
  // fall back to the full original name. Always overridable by the owner.
  const raw = String(memberName).trim();
  const rawCanon = String(canonicalName).trim();
  const tail = raw.toLowerCase().startsWith(rawCanon.toLowerCase())
    ? raw.slice(rawCanon.length).replace(/^[\s\-–—:,.|]+/, '').trim()
    : '';
  return tail || raw;
}

// Per-member match against live GOS (read-only evidence).
function matchGos(member, gosOrgs) {
  const t = digits(member.taxId);
  if (t.length >= 8 && gosOrgs.byTaxId.has(t)) {
    const h = gosOrgs.byTaxId.get(t);
    return { id: h.id, name: h.name, matchedOn: 'taxId', organizationTypeId: h.organizationTypeId ?? null, organizationTypeLabel: h.organizationTypeLabel ?? null };
  }
  const n = normName(member.name);
  if (n && gosOrgs.byName.has(n)) {
    const h = gosOrgs.byName.get(n);
    return { id: h.id, name: h.name, matchedOn: 'name', organizationTypeId: h.organizationTypeId ?? null, organizationTypeLabel: h.organizationTypeLabel ?? null };
  }
  return null;
}

// Do the members share at least one meaningful name token? (Corroboration, and
// the cheapest signal that an iCount id is not a shared placeholder.)
function sharedNameToken(members) {
  const sets = members.map((m) => nameTokens(m.name));
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      for (const t of sets[i]) if (sets[j].has(t)) return t;
    }
  }
  return null;
}

function buildCluster({ clusterKind, clusterKey, members, gosOrgs, today }) {
  const signals = sharedSignals(members);
  const taxIds = new Set(members.map((m) => digits(m.taxId)).filter((t) => t.length >= 8));
  const icountIds = new Set(members.map((m) => String(m.icountId || '').trim()).filter(Boolean));
  const sharedIcount = icountIds.size === 1 && members.every((m) => String(m.icountId || '').trim());
  const tokenMatch = sharedNameToken(members);

  // Confidence — the single most important rule in this slice.
  let confidence, reason;
  if (clusterKind === 'taxId') {
    confidence = 'safe';
    reason = 'מספר ח.פ/עוסק זהה בכל הרשומות — ראיה חד-משמעית לאותו ארגון.';
  } else if (clusterKind === 'icountId') {
    // DEMOTED (audit finding): an iCount id is NOT a unique organisation identifier
    // in this data — 74 values are shared by unrelated orgs (placeholders/test rows),
    // which produced clusters like "IMD SOFT + STORE NEXT + ניסיון למחוק". It may no
    // longer create a proposal on its own; it must be corroborated. Uncorroborated
    // iCount clusters are dropped before this point (see buildOrgProposals).
    if (signals.sharedPhone || signals.sharedAddress || signals.sharedEmailDomain) {
      confidence = 'high';
      reason = 'מזהה iCount זהה, ובנוסף פרטי התקשרות זהים — ראיה תומכת מעבר למזהה החשבונאי.';
    } else {
      confidence = 'review';
      reason = `מזהה iCount זהה ושם חופף חלקית ("${tokenMatch}"). מזהה iCount לבדו אינו הוכחה — הוא משותף לעיתים לרשומות לא קשורות — ולכן נדרשת הכרעה אנושית.`;
    }
  } else if (signals.sharedPhone || signals.sharedAddress || signals.sharedEmailDomain) {
    confidence = 'high';
    const which = [signals.sharedPhone && 'טלפון זהה', signals.sharedAddress && 'כתובת זהה', signals.sharedEmailDomain && 'דומיין אימייל משותף'].filter(Boolean);
    reason = `שם מנורמל זהה, ובנוסף ${which.join(' ו')} — ראיה תומכת מעבר לשם בלבד.`;
  } else {
    // Name similarity ALONE — never auto-approved.
    confidence = 'review';
    reason = 'שם מנורמל זהה בלבד, ללא ראיה תומכת נוספת. דורש הכרעה אנושית — שם דומה אינו מספיק לאיחוד.';
  }

  const canonical = pickCanonical(members);

  // Units carry a STABLE KEY, and each source record is ASSIGNED to the
  // organization, to a specific unit key, or split off as separate. This is what
  // lets several source rows collapse into ONE (possibly renamed) unit — e.g.
  // "Leumi Capital Markets" + "Capital Markets" + "Leumi - Capital" → one unit
  // "Capital Markets Division" under "Bank Leumi".
  const proposedUnits = [];
  const proposedAssignments = {};
  const memberRoles = {};
  for (const m of members) {
    if (m.legacyId === canonical.legacyId) {
      memberRoles[m.legacyId] = 'canonical';
      proposedAssignments[m.legacyId] = 'organization';
      continue;
    }
    const u = unitName(canonical.name, m.name);
    if (u) {
      const key = `u${m.legacyId}`;
      proposedUnits.push({ key, name: u, fromLegacyId: m.legacyId });
      memberRoles[m.legacyId] = 'unit';
      proposedAssignments[m.legacyId] = `unit:${key}`;
    } else {
      memberRoles[m.legacyId] = 'same';
      proposedAssignments[m.legacyId] = 'organization';
    }
  }

  // Existing GOS organization match — exact tax id first, then exact normalised
  // name. Read-only evidence for conflict detection; never a write.
  let gosMatch = null;
  for (const t of taxIds) {
    const hit = gosOrgs.byTaxId.get(t);
    if (hit) { gosMatch = { id: hit.id, name: hit.name, matchedOn: 'taxId', organizationTypeId: hit.organizationTypeId ?? null, organizationTypeLabel: hit.organizationTypeLabel ?? null }; break; }
  }
  if (!gosMatch) {
    const hit = gosOrgs.byName.get(normName(canonical.name));
    if (hit) gosMatch = { id: hit.id, name: hit.name, matchedOn: 'name', organizationTypeId: hit.organizationTypeId ?? null, organizationTypeLabel: hit.organizationTypeLabel ?? null };
  }

  // Type ONLY from an existing GOS match's configurable type — never guessed.
  const proposedType = gosMatch?.organizationTypeId
    ? { organizationTypeId: gosMatch.organizationTypeId, organizationTypeLabel: gosMatch.organizationTypeLabel, typeReason: `נגזר מהתאמה לארגון קיים ב-GOS ("${gosMatch.name}")` }
    : { organizationTypeId: null, organizationTypeLabel: null, typeReason: 'לא נגזר מהראיות — סוג הארגון ייבחר ידנית מתוך הרשימה המוגדרת.' };

  const totals = members.reduce(
    (a, m) => ({
      deals: a.deals + m.dealCount,
      activeDeals: a.activeDeals + m.activeDealCount,
      contacts: a.contacts + m.contactCount,
      futureTourDeals: a.futureTourDeals + m.futureTourDeals,
    }),
    { deals: 0, activeDeals: 0, contacts: 0, futureTourDeals: 0 },
  );

  const missing = [];
  if (!taxIds.size) missing.push('ח.פ / עוסק מורשה');
  if (!members.some((m) => m.address)) missing.push('כתובת');
  if (!members.some((m) => memberPhones(m).length)) missing.push('טלפון');
  if (!members.some((m) => m.emailDomains.length)) missing.push('דומיין אימייל');
  if (!members.some((m) => m.contactCount > 0)) missing.push('אנשי קשר');

  return {
    kind: 'organization_cluster',
    clusterKind,
    clusterKey,
    confidence,
    reason,
    // Every source record carries enough BUSINESS CONTEXT to decide without
    // guessing from the name: who the contacts are, how to reach them, the
    // identity fields, the operational weight, and any existing GOS match.
    members: members.map((m) => ({
      legacyId: m.legacyId,
      name: m.name,
      taxId: m.taxId || null,
      address: m.address || null,
      city: m.city || null,
      phones: m.phones || (m.phone ? [m.phone] : []),
      emails: m.emails || [],
      emailDomains: m.emailDomains,
      contacts: m.contacts || [],
      primaryContact: m.primaryContact || null,
      contactCount: m.contactCount,
      dealCount: m.dealCount,
      activeDealCount: m.activeDealCount,
      futureTourDeals: m.futureTourDeals,
      operationallyActive: (m.activeDealCount || 0) > 0 || (m.futureTourDeals || 0) > 0,
      gosMatch: matchGos(m, gosOrgs),
      // Deep link into the Snapshot Browser for the full source record.
      source: { entity: 'pipedrive/organizations', id: m.legacyId },
      role: memberRoles[m.legacyId],
      defaultAssignment: proposedAssignments[m.legacyId],
    })),
    proposedCanonical: { name: canonical.name, fromLegacyId: canonical.legacyId, ...proposedType },
    proposedUnits,
    proposedAssignments,
    gosMatch,
    totals,
    // Exact vs inferred vs missing — surfaced explicitly for the reviewer.
    evidence: {
      exact: [
        clusterKind === 'taxId' && 'ח.פ/עוסק זהה',
        clusterKind === 'icountId' && 'מזהה iCount זהה',
        signals.sharedPhone && 'טלפון זהה',
        signals.sharedAddress && 'כתובת זהה',
        gosMatch?.matchedOn === 'taxId' && 'התאמה לארגון קיים ב-GOS לפי ח.פ',
      ].filter(Boolean),
      inferred: [
        clusterKind === 'normName' && 'שם מנורמל זהה',
        signals.sharedEmailDomain && `דומיין אימייל משותף (${signals.domains.join(', ')})`,
        gosMatch?.matchedOn === 'name' && 'התאמה לארגון קיים ב-GOS לפי שם',
      ].filter(Boolean),
      missing,
      // EVERY rule, reported pass AND fail. Seeing "✗ שמות שונים · ✗ טלפונים שונים"
      // is what makes a wrong cluster obvious at a glance. Derived from the signals
      // already computed above — no second code path, no re-derivation.
      checks: [
        { rule: 'ח.פ / עוסק מורשה זהה', passed: clusterKind === 'taxId', detail: taxIds.size === 1 ? 'זהה בכל הרשומות' : taxIds.size === 0 ? 'אין ח.פ באף רשומה' : 'ערכים שונים' },
        { rule: 'שם מנורמל זהה', passed: clusterKind === 'normName', detail: clusterKind === 'normName' ? `"${clusterKey}"` : `שמות שונים: ${[...new Set(members.map((m) => m.name))].join(' · ')}` },
        { rule: 'חפיפת מילה בשם', passed: !!tokenMatch, detail: tokenMatch ? `"${tokenMatch}"` : 'אין אף מילה משותפת בשמות' },
        { rule: 'מזהה iCount זהה', passed: sharedIcount, detail: sharedIcount ? `${[...icountIds][0]} — לא הוכחה בפני עצמה` : icountIds.size ? 'ערכים שונים' : 'אין מזהה iCount' },
        { rule: 'טלפון זהה', passed: signals.sharedPhone, detail: signals.sharedPhone ? 'זהה בכל הרשומות' : members.some((m) => memberPhones(m).length) ? 'טלפונים שונים או חסרים' : 'אין טלפון באף רשומה' },
        { rule: 'כתובת זהה', passed: signals.sharedAddress, detail: signals.sharedAddress ? 'זהה בכל הרשומות' : members.some((m) => m.address) ? 'כתובות שונות או חסרות' : 'אין כתובת באף רשומה' },
        { rule: 'דומיין אימייל תאגידי משותף', passed: signals.sharedEmailDomain, detail: signals.sharedEmailDomain ? signals.domains.join(', ') : signals.domains.length ? 'דומיינים שונים' : 'אין דומיין תאגידי' },
        { rule: 'ארגון תואם קיים ב-GOS', passed: !!gosMatch, detail: gosMatch ? `${gosMatch.name} (לפי ${gosMatch.matchedOn === 'taxId' ? 'ח.פ' : 'שם'})` : 'לא נמצא' },
      ],
    },
    operationallyActive: totals.activeDeals > 0 || totals.futureTourDeals > 0,
  };
}

// Deterministic priority: Tier-2/future impact → deals → contacts → size → confidence.
export function compareProposals(a, b) {
  const impact = (p) => p.totals.activeDeals + p.totals.futureTourDeals;
  return (
    impact(b) - impact(a) ||
    b.totals.deals - a.totals.deals ||
    b.totals.contacts - a.totals.contacts ||
    b.members.length - a.members.length ||
    CONF_RANK[b.confidence] - CONF_RANK[a.confidence] ||
    String(a.clusterKey).localeCompare(String(b.clusterKey))
  );
}

// orgs: [{ legacyId, name, taxId, icountId, phone, address, emailDomains[],
//          contactCount, dealCount, activeDealCount, futureTourDeals }]
// gosOrgs: { byTaxId: Map, byName: Map }
export function buildOrgProposals({ orgs, gosOrgs = { byTaxId: new Map(), byName: new Map() }, today }) {
  const taxClusters = clusterBy(orgs, (o) => (digits(o.taxId).length >= 8 ? digits(o.taxId) : null));
  const claimed = new Set(taxClusters.flatMap(([, arr]) => arr.map((o) => o.legacyId)));

  // iCount clusters only add value for orgs not already settled by tax id — AND
  // only when CORROBORATED. Tier-A membership must be earned by evidence, not
  // assumed: an iCount id is demonstrably shared by unrelated organisations in this
  // data (placeholder/test rows), so on its own it proves nothing.
  const icountCandidates = clusterBy(
    orgs.filter((o) => !claimed.has(o.legacyId)),
    (o) => (String(o.icountId || '').trim() ? `ic:${String(o.icountId).trim()}` : null),
  );
  const icountClusters = [];
  const icountRejected = [];
  for (const [key, members] of icountCandidates) {
    const s = sharedSignals(members);
    const corroborated = !!sharedNameToken(members) || s.sharedPhone || s.sharedAddress || s.sharedEmailDomain;
    if (corroborated) icountClusters.push([key, members]);
    else icountRejected.push({ key, names: members.map((m) => m.name) });
  }
  for (const [, arr] of icountClusters) for (const o of arr) claimed.add(o.legacyId);

  const nameClusters = clusterBy(orgs, (o) => normName(o.name) || null);

  const proposals = [];
  for (const [key, members] of taxClusters) proposals.push(buildCluster({ clusterKind: 'taxId', clusterKey: key, members, gosOrgs, today }));
  for (const [key, members] of icountClusters) proposals.push(buildCluster({ clusterKind: 'icountId', clusterKey: key, members, gosOrgs, today }));
  for (const [key, members] of nameClusters) {
    // A name cluster fully covered by a stronger cluster adds nothing.
    if (members.every((m) => claimed.has(m.legacyId))) continue;
    proposals.push(buildCluster({ clusterKind: 'normName', clusterKey: key, members, gosOrgs, today }));
  }

  proposals.sort(compareProposals);
  proposals.forEach((p, i) => { p.rank = i + 1; p.top25 = i < 25; });

  // The audit prioritised its top-25 purely by DEAL COUNT, while the approved
  // queue ordering puts Tier-2 operational impact first. Both matter, so the
  // audited set is flagged explicitly instead of silently re-ordered away.
  [...proposals]
    .sort((a, b) => b.totals.deals - a.totals.deals || String(a.clusterKey).localeCompare(String(b.clusterKey)))
    .slice(0, 25)
    .forEach((p) => { p.auditedTop25 = true; });
  for (const p of proposals) if (p.auditedTop25 !== true) p.auditedTop25 = false;

  return {
    proposals,
    stats: {
      organizations: orgs.length,
      taxIdClusters: taxClusters.length,
      taxIdOrgs: taxClusters.reduce((n, [, a]) => n + a.length, 0),
      icountCandidates: icountCandidates.length,
      icountClusters: icountClusters.length,
      // Dropped by the demotion — an iCount id with nothing corroborating it.
      icountRejectedUncorroborated: icountRejected.length,
      icountRejectedExamples: icountRejected.slice(0, 6),
      nameClusters: nameClusters.length,
      nameClusterOrgs: nameClusters.reduce((n, [, a]) => n + a.length, 0),
      proposals: proposals.length,
      byConfidence: proposals.reduce((acc, p) => ({ ...acc, [p.confidence]: (acc[p.confidence] || 0) + 1 }), {}),
      operationallyActive: proposals.filter((p) => p.operationallyActive).length,
      withGosMatch: proposals.filter((p) => p.gosMatch).length,
      // How well the audited (deal-count) top-25 lines up with the approved
      // (impact-first) ordering — reported, never fudged.
      auditedTop25InFirst25: proposals.slice(0, 25).filter((p) => p.auditedTop25).length,
    },
  };
}

export const subjectKeyFor = (p) => `org:${p.clusterKind}:${p.clusterKey}`;
