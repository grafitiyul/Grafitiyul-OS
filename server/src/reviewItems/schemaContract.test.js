// The review path's SELECT shapes, checked against the real Prisma schema.
//
// Why this exists: every other test in this module runs against a hand-written
// fake `db`, which happily answers to any field name you invent. A select that
// names a relation the schema does not have passes the whole suite and then
// throws on the first real submission in production — which is exactly what
// happened with `variant` (the relation is `productVariant`).
//
// So the field names are asserted against Prisma's own datamodel. This needs no
// database: the DMMF is generated from schema.prisma at build time. Rename a
// relation and this fails immediately, naming the file that has to change.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pkg from '@prisma/client';

const { Prisma } = pkg;

const modelFields = (name) => {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name);
  assert.ok(model, `model ${name} exists`);
  return new Set(model.fields.map((f) => f.name));
};

// What the review path actually reads, per model. Keep this list honest: it is
// the contract, not a copy of the query.
const CONTRACT = {
  TourEvent: ['id', 'date', 'startTime', 'product', 'productVariant', 'location', 'bookings'],
  ProductVariant: ['locationId', 'location'],
  Product: ['nameHe'],
  Location: ['nameHe', 'isHomeLocation'],
  Booking: ['deal', 'status', 'tourEventId', 'dealId'],
  Deal: ['id', 'orderNo', 'title', 'valueMinor', 'currency', 'collectionReview', 'organization', 'contacts'],
  PersonRef: ['id', 'displayName', 'profile', 'externalPersonId', 'phone'],
  QuestionnaireQuestion: ['key', 'config', 'label', 'options', 'versionId'],
};

test('every field the review path selects exists in the schema', () => {
  for (const [model, fields] of Object.entries(CONTRACT)) {
    const actual = modelFields(model);
    for (const f of fields) {
      assert.ok(actual.has(f), `${model}.${f} — the review path selects it, the schema does not have it`);
    }
  }
});

test('the tour-summary context selects only fields that exist', () => {
  // Read the real source and check every `name: { select:` / `name: true` key
  // inside loadContext against TourEvent, so a future edit is covered too and
  // not just today's field list.
  const src = fs.readFileSync(new URL('./fromTourSummary.js', import.meta.url), 'utf8');
  const start = src.indexOf('db.tourEvent.findUnique');
  assert.ok(start > 0, 'the tour query is where this test expects it');
  // The NEXT actorScope after the query — the one in loadContext's signature
  // comes first in the file and would slice an empty block.
  const block = src.slice(start, src.indexOf('actorScope', start));
  const tourEvent = modelFields('TourEvent');
  const referenced = [...block.matchAll(/^\s{8}(\w+):/gm)].map((m) => m[1]);
  assert.ok(referenced.length >= 5, 'the select was found and parsed');
  for (const f of referenced) {
    assert.ok(tourEvent.has(f), `TourEvent.${f} is selected but does not exist in the schema`);
  }
});

test('the variant regression specifically cannot come back', () => {
  const src = fs.readFileSync(new URL('./fromTourSummary.js', import.meta.url), 'utf8');
  assert.ok(!/\bvariant: \{ select:/.test(src), 'the relation is productVariant, not variant');
  assert.ok(!/tour\.variant\b/.test(src), 'tour.variant is always undefined — use tour.productVariant');
});
