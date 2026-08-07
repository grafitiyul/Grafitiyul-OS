// The merge RESOLUTION contract — pure, no database.
//
// Every rule about "what happens to this value when two deals become one"
// lives in mergeResolve.js, so this suite is where the policy is actually
// proven. The orchestration test (dealMerge.test.js) proves the sequencing;
// the DMMF walk (dealMerge.prismaShape.test.js) proves the field names.
//
// Cases here map directly onto the agreed test matrix: 1-8, 11-12, 16-18.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MERGE_FIELDS,
  isEmptyValue,
  sameValue,
  resolveField,
  resolveFields,
  resolveParticipants,
  resolveStatus,
  hasCommercialContent,
  commercialSituation,
  lineIdentity,
  composeMergedLines,
  buildCombineCandidates,
  resolveContacts,
  suggestTaskActions,
  resolveTaskAction,
} from './mergeResolve.js';

const field = (key) => MERGE_FIELDS.find((f) => f.key === key);

// ── emptiness + equality ────────────────────────────────────────────────────

test('0 is empty only where a zero carries no information', () => {
  assert.equal(isEmptyValue(0), false, 'a plain 0 is a real value');
  assert.equal(isEmptyValue(0, { zeroIsEmpty: true }), true, 'a zero COUNT is "not filled in"');
  assert.equal(isEmptyValue(''), true);
  assert.equal(isEmptyValue('   '), true);
  assert.equal(isEmptyValue(false), false, 'false is a decision, never emptiness');
  assert.equal(isEmptyValue(null), true);
});

test('values compare across representations, so no phantom conflicts', () => {
  assert.equal(sameValue(120000n, 120000), true, 'BigInt total vs its Number twin');
  assert.equal(sameValue(new Date('2026-09-10'), '2026-09-10T00:00:00.000Z'), true);
  assert.equal(sameValue(null, undefined), true);
  assert.equal(sameValue('a', 'b'), false);
});

// ── field resolution (matrix 6, and the auto-resolve rule) ──────────────────

test('one side empty resolves automatically, never as a question', () => {
  const r = resolveField(field('tourDate'), { tourDate: null }, { tourDate: '2026-09-10' });
  assert.equal(r.resolution, 'other_only');
  assert.equal(r.value, '2026-09-10');
});

test('both sides equal keeps the value and asks nothing', () => {
  const r = resolveField(field('tourDate'), { tourDate: '2026-09-10' }, { tourDate: '2026-09-10' });
  assert.equal(r.resolution, 'equal');
  assert.equal(r.value, '2026-09-10');
});

test('both sides set and different is a CONFLICT, defaulting to the survivor', () => {
  const r = resolveField(field('tourDate'), { tourDate: '2026-09-10' }, { tourDate: '2026-10-01' });
  assert.equal(r.resolution, 'conflict');
  assert.equal(r.value, '2026-09-10', 'unanswered conflicts never invent a value');
  const answered = resolveField(field('tourDate'), { tourDate: '2026-09-10' }, { tourDate: '2026-10-01' }, 'other');
  assert.equal(answered.value, '2026-10-01');
});

test('a dependent field is dragged to its parent\'s side, never paired wrongly', () => {
  // Organization A with organization B's branch is a state the CRM cannot
  // represent — the child must follow whichever organization won.
  const survivor = { organizationId: 'orgA', organizationUnitId: 'unitA' };
  const other = { organizationId: 'orgB', organizationUnitId: 'unitB' };
  const res = resolveFields(survivor, other, { organizationId: 'other' });
  assert.equal(res.patch.organizationId, 'orgB');
  assert.equal(res.patch.organizationUnitId, 'unitB', 'the unit followed its organization');
  const unit = res.fields.find((f) => f.key === 'organizationUnitId');
  assert.equal(unit.forcedBy, 'organizationId');
  assert.equal(unit.resolution, 'resolved_by_parent', 'no longer an open question');
});

test('unanswered conflicts are reported so the merge can be blocked', () => {
  const res = resolveFields(
    { tourDate: '2026-09-10', tourTime: '10:00' },
    { tourDate: '2026-10-01', tourTime: '10:00' },
  );
  assert.equal(res.unanswered.length, 1);
  assert.equal(res.unanswered[0].key, 'tourDate');
});

test('fields empty on BOTH sides are never written', () => {
  const res = resolveFields({ source: null }, { source: null });
  assert.ok(!('source' in res.patch), 'nothing to say means nothing to write');
});

// ── participants (matrix 7, 8) ──────────────────────────────────────────────

