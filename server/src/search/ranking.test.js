import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dealGroupRank,
  compareHits,
  scoreOf,
  bestReason,
  tierFor,
  isoDaysAgo,
  MATCH_SCORE,
  IDENTIFIER_TIER_MIN,
} from './ranking.js';

const TODAY = '2026-07-15';

function hit(score, groupRank, updatedAt = 0) {
  return { score, groupRank, updatedAt };
}

test('isoDaysAgo walks back across month boundaries', () => {
  assert.equal(isoDaysAgo('2026-07-15', 62), '2026-05-14');
  assert.equal(isoDaysAgo('2026-01-01', 1), '2025-12-31');
});

// --- business grouping (spec: open > won+future > won+recent > rest) ---

test('open deal is group 0 regardless of tours', () => {
  assert.equal(dealGroupRank({ status: 'open' }, [], TODAY), 0);
  assert.equal(dealGroupRank({ status: 'open' }, ['2020-01-01'], TODAY), 0);
});

test('WON with a future tour is group 1', () => {
  assert.equal(dealGroupRank({ status: 'won' }, ['2026-09-01'], TODAY), 1);
});

test('a tour dated today counts as future, not past', () => {
  assert.equal(dealGroupRank({ status: 'won' }, [TODAY], TODAY), 1);
});

test('WON whose latest tour ended within 2 months is group 2', () => {
  assert.equal(dealGroupRank({ status: 'won' }, ['2026-06-01'], TODAY), 2);
});

test('WON with an older tour falls to group 3', () => {
  assert.equal(dealGroupRank({ status: 'won' }, ['2026-01-01'], TODAY), 3);
});

test('the 2-month boundary is inclusive on the cutoff day', () => {
  const cutoff = isoDaysAgo(TODAY, 62);
  assert.equal(dealGroupRank({ status: 'won' }, [cutoff], TODAY), 2);
  assert.equal(dealGroupRank({ status: 'won' }, [isoDaysAgo(TODAY, 63)], TODAY), 3);
});

test('a future tour wins even when an older tour also exists', () => {
  assert.equal(dealGroupRank({ status: 'won' }, ['2020-01-01', '2026-09-01'], TODAY), 1);
});

test('WON with no tour, and lost deals, are group 3', () => {
  assert.equal(dealGroupRank({ status: 'won' }, [], TODAY), 3);
  assert.equal(dealGroupRank({ status: 'lost' }, ['2026-09-01'], TODAY), 3);
});

// --- scoring ---

test('a hit scores as its STRONGEST reason', () => {
  const reasons = [{ key: 'note_partial' }, { key: 'phone_exact' }, { key: 'title_partial' }];
  assert.equal(scoreOf(reasons), MATCH_SCORE.phone_exact);
  assert.equal(bestReason(reasons).key, 'phone_exact');
});

test('identifier reasons sit in tier 0, text reasons in tier 1', () => {
  for (const k of ['deal_number_exact', 'phone_exact', 'email_exact', 'name_exact', 'tax_id_exact']) {
    assert.equal(tierFor(MATCH_SCORE[k]), 0, `${k} should be an identifier`);
  }
  for (const k of ['title_partial', 'note_partial', 'timeline_partial', 'legacy_partial', 'name_prefix']) {
    assert.equal(tierFor(MATCH_SCORE[k]), 1, `${k} should be text-tier`);
  }
  assert.equal(MATCH_SCORE.name_prefix < IDENTIFIER_TIER_MIN, true);
});

// --- the comparator: the rule the spec calls out explicitly ---

test('an exact identifier match on an OLD deal beats a weak text match on an OPEN deal', () => {
  const exactOnOldLost = hit(MATCH_SCORE.deal_number_exact, 3);
  const noteOnOpen = hit(MATCH_SCORE.note_partial, 0);
  assert.equal(compareHits(exactOnOldLost, noteOnOpen) < 0, true);
});

test('within TEXT matches, business group leads over score', () => {
  const weakOnOpen = hit(MATCH_SCORE.note_partial, 0);
  const strongOnOld = hit(MATCH_SCORE.title_prefix, 3);
  assert.equal(compareHits(weakOnOpen, strongOnOld) < 0, true);
});

test('within TEXT matches in the SAME group, score leads', () => {
  const strong = hit(MATCH_SCORE.title_prefix, 1);
  const weak = hit(MATCH_SCORE.note_partial, 1);
  assert.equal(compareHits(strong, weak) < 0, true);
});

test('within IDENTIFIER matches, score leads and group only breaks ties', () => {
  const dealNoOnOld = hit(MATCH_SCORE.deal_number_exact, 3);
  const phoneOnOpen = hit(MATCH_SCORE.phone_exact, 0);
  assert.equal(compareHits(dealNoOnOld, phoneOnOpen) < 0, true);

  const openExact = hit(MATCH_SCORE.phone_exact, 0);
  const oldExact = hit(MATCH_SCORE.phone_exact, 3);
  assert.equal(compareHits(openExact, oldExact) < 0, true);
});

test('all else equal, the more recently updated wins', () => {
  assert.equal(compareHits(hit(50, 1, 2000), hit(50, 1, 1000)) < 0, true);
});

test('full sort reproduces the spec ordering end-to-end', () => {
  const hits = [
    { name: 'note-on-open', ...hit(MATCH_SCORE.note_partial, 0) },
    { name: 'exact-deal-no-on-old', ...hit(MATCH_SCORE.deal_number_exact, 3) },
    { name: 'title-on-won-future', ...hit(MATCH_SCORE.title_prefix, 1) },
    { name: 'legacy-on-won-recent', ...hit(MATCH_SCORE.legacy_partial, 2) },
    { name: 'exact-phone-on-open', ...hit(MATCH_SCORE.phone_exact, 0) },
  ];
  const order = hits.sort(compareHits).map((h) => h.name);
  assert.deepEqual(order, [
    'exact-deal-no-on-old', // identifiers first, strongest first
    'exact-phone-on-open',
    'note-on-open', // then text hits, in business-group order
    'title-on-won-future',
    'legacy-on-won-recent',
  ]);
});
