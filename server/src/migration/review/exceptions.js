// Exceptional Records — genuinely unusual source records that would otherwise be
// silently skipped, or would force GOS to invent a placeholder entity.
//
// NOT a validation-warning dump. An owner-approved rule: "Do not turn normal
// validation warnings into exceptions." A private customer with no organisation is
// normal (194 active deals look like that); a deal pointing at an organisation the
// owner EXCLUDED is not. Only the second is here.
//
// Every detector is a pure function over snapshot facts + the decision ledger, and
// each one states honestly whether it BLOCKS Identity Import.
//
// ── WHAT "BLOCKS IDENTITY IMPORT" MEANS ───────────────────────────────────────
// Identity Import creates Contacts and Organizations — nothing else. So a deal-level
// anomaly (an archived open deal, a broken tour link) is real and must be decided,
// but it cannot block IDENTITY: it blocks the later Deals/Tours import. Only an
// exception that would produce a WRONG or MISSING contact/organisation blocks this
// step. Saying otherwise would make the gate lie.

export const EXCEPTION_KINDS = {
  archived_open_deal: {
    label: 'עסקה פתוחה שהועברה לארכיון',
    blocksIdentity: false,
    why: 'העסקה פתוחה אבל אורכבה ב-Pipedrive — היא לא תופיע בתצוגות רגילות, ולכן תדלג בשקט על הייבוא בלי החלטה מפורשת.',
    impact: 'ייבוא העסקאות (לא ייבוא הזהויות)',
  },
  spam_contact_with_deal: {
    label: 'רשומת "New Contact" מקושרת לעסקה',
    blocksIdentity: false,
    why: 'רשומות "New Contact" מוחרגות מיצירת אנשי קשר, אבל דווקא לזו יש עסקה מקושרת — אחרת היא הייתה נעלמת בלי שאיש יחליט על כך.',
    impact: 'העסקה תיוותר ללא איש קשר',
  },
  active_deal_no_contact: {
    label: 'עסקה פעילה ללא איש קשר',
    blocksIdentity: false,
    why: 'לעסקה פעילה אין איש קשר מקושר כלל — ייבוא שלה יחייב יצירת איש קשר פיקטיבי.',
    impact: 'תפעול חי — יחייב ישות placeholder',
  },
  active_deal_dead_contact: {
    label: 'עסקה פעילה מצביעה על איש קשר שלא קיים',
    blocksIdentity: true,
    why: 'העסקה מצביעה על מזהה איש קשר שאינו קיים בצילום — היעד לא קיים ואי אפשר לייבא אותו.',
    impact: 'תפעול חי — יעד חסר',
  },
  active_deal_excluded_org: {
    label: 'עסקה פעילה מצביעה על ארגון שהוחרג',
    blocksIdentity: true,
    why: 'הבעלים סימן את ארגון המקור כ"החרגה", אבל עסקה פעילה עדיין מצביעה עליו — היעד לא ייווצר.',
    impact: 'תפעול חי — העסקה תאבד את הארגון',
  },
  contact_stripped_of_identity: {
    label: 'תיקון נתוני מקור הותיר איש קשר ללא זיהוי',
    blocksIdentity: true,
    why: 'לאחר תיקון נתוני המקור לא נותרו לאיש הקשר טלפון או אימייל, ויש לו עסקאות פעילות — לא ניתן יהיה לזהות או ליצור איתו קשר.',
    impact: 'תפעול חי — יעד לא פתיר',
  },
  name_exclusion_with_active_deals: {
    label: 'ניקוי שמות מחריג איש קשר של עסקה פעילה',
    blocksIdentity: true,
    why: 'ההחלטה בניקוי השמות היא לא לייבא את הרשומה, אבל יש לה עסקה פתוחה או סיור עתידי — העסקה תיוותר ללא איש קשר.',
    impact: 'תפעול חי — יחייב ישות placeholder',
  },
  broken_tour_link: {
    label: 'קישור שבור בין סיור ב-Airtable לעסקה ב-Pipedrive',
    blocksIdentity: false,
    why: 'רשומת הסיור מצביעה על מזהה עסקה שאינו קיים ב-Pipedrive — כנראה העסקה נמחקה והסיור נשאר.',
    impact: 'ייבוא הסיורים',
  },
  broken_collection_link: {
    label: 'קישור שבור בין רשומת גבייה לעסקה',
    blocksIdentity: false,
    why: 'רשומת הגבייה מצביעה על מזהה עסקה שאינו קיים ב-Pipedrive — הכסף לא ישויך לשום עסקה.',
    impact: 'ייבוא הגבייה',
  },
  open_deal_past_tour: {
    label: 'עסקה פתוחה שתאריך הסיור שלה כבר עבר',
    blocksIdentity: false,
    why: 'הסיור כבר קרה אבל העסקה נשארה פתוחה — או שהיא הושלמה ולא נסגרה, או שהתאריך שגוי.',
    impact: 'ייבוא העסקאות — סטטוס לא אמין',
  },
};

