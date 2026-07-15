import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrgProposals, normName, isActiveDeal, hasFutureTour, subjectKeyFor, DEAL_TOURDATE } from './orgProposals.js';

const TODAY = '2026-07-15';
const org = (o) => ({
  legacyId: o.id, name: o.name, taxId: o.taxId || null, icountId: o.icountId || null,
  phone: o.phone || null, address: o.address || null, emailDomains: o.domains || [],
  contactCount: o.contacts || 0, dealCount: o.deals || 0, activeDealCount: o.active || 0,
  futureTourDeals: o.tours || 0,
});
const noGos = { byTaxId: new Map(), byName: new Map() };

// The audit's normaliser had a measured defect: Hebrew legal suffixes were never
// stripped (punctuation was removed first, and JS \b never matches beside Hebrew),
// so only Latin suffixes worked. That is FIXED here (owner-approved), which is what
// takes the name clusters from 169 → 173.
test('legal suffixes are stripped in BOTH scripts (the audited Hebrew defect is fixed)', () => {
  assert.equal(normName('Acme Ltd.'), 'acme', 'Latin suffixes stripped');
  assert.equal(normName('Acme Ltd'), normName('Acme Inc'), 'Latin variants collapse');
  assert.equal(normName('  ביתא   '), 'ביתא', 'whitespace collapses');
  assert.equal(normName('ביתא.'), normName('ביתא'), 'punctuation stripped');
  // The fix — these are the measured real-world wins:
  assert.equal(normName('בנק לאומי בע"מ'), 'בנק לאומי');
  assert.equal(normName('בנק לאומי בע"מ'), normName('בנק לאומי'));
  assert.equal(normName('גולמט בע"מ'), normName('גולמט'));
  assert.equal(normName('מנורה מבטחים בעמ'), normName('מנורה מבטחים'));
  // A brand that merely CONTAINS a suffix-like word is untouched.
  assert.equal(normName('בעלי מלאכה'), 'בעלי מלאכה');
});

test('the fixed normaliser clusters legal-suffix variants that the old one missed', () => {
  const { proposals } = buildOrgProposals({
    today: TODAY, gosOrgs: noGos,
    orgs: [org({ id: 1, name: 'גולמט', deals: 2 }), org({ id: 2, name: 'גולמט בע"מ', deals: 1 })],
  });
  assert.equal(proposals.length, 1, 'the old normaliser produced NO cluster here');
  assert.equal(proposals[0].clusterKind, 'normName');
  assert.equal(proposals[0].proposedCanonical.name, 'גולמט');
});

test('exact tax id → SAFE; identical name alone → REVIEW (never auto-approved)', () => {
  const { proposals } = buildOrgProposals({
    today: TODAY, gosOrgs: noGos,
    orgs: [
      org({ id: 1, name: 'אלפא', taxId: '512345678' }),
      org({ id: 2, name: 'אלפא סניף צפון', taxId: '512345678' }),
      org({ id: 3, name: 'ביתא' }),
      org({ id: 4, name: 'ביתא.' }),
    ],
  });
  const tax = proposals.find((p) => p.clusterKind === 'taxId');
  assert.equal(tax.confidence, 'safe');
  assert.match(tax.reason, /ח\.פ/);

  const name = proposals.find((p) => p.clusterKind === 'normName');
  assert.equal(name.confidence, 'review', 'name similarity alone is NEVER safe/high');
  assert.match(name.reason, /שם דומה אינו מספיק/);
  assert.deepEqual(name.evidence.exact, [], 'no exact evidence for a name-only cluster');
  assert.deepEqual(name.evidence.inferred, ['שם מנורמל זהה']);
});

test('a name cluster is lifted to HIGH only with supporting evidence', () => {
  const { proposals } = buildOrgProposals({
    today: TODAY, gosOrgs: noGos,
    orgs: [
      org({ id: 1, name: 'גמא', phone: '03-1234567', address: 'הרצל 1' }),
      org({ id: 2, name: 'גמא.', phone: '031234567', address: 'הרצל 1' }),
    ],
  });
  const p = proposals[0];
  assert.equal(p.confidence, 'high');
  assert.ok(p.evidence.exact.includes('טלפון זהה'));
  assert.ok(p.evidence.exact.includes('כתובת זהה'));
});

