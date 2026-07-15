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

// The normaliser is intentionally byte-identical to the audit's, INCLUDING its
// quirk: Hebrew corporate suffixes are NOT stripped (punctuation is removed first
// and JS \b never matches beside Hebrew), so only Latin suffixes are removed.
// These tests pin that behaviour so nobody "fixes" it and breaks reconciliation
// with the approved 169 clusters.
test('normalisation is byte-identical to the audit (incl. its Hebrew-suffix quirk)', () => {
  assert.equal(normName('Acme Ltd.'), 'acme', 'Latin suffixes ARE stripped');
  assert.equal(normName('Acme Ltd'), normName('Acme Inc'), 'Latin variants collapse together');
  assert.equal(normName('  ביתא   '), 'ביתא', 'whitespace collapses');
  assert.equal(normName('ביתא.'), normName('ביתא'), 'punctuation is stripped');
  // The quirk, pinned deliberately:
  assert.equal(normName('בנק לאומי בע"מ'), 'בנק לאומי בע מ');
  assert.notEqual(normName('בנק לאומי בע"מ'), normName('בנק לאומי'));
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
  assert.deepEqual(p.proposedUnits.map((u) => u.name), ['בנק לאומי סניף רמת גן', 'בנק לאומי סניף חיפה']);
  assert.equal(p.members.find((m) => m.legacyId === 1).role, 'canonical');
  assert.equal(p.members.find((m) => m.legacyId === 2).role, 'unit');
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
  assert.deepEqual(proposals[0].evidence.missing, ['ח.פ / עוסק מורשה', 'כתובת', 'טלפון', 'דומיין אימייל']);
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