test('participants: 0 vs non-zero resolves silently to the non-zero side', () => {
  assert.deepEqual(
    resolveParticipants(0, 12),
    { resolution: 'other_only', value: 12, needsChoice: false },
  );
  assert.deepEqual(
    resolveParticipants(12, 0),
    { resolution: 'survivor_only', value: 12, needsChoice: false },
  );
});

test('participants: equal counts keep the value with no prompt', () => {
  const r = resolveParticipants(12, 12);
  assert.equal(r.resolution, 'equal');
  assert.equal(r.needsChoice, false);
  assert.equal(r.value, 12);
});

test('participants: two different non-zero counts ALWAYS ask', () => {
  const r = resolveParticipants(12, 8);
  assert.equal(r.resolution, 'conflict');
  assert.equal(r.needsChoice, true, 'combining is never assumed — it may be the same people twice');
  assert.deepEqual(r.options, { survivor: 12, other: 8, combined: 20 });
});

test('participants: every option resolves to the number it promises', () => {
  assert.equal(resolveParticipants(12, 8, 'survivor').value, 12);
  assert.equal(resolveParticipants(12, 8, 'other').value, 8);
  assert.equal(resolveParticipants(12, 8, 'combined').value, 20);
  assert.equal(resolveParticipants(12, 8, 'custom', 15).value, 15);
});

test('participants: a custom choice with no number stays unanswered', () => {
  const r = resolveParticipants(12, 8, 'custom', null);
  assert.equal(r.value, null);
  assert.equal(r.needsChoice, true, 'an empty box is not an answer');
});

// ── status (matrix 11, 12) ──────────────────────────────────────────────────

test('status: WON + OPEN defaults to WON — the real business state', () => {
  const r = resolveStatus('open', 'won');
  assert.equal(r.suggested, 'won');
  assert.equal(r.value, 'won');
  assert.equal(r.differs, true);
  assert.equal(r.needsChoice, true, 'shown to the operator, never silent');
  assert.equal(r.triggersWonTransition, true, 'the survivor was OPEN, so WON is a real transition');
});

test('status: WON + WON fires NO transition (no duplicate lifecycle effects)', () => {
  const r = resolveStatus('won', 'won');
  assert.equal(r.value, 'won');
  assert.equal(r.differs, false);
  assert.equal(r.needsChoice, false);
  assert.equal(r.triggersWonTransition, false, 'already WON — nothing to fire again');
});

test('status: a WON survivor absorbing an OPEN deal stays WON without re-firing', () => {
  const r = resolveStatus('won', 'open');
  assert.equal(r.value, 'won');
  assert.equal(r.triggersWonTransition, false);
});

test('status: OPEN + LOST keeps the live deal alive', () => {
  assert.equal(resolveStatus('open', 'lost').suggested, 'open');
  assert.equal(resolveStatus('lost', 'open').suggested, 'open');
});

test('status: the operator can override the suggestion', () => {
  const r = resolveStatus('open', 'won', 'lost');
  assert.equal(r.value, 'lost', 'the business reality may genuinely differ');
  assert.equal(r.triggersWonTransition, false);
});

// ── commercial (matrix 4, 5, 6) ─────────────────────────────────────────────

const line = (over = {}) => ({
  id: over.id || 'l1', kind: 'product', label: 'סיור', quantity: 1,
  unitPriceMinor: 100000, active: true, sourceKind: 'price_rule',
  sourceCardGroupId: 'card1', ticketTypeId: null, productVariantId: 'v1', ...over,
});

test('commercial content is value OR builder, never only one of them', () => {
  assert.equal(hasCommercialContent({ valueMinor: 0, lines: [] }), false);
  assert.equal(hasCommercialContent({ valueMinor: 120000, lines: [] }), true, 'a migrated headline total counts');
  assert.equal(hasCommercialContent({ valueMinor: 0, lines: [line()] }), true, 'a priced-but-unsaved builder counts');
});

test('commercial: one side at zero resolves automatically to the other', () => {
  const r = commercialSituation({ valueMinor: 0, lines: [] }, { valueMinor: 120000, lines: [line()] });
  assert.equal(r.situation, 'other_only');
  assert.equal(r.resolution, 'other');
  assert.equal(r.needsChoice, false, 'no unnecessary confirmation — the spec\'s own rule');
});

test('commercial: BOTH meaningful always asks, and never defaults', () => {
  const r = commercialSituation(
    { valueMinor: 120000, lines: [line()] },
    { valueMinor: 90000, lines: [line({ id: 'l2' })] },
  );
  assert.equal(r.situation, 'both_meaningful');
  assert.equal(r.resolution, null, 'totals are NEVER added together on their own');
  assert.equal(r.needsChoice, true);
});