test('INVARIANT: a name cluster with no supporting signal can never be elevated', () => {
  // Exhaustive over the signal combinations: only name → always `review`.
  const cases = [
    { label: 'name only', a: {}, b: {} },
    { label: 'phones differ', a: { phone: '03-1111111' }, b: { phone: '03-2222222' } },
    { label: 'addresses differ', a: { address: 'א' }, b: { address: 'ב' } },
    { label: 'domains differ', a: { domains: ['x.co.il'] }, b: { domains: ['y.co.il'] } },
    { label: 'phone on only one member', a: { phone: '03-1111111' }, b: {} },
    { label: 'address on only one member', a: { address: 'א' }, b: {} },
  ];
  for (const c of cases) {
    const { proposals } = buildOrgProposals({
      today: TODAY, gosOrgs: noGos,
      orgs: [org({ id: 1, name: 'זהה', ...c.a }), org({ id: 2, name: 'זהה.', ...c.b })],
    });
    assert.equal(proposals[0].confidence, 'review', `"${c.label}" must stay review`);
    assert.deepEqual(proposals[0].evidence.exact, [], `"${c.label}" has no exact evidence`);
  }
});

test('nothing is ever auto-approved: every proposal starts unresolved', () => {
  const { proposals } = buildOrgProposals({
    today: TODAY, gosOrgs: noGos,
    orgs: [
      org({ id: 1, name: 'ודאי', taxId: '512345678' }), // even the SAFEST cluster
      org({ id: 2, name: 'ודאי2', taxId: '512345678' }),
    ],
  });
  assert.equal(proposals[0].confidence, 'safe');
  // Confidence is advice for a human — it carries no approval, no status, no
  // auto-merge flag. The pass persists every proposal as `pending`.
  assert.equal(proposals[0].status, undefined);
  assert.equal(proposals[0].autoApprove, undefined);
  assert.equal(proposals[0].autoMerge, undefined);
});

// ── iCount demotion (audit finding) ────────────────────────────────────────
test('an iCount id ALONE never creates a proposal (the real false positives)', () => {
  // The exact live cluster: five unrelated orgs sharing placeholder iCount 15641.
  const { proposals, stats } = buildOrgProposals({
    today: TODAY, gosOrgs: noGos,
    orgs: [
      org({ id: 220, name: 'IMD SOFT', icountId: '15641' }),
      org({ id: 361, name: 'STORE NEXT', icountId: '15641' }),
      org({ id: 414, name: 'ניסיון למחוק', icountId: '15641' }),
      org({ id: 416, name: 'priory team', icountId: '15641' }),
    ],
  });
  assert.equal(proposals.length, 0, 'no corroboration → no proposal at all');
  assert.equal(stats.icountRejectedUncorroborated, 1);
  assert.deepEqual(stats.icountRejectedExamples[0].names.sort(), ['IMD SOFT', 'STORE NEXT', 'ניסיון למחוק', 'priory team'].sort());
});

test('a CORROBORATED iCount match still proposes — but never above its evidence', () => {
  // iCount + a shared name token → plausible, so a human decides.
  const tokenOnly = buildOrgProposals({
    today: TODAY, gosOrgs: noGos,
    orgs: [org({ id: 1, name: 'אולגה תיירות', icountId: '20893' }), org({ id: 2, name: 'אולגה נסיעות', icountId: '20893' })],
  });
  assert.equal(tokenOnly.proposals.length, 1);
  assert.equal(tokenOnly.proposals[0].confidence, 'review', 'iCount + name token is NOT high confidence');
  assert.match(tokenOnly.proposals[0].reason, /iCount לבדו אינו הוכחה/);

  // iCount + identical contact details → strong.
  const strong = buildOrgProposals({
    today: TODAY, gosOrgs: noGos,
    orgs: [
      org({ id: 1, name: 'אלפא', icountId: '999', phone: '03-1234567', address: 'הרצל 1' }),
      org({ id: 2, name: 'ביתא', icountId: '999', phone: '031234567', address: 'הרצל 1' }),
    ],
  });
  assert.equal(strong.proposals[0].confidence, 'high');
});

test('every proposal reports EVERY rule, passed and failed', () => {
  const { proposals } = buildOrgProposals({
    today: TODAY, gosOrgs: noGos,
    orgs: [org({ id: 1, name: 'דלתא', taxId: '512345678' }), org({ id: 2, name: 'דלתא אחר', taxId: '512345678' })],
  });
  const checks = proposals[0].evidence.checks;
  const byRule = Object.fromEntries(checks.map((c) => [c.rule, c]));
  assert.equal(byRule['ח.פ / עוסק מורשה זהה'].passed, true);
  assert.equal(byRule['שם מנורמל זהה'].passed, false, 'and it says so');
  assert.match(byRule['שם מנורמל זהה'].detail, /שמות שונים/);
  assert.equal(byRule['טלפון זהה'].passed, false);
  assert.match(byRule['טלפון זהה'].detail, /אין טלפון/);
  assert.equal(byRule['ארגון תואם קיים ב-GOS'].passed, false);
  // The checklist covers the whole rule set — no silent rules.
  assert.deepEqual(checks.map((c) => c.rule).sort(), [
    'ארגון תואם קיים ב-GOS', 'דומיין אימייל תאגידי משותף', 'חפיפת מילה בשם',
    'ח.פ / עוסק מורשה זהה', 'טלפון זהה', 'כתובת זהה', 'מזהה iCount זהה', 'שם מנורמל זהה',
  ].sort());
});

