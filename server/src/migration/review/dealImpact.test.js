import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDealDeletionImpact, dealSubjectKey, dealIdFromSubjectKey } from './dealImpact.js';
import { resolveNameResult, nameDraftFromProposal, buildNameCleanupProposals } from './nameCleanup.js';

// SYNTHETIC fixtures — this repo is public.

test('deleting a junk deal reports the FULL graph consequence and blocks NOTHING', () => {
  // The vmxfhv shape: a 0-value WON deal whose only contact is the junk record.
  const impact = computeDealDeletionImpact({
    deal: { id: 7086, title: 'junk -', status: 'won', value: 0, wonTime: '2022-05-30', personId: 16475, orgId: null, activityCount: 0, noteCount: 0, fileCount: 0 },
    linkedPersons: [{ legacyId: 16475, name: 'junkname', relationship: 'primary', otherDeals: { open: 0, won: 0, lost: 0 }, otherHistory: 0, imported: 'excluded' }],
    orgOtherDeals: null,
  });
  assert.deepEqual(impact.blocking, [], 'the report IS the safety mechanism — nothing blocks');
  const c = impact.contacts[0];
  assert.equal(c.becomesDeletable, true, 'losing its only WON link makes the junk contact deletable');
  assert.equal(c.becomesShell, true);
  assert.ok(impact.consequences.some((x) => /ניתן יהיה למחוק/.test(x)));
  assert.ok(impact.consequences.some((x) => /לא נמחק שום מידע תפעולי/.test(x)));
  assert.ok(impact.consequences.some((x) => /אף עסקה מיובאת אחרת אינה מושפעת/.test(x)));
});

test('a contact protected by OTHER deals — or already imported — is reported as safe', () => {
  const impact = computeDealDeletionImpact({
    deal: { id: 1, title: 'x', status: 'won', personId: 5, orgId: 9, orgName: 'ארגון', activityCount: 3, noteCount: 1, fileCount: 0 },
    linkedPersons: [
      { legacyId: 5, name: 'מוגן', relationship: 'primary', otherDeals: { open: 1, won: 2, lost: 0 }, otherHistory: 4, imported: 'not_imported' },
      { legacyId: 6, name: 'מיובא', relationship: 'participant', otherDeals: { open: 0, won: 0, lost: 0 }, otherHistory: 0, imported: 'contact' },
    ],
    orgOtherDeals: 7,
  });
  assert.equal(impact.contacts[0].becomesDeletable, false, 'other WON/OPEN deals still protect');
  assert.equal(impact.contacts[1].becomesDeletable, false, 'an imported contact is never made deletable by a deal decision');
  assert.ok(impact.consequences.some((x) => /כבר יובא כאיש קשר/.test(x)));
  assert.ok(impact.consequences.some((x) => /נשאר עם 7 עסקאות/.test(x)));
  assert.ok(impact.consequences.some((x) => /3 פעילויות, 1 הערות/.test(x)));
});

test('deal subject keys round-trip', () => {
  assert.equal(dealSubjectKey(7086), 'deal:7086');
  assert.equal(dealIdFromSubjectKey('deal:7086'), 7086);
  assert.equal(dealIdFromSubjectKey('name:7086'), null);
});

// ── THE CASCADE — a dead deal no longer blocks its contact's deletion ─────────
const c = (o) => ({
  legacyId: o.id, name: o.name ?? `${o.first || ''} ${o.last || ''}`.trim(),
  firstName: o.first ?? null, lastName: o.last ?? null,
  phones: [], emails: [], orgId: null, orgName: null,
  dealCount: o.deals ?? (o.won || 0), openDealCount: 0, futureTourDeals: 0, wonRecentDealCount: 0,
  activityCount: 0, noteCount: 0, fileCount: 0, participantCount: 0,
  dealStatusCounts: { open: 0, won: o.won || 0, lost: 0 },
  participantStatusCounts: { open: 0, won: 0, lost: 0 },
  primaryDeals: o.primaryDeals || [], participantDeals: [],
});

test('the boundary subtracts owner-deleted deals — but ONLY ones visible in the detail list', () => {
  const { proposals } = buildNameCleanupProposals({
    contacts: [c({ id: 16475, first: '', last: 'junkname', won: 1, primaryDeals: [{ id: 7086, status: 'won', title: 'junk' }] })],
  });
  const p = proposals[0];
  const draft = { ...nameDraftFromProposal(p, null), treatment: 'deleted' };

  // Without the deal decision: blocked by the WON link.
  assert.equal(resolveNameResult(p, draft).valid, false);
  // The owner deleted the deal → the WON protection is gone → deletable.
  const after = resolveNameResult(p, draft, { deadDealIds: new Set([7086]) });
  assert.equal(after.valid, true, 'a dead deal protects nothing');

  // Fail-safe: a WON deal NOT visible in the (capped) list keeps blocking even if
  // its id is marked dead — the boundary can never under-count.
  const hidden = buildNameCleanupProposals({
    contacts: [c({ id: 2, first: '', last: 'אחר', won: 2, primaryDeals: [{ id: 7086, status: 'won', title: 'junk' }] })], // 2 WON, list shows 1
  }).proposals[0];
  const still = resolveNameResult(hidden, { ...nameDraftFromProposal(hidden, null), treatment: 'deleted' }, { deadDealIds: new Set([7086, 9999]) });
  assert.equal(still.valid, false, 'the unlisted WON deal still blocks');
});