test('line identity is structural, never the label text', () => {
  const a = line({ id: 'a', label: 'סיור גרפיטי' });
  const b = line({ id: 'b', label: 'שם אחר לגמרי' });
  assert.equal(lineIdentity(a), lineIdentity(b), 'same card + ticket + variant = the same commercial thing');
  const c = line({ id: 'c', label: 'סיור גרפיטי', ticketTypeId: 'tt2' });
  assert.notEqual(lineIdentity(a), lineIdentity(c));
});

test('combine candidates: duplicates from the other deal arrive UNSELECTED', () => {
  const survivorLines = [line({ id: 's1' })];
  const otherLines = [line({ id: 'o1' }), line({ id: 'o2', ticketTypeId: 'tt2', sourceCardGroupId: 'card2' })];
  const cands = buildCombineCandidates(survivorLines, otherLines);
  const dup = cands.find((c) => c.id === 'o1');
  const uniq = cands.find((c) => c.id === 'o2');
  assert.equal(dup.duplicate, true);
  assert.equal(dup.defaultSelected, false, 'double-counting requires a deliberate tick');
  assert.equal(uniq.duplicate, false);
  assert.equal(uniq.defaultSelected, true);
  assert.equal(cands.find((c) => c.id === 's1').defaultSelected, true, 'the survivor keeps its own lines');
});

test('combine: resolved discount rows never travel (they are regenerated)', () => {
  const cands = buildCombineCandidates(
    [line({ id: 's1' }), line({ id: 'sd', kind: 'discount', sourceKind: 'deal_discount' })],
    [],
  );
  assert.equal(cands.find((c) => c.id === 'sd').selectable, false);
  const rows = composeMergedLines({
    resolution: 'survivor',
    survivorLines: [line({ id: 's1' }), line({ id: 'sd', kind: 'discount', sourceKind: 'deal_discount' })],
  });
  assert.equal(rows.length, 1, 'the discount row is dropped — it comes back from its intent');
});

test('a product line carried from the OTHER deal is frozen, never re-priced', () => {
  const rows = composeMergedLines({
    resolution: 'combine',
    survivorLines: [line({ id: 's1' })],
    otherLines: [line({ id: 'o1', sourceCardGroupId: 'card2', unitPriceMinor: 77000 })],
    keepLineIds: ['s1', 'o1'],
  });
  const [survivorRow, otherRow] = rows;
  assert.equal(survivorRow.kind, 'product', 'the survivor keeps its engine-priced product line');
  assert.equal(otherRow.kind, 'manual', 'the imported product line becomes a frozen commercial line');
  assert.equal(otherRow.overridden, true, 'so builderCompose cannot re-price it');
  assert.equal(otherRow.unitPriceMinor, 77000, 'to the agora — the money is preserved exactly');
  assert.equal(otherRow._demoted, true);
});

test('never two primary product lines (the builder route refuses that state)', () => {
  const rows = composeMergedLines({
    resolution: 'combine',
    survivorLines: [line({ id: 's1' }), line({ id: 's2', sourceCardGroupId: 'card2' })],
    otherLines: [],
    keepLineIds: ['s1', 's2'],
  });
  assert.equal(rows.filter((r) => r.kind === 'product').length, 1);
});

test('combine keeps ONLY the selected lines', () => {
  const rows = composeMergedLines({
    resolution: 'combine',
    survivorLines: [line({ id: 's1' }), line({ id: 's2', sourceCardGroupId: 'c2' })],
    otherLines: [line({ id: 'o1', sourceCardGroupId: 'c3' })],
    keepLineIds: ['s1', 'o1'],
  });
  assert.deepEqual(rows.map((r) => r._sourceLineId), ['s1', 'o1']);
  assert.deepEqual(rows.map((r) => r.sortOrder), [0, 1], 'ordering is re-based, never inherited');
});

// ── open tasks ──────────────────────────────────────────────────────────────

const task = (over) => ({ id: 't1', title: 'שיחה ראשונית', taskTypeId: 'tt_first_call', dueDate: null, ...over });

test('real work MOVES to the survivor by default', () => {
  const [s] = suggestTaskActions([], [task({ id: 'x', title: 'להחזיר טלפון', taskTypeId: 'tt_call' })]);
  assert.equal(s.suggested, 'move');
  assert.equal(s.duplicate, false);
});

test('an AUTOMATIC task the survivor already has open defaults to close-as-duplicate', () => {
  // The production finding: merging two fresh leads left the survivor with two
  // identical "שיחה ראשונית" tasks, breaking autoTasks' own one-per-deal rule.
  const [s] = suggestTaskActions([task({ id: 'own' })], [task({ id: 'other' })]);
  assert.equal(s.duplicate, true);
  assert.equal(s.suggested, 'close_duplicate');
  assert.ok(s.reasonHe, 'the operator is told WHY it is proposed as a duplicate');
});