test('shared non-free email domain is inferred evidence', () => {
  const { proposals } = buildOrgProposals({
    today: TODAY, gosOrgs: noGos,
    orgs: [
      org({ id: 1, name: 'דלתא', domains: ['delta.co.il'] }),
      org({ id: 2, name: 'דלתא,', domains: ['delta.co.il'] }),
    ],
  });
  assert.equal(proposals[0].confidence, 'high');
  assert.ok(proposals[0].evidence.inferred.some((x) => /delta\.co\.il/.test(x)));
});

test('units are proposed from name extension, not keyword lists', () => {
  const { proposals } = buildOrgProposals({
    today: TODAY, gosOrgs: noGos,
    orgs: [
      org({ id: 1, name: 'בנק לאומי', taxId: '520000001', deals: 10 }),
      org({ id: 2, name: 'בנק לאומי סניף רמת גן', taxId: '520000001', deals: 2 }),
      org({ id: 3, name: 'בנק לאומי סניף חיפה', taxId: '520000001', deals: 1 }),
    ],
  });
  const p = proposals[0];
  assert.equal(p.proposedCanonical.name, 'בנק לאומי', 'most deals + shortest name wins');
  // The SUGGESTED unit name is the distinguishing tail, not the parent repeated —
  // and it is only a suggestion: the owner can type anything.
  assert.deepEqual(p.proposedUnits.map((u) => u.name), ['סניף רמת גן', 'סניף חיפה']);
  assert.equal(p.members.find((m) => m.legacyId === 1).role, 'canonical');
  assert.equal(p.members.find((m) => m.legacyId === 2).role, 'unit');
  // Units carry stable keys and each record is assigned to one of them.
  assert.deepEqual(p.proposedUnits.map((u) => u.key), ['u2', 'u3']);
  assert.deepEqual(p.proposedAssignments, { 1: 'organization', 2: 'unit:u2', 3: 'unit:u3' });
});

test('organization type is proposed ONLY from an existing GOS match — never guessed', () => {
  const gosOrgs = {
    byTaxId: new Map([['520000001', { id: 'gos1', name: 'בנק לאומי', organizationTypeId: 't1', organizationTypeLabel: 'בנק' }]]),
    byName: new Map(),
  };
  const { proposals } = buildOrgProposals({
    today: TODAY, gosOrgs,
    orgs: [org({ id: 1, name: 'בנק לאומי', taxId: '520000001' }), org({ id: 2, name: 'בנק לאומי סניף א', taxId: '520000001' })],
  });
  const p = proposals[0];
  assert.equal(p.gosMatch.id, 'gos1');
  assert.equal(p.gosMatch.matchedOn, 'taxId');
  assert.equal(p.proposedCanonical.organizationTypeId, 't1');
  assert.match(p.proposedCanonical.typeReason, /נגזר מהתאמה לארגון קיים/);

  // No GOS match → no type invented, even though the name says "בנק".
  const { proposals: p2 } = buildOrgProposals({
    today: TODAY, gosOrgs: noGos,
    orgs: [org({ id: 1, name: 'בנק כלשהו' }), org({ id: 2, name: 'בנק כלשהו.' })],
  });
  assert.equal(p2[0].proposedCanonical.organizationTypeId, null);
  assert.match(p2[0].proposedCanonical.typeReason, /לא נגזר מהראיות/);
});

test('priority: Tier-2 impact → deals → contacts → size; top25 flags the first 25', () => {
  const orgs = [];
  // 30 low-impact name clusters.
  for (let i = 0; i < 30; i++) {
    orgs.push(org({ id: 100 + i * 2, name: `ארגון ${i}`, deals: 1 }));
    orgs.push(org({ id: 101 + i * 2, name: `ארגון ${i}.`, deals: 1 }));
  }
  // One cluster with real operational impact.
  orgs.push(org({ id: 1, name: 'חשוב', taxId: '520000009', deals: 3, active: 5, tours: 2 }));
  orgs.push(org({ id: 2, name: 'חשוב.', taxId: '520000009', deals: 3 }));

  const { proposals } = buildOrgProposals({ today: TODAY, gosOrgs: noGos, orgs });
  assert.equal(proposals[0].proposedCanonical.name, 'חשוב', 'operational impact ranks first');
  assert.equal(proposals[0].rank, 1);
  assert.equal(proposals[0].operationallyActive, true);
  assert.ok(proposals.slice(0, 25).every((p) => p.top25 === true));
  assert.ok(proposals.slice(25).every((p) => p.top25 === false));
  // Ranks are dense and ordered.
  assert.deepEqual(proposals.map((p) => p.rank).slice(0, 5), [1, 2, 3, 4, 5]);
  // Ordering strictly obeys the approved keys, pairwise.
  const impact = (p) => p.totals.activeDeals + p.totals.futureTourDeals;
  for (let i = 1; i < proposals.length; i++) {
    const a = proposals[i - 1], b = proposals[i];
    assert.ok(
      impact(a) > impact(b) ||
      (impact(a) === impact(b) && (a.totals.deals > b.totals.deals ||
        (a.totals.deals === b.totals.deals))),
      `rank ${i} violates the ordering`,
    );
  }
});

