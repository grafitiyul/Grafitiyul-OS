// ONE accounting document covering several deals — the composition contract.
//
// What these tests protect is the operator's mental model: the document reads
// deal by deal, in the order they chose, and every partially-settled source
// document says so in words.

import test from 'node:test';
import assert from 'node:assert/strict';
import { composeNotes, rankSourceCandidates } from './multiDealDocument.js';

// ── Line + note ORDER ────────────────────────────────────────────────────────

const deal = (o) => ({
  dealId: o.dealId, orderNo: o.orderNo, contactName: o.contactName ?? null,
  basedOn: o.docnum ? { doctype: o.doctype || 'deal', docnum: o.docnum } : null,
  basedOnLabel: o.docnum ? (o.label || 'חשבון עסקה') : null,
  sourceAmountIls: o.sourceAmountIls ?? null,
  allocationIls: o.allocationIls,
  fullSettlement: o.fullSettlement ?? true,
  notes: o.notes ?? null,
});

test('notes are composed deal by deal, in order, never mashed together', () => {
  const text = composeNotes([
    deal({ dealId: 'a', orderNo: 27101, contactName: 'דנה', docnum: '1234', sourceAmountIls: 1000, allocationIls: 1000, notes: 'הערת דיל א' }),
    deal({ dealId: 'b', orderNo: 27102, contactName: 'יוסי', docnum: '1240', sourceAmountIls: 800, allocationIls: 500, fullSettlement: false, notes: 'הערת דיל ב' }),
  ]);
  const blocks = text.split('\n\n');
  assert.equal(blocks.length, 2, 'one readable block per deal');
  assert.ok(blocks[0].startsWith('דיל #27101 — דנה'));
  assert.ok(blocks[1].startsWith('דיל #27102 — יוסי'));
  // Order is the operator's order, not alphabetical or by amount.
  assert.ok(text.indexOf('27101') < text.indexOf('27102'));
  assert.ok(blocks[0].includes('הערת דיל א'));
  assert.ok(blocks[1].includes('הערת דיל ב'));
  // Each deal's own note stays inside its own block.
  assert.ok(!blocks[0].includes('הערת דיל ב'));
});

// ── The partial-settlement sentence ──────────────────────────────────────────

test('a partially settled source document says exactly how much of how much', () => {
  const text = composeNotes([
    deal({ dealId: 'a', orderNo: 1, docnum: '1234', sourceAmountIls: 1000, allocationIls: 700, fullSettlement: false }),
  ]);
  // The owner's wording: which document, paid how much, out of how much.
  assert.match(text, /חשבון עסקה 1234 שולם 700 ₪ מתוך 1,000 ₪/);
});

test('a FULLY settled source document gets no partial sentence', () => {
  const text = composeNotes([
    deal({ dealId: 'a', orderNo: 1, docnum: '1234', sourceAmountIls: 1000, allocationIls: 1000, fullSettlement: true }),
  ]);
  assert.ok(!/מתוך/.test(text), 'no "out of" sentence when nothing is left open');
  assert.match(text, /נסגר במלואו/);
});

test('one statement per partially settled document, and only for those', () => {
  const text = composeNotes([
    deal({ dealId: 'a', orderNo: 1, docnum: '1234', sourceAmountIls: 1000, allocationIls: 700, fullSettlement: false }),
    deal({ dealId: 'b', orderNo: 2, docnum: '1240', sourceAmountIls: 800, allocationIls: 800, fullSettlement: true }),
    deal({ dealId: 'c', orderNo: 3, docnum: '1288', sourceAmountIls: 700, allocationIls: 200, fullSettlement: false }),
  ]);
  const partials = text.match(/מתוך/g) || [];
  assert.equal(partials.length, 2);
  assert.match(text, /1234 שולם 700 ₪ מתוך 1,000 ₪/);
  assert.match(text, /1288 שולם 200 ₪ מתוך 700 ₪/);
  assert.ok(!/1240 שולם/.test(text));
});

test('a deal with no source document contributes only its own block', () => {
  const text = composeNotes([deal({ dealId: 'a', orderNo: 5, allocationIls: 300, notes: 'בלי מסמך מקור' })]);
  assert.match(text, /דיל #5/);
  assert.match(text, /בלי מסמך מקור/);
  assert.ok(!/מתוך|נסגר במלואו/.test(text));
});

test('N deals: nothing here knows the number two', () => {
  const many = Array.from({ length: 7 }, (_, i) =>
    deal({ dealId: `d${i}`, orderNo: 100 + i, docnum: String(2000 + i), sourceAmountIls: 100, allocationIls: 100 }));
  const blocks = composeNotes(many).split('\n\n');
  assert.equal(blocks.length, 7);
  for (let i = 0; i < 7; i += 1) assert.ok(blocks[i].includes(`#${100 + i}`));
});

// ── Source-document ranking ──────────────────────────────────────────────────

const cand = (doctype, docnum, status, issuedAt) => ({ doctype, docnum, status, issuedAt });

test('only documents that can legally be a parent of the target type are offered', () => {
  const out = rankSourceCandidates(
    [cand('deal', '1', 'open'), cand('invrec', '2', 'open'), cand('invoice', '3', 'open')],
    'receipt', // קבלה closes חשבונית מס only
  );
  assert.deepEqual(out.map((d) => d.docnum), ['3']);
});

test('open documents rank before partially closed, closed last', () => {
  const out = rankSourceCandidates([
    cand('deal', '1', 'closed', '2026-08-01'),
    cand('deal', '2', 'open', '2026-07-01'),
    cand('deal', '3', 'partial', '2026-08-02'),
  ], 'invrec');
  assert.deepEqual(out.map((d) => d.docnum), ['2', '3', '1']);
});

test('within the same status the newest document comes first', () => {
  const out = rankSourceCandidates([
    cand('deal', 'old', 'open', '2026-01-01'),
    cand('deal', 'new', 'open', '2026-08-01'),
  ], 'invrec');
  assert.deepEqual(out.map((d) => d.docnum), ['new', 'old']);
});

test('a document with no number is never offered as a parent', () => {
  const out = rankSourceCandidates([{ doctype: 'deal', docnum: null, status: 'open' }], 'invrec');
  assert.equal(out.length, 0);
});

test('a type with no legal parents offers nothing', () => {
  // חשבון עסקה is never based on anything.
  assert.equal(rankSourceCandidates([cand('deal', '1', 'open')], 'deal').length, 0);
});