export const exceptionSubjectKey = (kind, id) => `exc:${kind}:${id}`;

const kindMeta = (k) => EXCEPTION_KINDS[k] || { label: k, blocksIdentity: false, why: '', impact: '' };

function makeException({ kind, id, title, records, evidence, proposal, choices }) {
  const m = kindMeta(kind);
  return {
    kind: 'exception',
    exceptionKind: kind,
    subjectId: String(id),
    label: m.label,
    title,
    why: m.why,
    impact: m.impact,
    blocksIdentity: m.blocksIdentity,
    records,
    evidence,
    proposedTreatment: proposal,
    choices: choices || ['approve', 'edit', 'exclude', 'defer'],
  };
}

// ── detectors ─────────────────────────────────────────────────────────────────
// Each takes the assembled snapshot facts + ledger, and returns exceptions.
// Adding a category = adding one function here and one entry in EXCEPTION_KINDS.

export function detectArchivedOpenDeals({ deals }) {
  return deals
    .filter((d) => d.status === 'open' && d.archived === true)
    .map((d) =>
      makeException({
        kind: 'archived_open_deal',
        id: d.id,
        title: d.title || `עסקה ${d.id}`,
        records: [{ entity: 'pipedrive/deals', id: d.id, label: d.title }],
        evidence: [
          `סטטוס: פתוחה · אורכבה: כן`,
          d.tourDate ? `תאריך סיור: ${d.tourDate}` : 'ללא תאריך סיור',
          `שווי: ${d.value ?? 0}`,
          d.personName ? `איש קשר: ${d.personName}` : 'ללא איש קשר',
        ],
        proposal: d.value ? 'import_as_open' : 'archive_only',
        choices: ['approve', 'edit', 'exclude', 'defer', 'archive_only'],
      }),
    );
}

export function detectSpamContactWithDeal({ spamContactsWithDeals }) {
  return spamContactsWithDeals.map((c) =>
    makeException({
      kind: 'spam_contact_with_deal',
      id: c.legacyId,
      title: c.name,
      records: [{ entity: 'pipedrive/persons', id: c.legacyId, label: c.name }],
      evidence: [
        `עסקאות מקושרות: ${c.dealCount}`,
        `סטטוסים: ${c.dealStatuses.join(', ') || '—'}`,
        c.hasActiveDeal ? 'יש עסקה פעילה' : 'כל העסקאות סגורות',
      ],
      proposal: c.hasActiveDeal ? 'import_as_contact' : 'archive_only',
      choices: ['approve', 'edit', 'exclude', 'defer', 'archive_only', 'route'],
    }),
  );
}

export function detectActiveDealMappingGaps({ deals, personIds, excludedOrgIds, spamPersonIds }) {
  const out = [];
  for (const d of deals.filter((x) => x.isActive)) {
    if (d.personId == null) {
      out.push(makeException({
        kind: 'active_deal_no_contact', id: d.id, title: d.title || `עסקה ${d.id}`,
        records: [{ entity: 'pipedrive/deals', id: d.id, label: d.title }],
        evidence: ['עסקה פעילה', 'ללא איש קשר מקושר', d.orgId ? `ארגון: ${d.orgName || d.orgId}` : 'גם ללא ארגון'],
        proposal: d.orgId ? 'link_to_organization_only' : 'needs_owner_route',
        choices: ['approve', 'edit', 'exclude', 'defer', 'route'],
      }));
      continue;
    }
    if (!personIds.has(d.personId)) {
      out.push(makeException({
        kind: 'active_deal_dead_contact', id: d.id, title: d.title || `עסקה ${d.id}`,
        records: [{ entity: 'pipedrive/deals', id: d.id, label: d.title }],
        evidence: ['עסקה פעילה', `מצביעה על איש קשר ${d.personId} שאינו קיים בצילום`],
        proposal: 'needs_owner_route',
        choices: ['approve', 'edit', 'exclude', 'defer', 'route'],
      }));
      continue;
    }
    if (spamPersonIds.has(d.personId)) {
      out.push(makeException({
        kind: 'spam_contact_with_deal', id: d.personId, title: `עסקה פעילה ${d.id}`,
        records: [{ entity: 'pipedrive/persons', id: d.personId }, { entity: 'pipedrive/deals', id: d.id }],
        evidence: ['עסקה פעילה', 'איש הקשר הוא רשומת "New Contact" שמוחרגת מייבוא'],
        proposal: 'import_as_contact',
        choices: ['approve', 'edit', 'exclude', 'defer', 'route'],
      }));
    }
    if (d.orgId != null && excludedOrgIds.has(d.orgId)) {
      out.push(makeException({
        kind: 'active_deal_excluded_org', id: d.id, title: d.title || `עסקה ${d.id}`,
        records: [{ entity: 'pipedrive/deals', id: d.id }, { entity: 'pipedrive/organizations', id: d.orgId, label: d.orgName }],
        evidence: ['עסקה פעילה', `הארגון ${d.orgName || d.orgId} סומן כ"החרגה" בתור הארגונים`],
        proposal: 'needs_owner_route',
        choices: ['approve', 'edit', 'exclude', 'defer', 'route'],
      }));
    }
  }
  return out;
}