test('the audited (deal-count) top-25 is flagged explicitly, not re-ordered away', () => {
  const orgs = [];
  // A high-deal-count cluster with ZERO operational impact — the audit would rank
  // it #1; the approved ordering puts operational impact first. Both are visible.
  orgs.push(org({ id: 1, name: 'ענק היסטורי', taxId: '520000010', deals: 99 }));
  orgs.push(org({ id: 2, name: 'ענק היסטורי.', taxId: '520000010', deals: 99 }));
  orgs.push(org({ id: 3, name: 'קטן פעיל', taxId: '520000011', deals: 1, active: 1 }));
  orgs.push(org({ id: 4, name: 'קטן פעיל.', taxId: '520000011', deals: 1 }));

  const { proposals, stats } = buildOrgProposals({ today: TODAY, gosOrgs: noGos, orgs });
  assert.equal(proposals[0].proposedCanonical.name, 'קטן פעיל', 'impact-first ordering wins the rank');
  assert.equal(proposals[0].auditedTop25, true);
  const giant = proposals.find((p) => p.proposedCanonical.name === 'ענק היסטורי');
  assert.equal(giant.rank, 2, 'ranked second by the approved keys');
  assert.equal(giant.auditedTop25, true, 'still flagged as an audited top-25 cluster');
  assert.equal(stats.auditedTop25InFirst25, 2, 'reported honestly');
});

test('missing information is reported explicitly', () => {
  const { proposals } = buildOrgProposals({
    today: TODAY, gosOrgs: noGos,
    orgs: [org({ id: 1, name: 'ללא פרטים' }), org({ id: 2, name: 'ללא פרטים.' })],
  });
  assert.deepEqual(proposals[0].evidence.missing, ['ח.פ / עוסק מורשה', 'כתובת', 'טלפון', 'דומיין אימייל', 'אנשי קשר']);
});

test('Tier-2 activity + future tour detection', () => {
  assert.equal(isActiveDeal({ status: 'open' }, TODAY), true);
  assert.equal(isActiveDeal({ status: 'lost' }, TODAY), false);
  assert.equal(isActiveDeal({ status: 'won', [DEAL_TOURDATE]: '2026-09-01' }, TODAY), true);
  assert.equal(isActiveDeal({ status: 'won', [DEAL_TOURDATE]: '2020-01-01' }, TODAY), false);
  assert.equal(isActiveDeal({ status: 'lost', undone_activities_count: 2 }, TODAY), true);
  assert.equal(isActiveDeal({ status: 'lost', next_activity_date: '2026-12-01' }, TODAY), true);
  assert.equal(hasFutureTour({ [DEAL_TOURDATE]: '2026-09-01' }, TODAY), true);
  assert.equal(hasFutureTour({ [DEAL_TOURDATE]: '2024-09-01' }, TODAY), false);
});

test('singletons are never proposed; subject keys are stable', () => {
  const { proposals, stats } = buildOrgProposals({
    today: TODAY, gosOrgs: noGos,
    orgs: [org({ id: 1, name: 'יחיד' }), org({ id: 2, name: 'אחר' })],
  });
  assert.equal(proposals.length, 0, 'no cluster → no proposal');
  assert.equal(stats.organizations, 2);

  const { proposals: p2 } = buildOrgProposals({
    today: TODAY, gosOrgs: noGos,
    orgs: [org({ id: 1, name: 'זהה', taxId: '512345678' }), org({ id: 2, name: 'זהה2', taxId: '512345678' })],
  });
  assert.equal(subjectKeyFor(p2[0]), 'org:taxId:512345678');
  // Stable across runs.
  const { proposals: p3 } = buildOrgProposals({
    today: TODAY, gosOrgs: noGos,
    orgs: [org({ id: 2, name: 'זהה2', taxId: '512345678' }), org({ id: 1, name: 'זהה', taxId: '512345678' })],
  });
  assert.equal(subjectKeyFor(p3[0]), subjectKeyFor(p2[0]));
});