test('the same TYPE is what makes a duplicate, not a similar title', () => {
  const [s] = suggestTaskActions(
    [task({ id: 'own', title: 'שיחה ראשונית', taskTypeId: 'tt_first_call' })],
    [task({ id: 'other', title: 'שיחה ראשונית עם הלקוח', taskTypeId: 'tt_first_call' })],
  );
  assert.equal(s.suggested, 'close_duplicate', 'differently worded, same type → still one obligation');
});

test('typeless tasks fall back to an EXACT title match, never a fuzzy one', () => {
  const exact = suggestTaskActions(
    [{ id: 'a', title: 'לתאם מדריך', taskTypeId: null }],
    [{ id: 'b', title: 'לתאם מדריך', taskTypeId: null }],
  );
  assert.equal(exact[0].suggested, 'close_duplicate');
  const similar = suggestTaskActions(
    [{ id: 'a', title: 'לתאם מדריך', taskTypeId: null }],
    [{ id: 'b', title: 'לתאם מדריך לסיור השני', taskTypeId: null }],
  );
  assert.equal(similar[0].suggested, 'move', 'guessing would close real work by accident');
});

test('the operator always overrides the suggestion', () => {
  const [s] = suggestTaskActions([task({ id: 'own' })], [task({ id: 'other' })]);
  assert.equal(resolveTaskAction(s, undefined), 'close_duplicate', 'the suggestion applies when unanswered');
  assert.equal(resolveTaskAction(s, 'move'), 'move');
  assert.equal(resolveTaskAction(s, 'keep'), 'keep');
  assert.equal(resolveTaskAction(s, 'nonsense'), 'close_duplicate', 'an unknown choice falls back, never crashes');
});

test('with no suggestion at all the default is still to move', () => {
  assert.equal(resolveTaskAction(undefined, undefined), 'move');
});

// ── contacts (matrix 16, 17) ────────────────────────────────────────────────

const link = (over = {}) => ({
  id: over.id || 'dc1', contactId: over.contactId || 'c1', roles: [],
  isPrimary: false, receiveConfirmations: false, receiveOperationalUpdates: false,
  receivePaymentLinks: false, receiveQuotes: false, ...over,
});

test('contacts union by contactId, with exactly ONE primary', () => {
  const r = resolveContacts(
    [link({ id: 'a1', contactId: 'c1', isPrimary: true })],
    [link({ id: 'b1', contactId: 'c2', isPrimary: true })],
  );
  assert.equal(r.links.length, 2);
  assert.equal(r.primaryContactId, 'c1', 'the survivor\'s primary stays primary by default');
  assert.equal(r.links.filter((l) => l.isPrimary).length, 1, 'two primaries is not a representable state');
  assert.equal(r.added.length, 1);
  assert.equal(r.primaryConflict, true, 'the operator is told the other deal named someone else');
});

test('the same contact on both deals is deduped, not linked twice', () => {
  const r = resolveContacts(
    [link({ id: 'a1', contactId: 'c1', isPrimary: true, roles: ['payer'] })],
    [link({ id: 'b1', contactId: 'c1', roles: ['coordinator'], receiveConfirmations: true })],
  );
  assert.equal(r.links.length, 1);
  assert.deepEqual(r.links[0].roles.sort(), ['coordinator', 'payer'], 'roles union');
  assert.equal(r.links[0].receiveConfirmations, true, 'routing flags OR — never silently dropped');
  assert.equal(r.links[0].existingLinkId, 'a1', 'the survivor\'s own row is updated, not duplicated');
});

test('the primary can be overridden before confirmation', () => {
  const r = resolveContacts(
    [link({ id: 'a1', contactId: 'c1', isPrimary: true })],
    [link({ id: 'b1', contactId: 'c2', isPrimary: true })],
    'c2',
  );
  assert.equal(r.primaryContactId, 'c2');
  assert.equal(r.links.find((l) => l.contactId === 'c1').isPrimary, false);
});

test('a survivor with no contacts adopts the other deal\'s primary', () => {
  const r = resolveContacts([], [link({ id: 'b1', contactId: 'c2', isPrimary: true })]);
  assert.equal(r.primaryContactId, 'c2');
  assert.equal(r.primaryConflict, false, 'nothing conflicted — there was nothing to conflict with');
});

test('no contacts at all is a valid outcome, not a crash', () => {
  const r = resolveContacts([], []);
  assert.equal(r.primaryContactId, null);
  assert.deepEqual(r.links, []);
});