export function detectStrippedIdentities({ strippedContacts }) {
  return strippedContacts
    .filter((c) => c.activeDealCount > 0)
    .map((c) =>
      makeException({
        kind: 'contact_stripped_of_identity', id: c.legacyId, title: c.name,
        records: [{ entity: 'pipedrive/persons', id: c.legacyId, label: c.name }],
        evidence: [
          `תיקון נתוני מקור הסיר את כל אמצעי הזיהוי`,
          `עסקאות פעילות: ${c.activeDealCount}`,
        ],
        proposal: 'needs_owner_route',
        choices: ['approve', 'edit', 'exclude', 'defer', 'route'],
      }),
    );
}

export function detectNameExclusionsWithLiveDeals({ nameExclusions }) {
  return nameExclusions
    .filter((n) => n.operationallyActive)
    .map((n) =>
      makeException({
        kind: 'name_exclusion_with_active_deals', id: n.legacyId, title: n.displayName,
        records: [{ entity: 'pipedrive/persons', id: n.legacyId, label: n.displayName }],
        evidence: [
          `ההצעה/ההחלטה בניקוי שמות: לא לייבא`,
          `עסקאות פתוחות: ${n.openDealCount} · סיורים עתידיים: ${n.futureTourDeals}`,
        ],
        proposal: 'needs_owner_route',
        choices: ['approve', 'edit', 'exclude', 'defer', 'route'],
      }),
    );
}

export function detectBrokenAirtableLinks({ brokenTourLinks, brokenCollectionLinks }) {
  const one = (kind, r) =>
    makeException({
      kind, id: r.airtableId, title: r.name || r.airtableId,
      records: [{ entity: r.entity, id: r.airtableId, label: r.name }],
      evidence: [`מצביעה על עסקה ${r.dealId} שאינה קיימת ב-Pipedrive`, r.date ? `תאריך: ${r.date}` : null].filter(Boolean),
      proposal: 'archive_only',
      choices: ['approve', 'edit', 'exclude', 'defer', 'archive_only', 'route'],
    });
  return [
    ...brokenTourLinks.map((r) => one('broken_tour_link', r)),
    ...brokenCollectionLinks.map((r) => one('broken_collection_link', r)),
  ];
}

export function detectOpenDealsWithPastTour({ deals, today }) {
  return deals
    .filter((d) => d.status === 'open' && d.tourDate && d.tourDate < today && !d.archived)
    .map((d) =>
      makeException({
        kind: 'open_deal_past_tour', id: d.id, title: d.title || `עסקה ${d.id}`,
        records: [{ entity: 'pipedrive/deals', id: d.id, label: d.title }],
        evidence: [`תאריך הסיור ${d.tourDate} כבר עבר`, 'העסקה עדיין פתוחה'],
        proposal: 'import_as_open',
        choices: ['approve', 'edit', 'exclude', 'defer'],
      }),
    );
}

const DETECTORS = [
  detectArchivedOpenDeals,
  detectSpamContactWithDeal,
  detectActiveDealMappingGaps,
  detectStrippedIdentities,
  detectNameExclusionsWithLiveDeals,
  detectBrokenAirtableLinks,
  detectOpenDealsWithPastTour,
];

export function buildExceptions(facts) {
  const seen = new Set();
  const out = [];
  for (const fn of DETECTORS) {
    for (const e of fn(facts) || []) {
      const key = exceptionSubjectKey(e.exceptionKind, e.subjectId);
      if (seen.has(key)) continue; // one row per (kind, subject) — never a duplicate
      seen.add(key);
      out.push(e);
    }
  }
  // Identity blockers first, then live-operations impact, then the rest.
  out.sort((a, b) =>
    Number(b.blocksIdentity) - Number(a.blocksIdentity) ||
    a.exceptionKind.localeCompare(b.exceptionKind) ||
    String(a.subjectId).localeCompare(String(b.subjectId)));
  out.forEach((e, i) => { e.rank = i + 1; });

  const byKind = {};
  for (const e of out) byKind[e.exceptionKind] = (byKind[e.exceptionKind] || 0) + 1;
  return {
    exceptions: out,
    stats: {
      total: out.length,
      blocksIdentity: out.filter((e) => e.blocksIdentity).length,
      nonBlocking: out.filter((e) => !e.blocksIdentity).length,
      byKind,
      // Categories that were checked and came back CLEAN. Reported explicitly:
      // "we looked and found nothing" is a different claim from "we did not look".
      checkedAndClean: Object.keys(EXCEPTION_KINDS).filter((k) => !byKind[k]),
    },
  };
}
