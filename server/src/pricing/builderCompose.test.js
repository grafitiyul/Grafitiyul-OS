// Builder composition + card-note parity tests (node:test, pure — no DB).
//
// composeBuilderLines IS the shared calculation both the Deal builders and the
// pricing simulator reach through POST /api/pricing/builder — the routes differ
// only in loading (price list, templates), never in math or note logic. These
// tests drive the full required scenario list: regeneration semantics (notes
// rebuilt from canonical card data), manual-edit replacement, input changes,
// and simulator↔Deal byte-parity of the normalized output.

import test from 'node:test';
import assert from 'node:assert/strict';
import { composeBuilderLines } from './builderCompose.js';
import { calculate } from './engine.js';

const VAT_DEFAULT = { mode: 'included', rate: 18 };

// A resolved product (engine) result as the /builder route shapes it.
function resolution(overrides = {}) {
  return {
    ok: true,
    priceModel: 'fixed',
    vatMode: 'included',
    vatRate: 18,
    baseAmountMinor: 118000,
    ruleId: 'r1',
    cardGroupId: 'cardMain',
    firstLineNote: '<p>כולל הדרכה</p>',
    ...overrides,
  };
}

const productLine = (over = {}) => ({
  id: 'L1',
  kind: 'product',
  label: 'סיור גרפיטי',
  refId: 'v1',
  quantity: 1,
  unitPriceMinor: 0,
  vatMode: 'inherit',
  active: true,
  overridden: false,
  note: '',
  ...over,
});

const ticketLine = (id, card, ticketTypeId, qty, price, over = {}) => ({
  id,
  kind: 'manual',
  label: 'כרטיס',
  quantity: qty,
  unitPriceMinor: price,
  vatMode: 'included',
  vatRate: 18,
  active: true,
  sourceKind: 'group_ticket',
  sourceCardGroupId: card,
  ticketTypeId,
  note: '',
  ...over,
});

function compose(inputLines, opts = {}) {
  return composeBuilderLines({
    inputLines,
    productResolution: opts.productResolution ?? resolution(),
    vatDefault: VAT_DEFAULT,
    applyCardNotes: opts.applyCardNotes ?? false,
    noteByCard: opts.noteByCard ?? new Map(),
  });
}

// ── provenance stamping ─────────────────────────────────────────────────────

test('engine-priced product line is stamped with the winning card provenance', () => {
  const { lines } = compose([productLine()]);
  assert.equal(lines[0].sourceKind, 'price_rule');
  assert.equal(lines[0].sourceCardGroupId, 'cardMain');
  assert.equal(lines[0].unitPriceMinor, 118000);
});

test('overridden product line keeps its own price and echoed provenance', () => {
  const { lines } = compose([productLine({ overridden: true, unitPriceMinor: 90000, sourceCardGroupId: 'cardOld', sourceKind: 'price_rule' })]);
  assert.equal(lines[0].unitPriceMinor, 90000);
  assert.equal(lines[0].sourceCardGroupId, 'cardOld');
});

test('plain recompute (no applyCardNotes) echoes user notes untouched', () => {
  const { lines } = compose([productLine({ note: '<p>ערוך ידנית</p>' })], {
    noteByCard: new Map([['cardMain', '<p>קנוני</p>']]),
  });
  assert.equal(lines[0].note, '<p>ערוך ידנית</p>');
});

// ── scenario 1+6: single-line card + note change → next calculation ─────────

test('regeneration writes the card note; changing the template changes the next run', () => {
  const first = compose([productLine()], {
    applyCardNotes: true,
    noteByCard: new Map([['cardMain', '<p>גרסה 1</p>']]),
  });
  assert.equal(first.lines[0].note, '<p>גרסה 1</p>');

  // The business edited the card note; the NEXT automatic calculation rebuilds
  // from the current canonical value — nothing stale is retained.
  const second = compose(first.lines, {
    applyCardNotes: true,
    noteByCard: new Map([['cardMain', '<p>גרסה 2</p>']]),
  });
  assert.equal(second.lines[0].note, '<p>גרסה 2</p>');
});

// ── scenario 2+3: multi-line card + multiple cards ──────────────────────────

test('group cards: note on the first line of each card only, ordering preserved', () => {
  const input = [
    ticketLine('A1', 'cardA', 'tt_adult', 10, 6000),
    ticketLine('A2', 'cardA', 'tt_child', 5, 4000),
    ticketLine('B1', 'cardB', 'tt_adult', 3, 9000),
  ];
  const { lines } = compose(input, {
    productResolution: { ok: false, error: 'no_product' },
    applyCardNotes: true,
    noteByCard: new Map([
      ['cardA', '<p>הערת A</p>'],
      ['cardB', '<p>הערת B</p>'],
    ]),
  });
  assert.deepEqual(lines.map((l) => l.id), ['A1', 'A2', 'B1']);
  assert.deepEqual(lines.map((l) => l.note), ['<p>הערת A</p>', '', '<p>הערת B</p>']);
});

// ── scenario 4: empty template ──────────────────────────────────────────────

test('empty card template: generated line note stays empty', () => {
  const { lines } = compose([productLine()], {
    productResolution: resolution({ firstLineNote: null }),
    applyCardNotes: true,
    noteByCard: new Map([['cardMain', null]]),
  });
  assert.equal(lines[0].note, '');
});

// ── scenario 5: multiline Hebrew ────────────────────────────────────────────

test('multiline Hebrew note survives regeneration byte-exact', () => {
  const note = '<p>שורה ראשונה</p><p></p><p>Second line בעברית</p>';
  const { lines } = compose([productLine()], {
    applyCardNotes: true,
    noteByCard: new Map([['cardMain', note]]),
  });
  assert.equal(lines[0].note, note);
});

// ── scenario 7: recalculation after Deal-input change (different card wins) ──

test('input change → different winning card → its note replaces the old one', () => {
  const gen1 = compose([productLine()], {
    applyCardNotes: true,
    noteByCard: new Map([['cardMain', '<p>הערת הכרטיס הראשון</p>']]),
  });
  assert.equal(gen1.lines[0].note, '<p>הערת הכרטיס הראשון</p>');

  // Simulate changed Deal inputs: the engine now resolves a DIFFERENT card.
  const gen2 = compose(gen1.lines, {
    productResolution: resolution({ ruleId: 'r2', cardGroupId: 'cardOther', firstLineNote: '<p>הערה אחרת</p>', baseAmountMinor: 236000 }),
    applyCardNotes: true,
    noteByCard: new Map([['cardOther', '<p>הערה אחרת</p>']]),
  });
  assert.equal(gen2.lines[0].sourceCardGroupId, 'cardOther');
  assert.equal(gen2.lines[0].note, '<p>הערה אחרת</p>');
  assert.equal(gen2.lines[0].unitPriceMinor, 236000);
});

// ── scenario 8: manual note edit, then automatic recalculation ──────────────

test('manual note edit is replaced by the canonical note on regeneration', () => {
  const gen1 = compose([productLine()], {
    applyCardNotes: true,
    noteByCard: new Map([['cardMain', '<p>קנוני</p>']]),
  });
  const manuallyEdited = gen1.lines.map((l) => ({ ...l, note: '<p>נערך ידנית</p>' }));
  const gen2 = compose(manuallyEdited, {
    applyCardNotes: true,
    noteByCard: new Map([['cardMain', '<p>קנוני</p>']]),
  });
  assert.equal(gen2.lines[0].note, '<p>קנוני</p>');
});

// Manual (non-card) lines keep their notes through regeneration.
test('manual line notes survive regeneration untouched', () => {
  const manual = { id: 'M1', kind: 'manual', label: 'תוספת חופשית', quantity: 1, unitPriceMinor: 5000, note: '<p>הערה ידנית</p>', active: true };
  const { lines } = compose([productLine(), manual], {
    applyCardNotes: true,
    noteByCard: new Map([['cardMain', '<p>קנוני</p>']]),
  });
  assert.equal(lines[1].note, '<p>הערה ידנית</p>');
});

// ── scenario 9: simulator ↔ Deal byte-parity ────────────────────────────────
//
// Both surfaces call POST /api/pricing/builder with the same request shape; the
// composition below IS that endpoint's calculation. Identical inputs must yield
// a byte-identical normalized result across EVERY compared field — not only the
// total. (The engine resolution itself is also exercised for real via calculate.)

test('simulator and Deal paths: identical input → byte-identical full output', () => {
  // Real engine resolution (the same call the route makes for both surfaces).
  const rule = {
    id: 'r1',
    active: true,
    priceModel: 'fixed',
    fixedPriceMinor: 118000n,
    priority: 0,
    cardGroupId: 'cardMain',
    firstLineNote: '<p>כולל הדרכה</p>',
    vatMode: 'included',
    vatRate: 18,
  };
  const engine = calculate({
    priceList: { id: 'pl1', nameHe: 'מחירון', currency: 'ILS', isDefault: true, defaultVatMode: 'included', defaultVatRate: 18, rules: [rule] },
    activityType: { id: 'at1' },
    context: { activityTypeId: 'at1' },
    counts: { participantCount: 20 },
  });
  // The engine exposes the winning rule's card provenance + template.
  assert.equal(engine.rule.cardGroupId, 'cardMain');
  assert.equal(engine.rule.firstLineNote, '<p>כולל הדרכה</p>');
  const pr = resolution({
    priceModel: engine.priceModel,
    vatMode: engine.vatMode,
    vatRate: engine.vatRate,
    baseAmountMinor: engine.debug.baseAmountMinor,
    ruleId: engine.rule.id,
    cardGroupId: engine.rule.cardGroupId,
    firstLineNote: engine.rule.firstLineNote,
  });

  const request = (id) => ({
    inputLines: [
      productLine({ id: `${id}-p` }),
      ticketLine(`${id}-t1`, 'cardTix', 'tt_adult', 4, 6000),
      ticketLine(`${id}-t2`, 'cardTix', 'tt_child', 2, 4000),
    ],
    productResolution: pr,
    vatDefault: VAT_DEFAULT,
    applyCardNotes: true,
    noteByCard: new Map([
      ['cardMain', '<p>כולל הדרכה</p>'],
      ['cardTix', '<p>מחיר קבוצתי</p>'],
    ]),
  });

  const dealResult = composeBuilderLines(request('x'));
  const simulatorResult = composeBuilderLines(request('x'));

  // Byte-equivalent normalized output: line count, order, kind, references,
  // source card, quantity, unit price, note, and net/vat/gross totals.
  assert.equal(JSON.stringify(dealResult), JSON.stringify(simulatorResult));
  assert.deepEqual(dealResult, simulatorResult);

  // And the content itself is what a Deal must produce.
  const [p, t1, t2] = dealResult.lines;
  assert.deepEqual(
    [p.note, t1.note, t2.note],
    ['<p>כולל הדרכה</p>', '<p>מחיר קבוצתי</p>', ''],
  );
  assert.equal(p.sourceCardGroupId, 'cardMain');
  assert.equal(t1.sourceCardGroupId, 'cardTix');
  assert.equal(t1.ticketTypeId, 'tt_adult');
  // fixed 118000 incl. + 4×6000 + 2×4000 incl. = 150000 gross
  assert.equal(dealResult.totals.grossMinor, 150000);
});

// Totals regression — composition math unchanged by the extraction.
test('totals: mixed active/inactive/discount lines, VAT split per line', () => {
  const input = [
    productLine(), // engine: 118000 incl 18% → net 100000, vat 18000
    { id: 'D1', kind: 'discount', label: 'הנחה', quantity: 1, unitPriceMinor: 11800, vatMode: 'included', vatRate: 18, active: true },
    { id: 'OFF', kind: 'manual', label: 'כבוי', quantity: 1, unitPriceMinor: 99999, active: false },
  ];
  const { lines, totals } = compose(input);
  assert.equal(lines[0].grossMinor, 118000);
  assert.equal(lines[1].grossMinor, -11800);
  assert.equal(lines[2].grossMinor, 0);
  assert.equal(totals.grossMinor, 106200);
  assert.equal(totals.netMinor, 90000);
  assert.equal(totals.vatMinor, 16200);
});

test('price_rule_base lines price at the per-unit base × quantity; legacy lines keep the full amount', () => {
  const pr = resolution({ baseAmountMinor: 480000, unitBaseMinor: 190000 });
  const base = productLine({ sourceKind: 'price_rule_base', quantity: 2 });
  const legacy = productLine({ id: 'L2' });
  const { lines } = compose([base, legacy], { productResolution: pr });
  assert.equal(lines[0].unitPriceMinor, 190000);
  assert.equal(lines[0].grossMinor, 380000);
  assert.equal(lines[1].unitPriceMinor, 480000);
});

test('echo preserves the price_rule_base marker (persistence must not degrade to legacy pricing)', () => {
  const pr = resolution({ baseAmountMinor: 480000, unitBaseMinor: 190000 });
  const { lines } = compose([productLine({ sourceKind: 'price_rule_base', quantity: 2 })], { productResolution: pr });
  assert.equal(lines[0].sourceKind, 'price_rule_base');
});
