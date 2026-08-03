// Prisma-shape contract test — the guard the openTourTemplate incident
// demanded: a fixture suite stays green while an invalid include/select 500s
// every production request. This walks the confirmation module's query shapes
// against the GENERATED Prisma DMMF and fails on any field or relation that
// does not exist on the model (e.g. selecting a loose-ref "relation").
// Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import {
  CONFIRMATION_DEAL_INCLUDE,
  TOUR_DURATION_SELECT,
} from './composer.js';
import { DEAL_STATE_INCLUDE } from '../routes/confirmationEmail.js';

const MODELS = Object.fromEntries(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

function fieldOf(modelName, fieldName) {
  return MODELS[modelName]?.fields.find((f) => f.name === fieldName) || null;
}

// Recursively validate an include/select tree against a model. `where`,
// `orderBy`, `take` etc. are query args, not fields — only the include/select
// maps are walked.
function walk(modelName, tree, path) {
  assert.ok(MODELS[modelName], `${path}: unknown model ${modelName}`);
  for (const [key, value] of Object.entries(tree)) {
    const field = fieldOf(modelName, key);
    assert.ok(field, `${path}.${key}: no such field on ${modelName}`);
    if (value === true) continue;
    assert.equal(
      field.kind,
      'object',
      `${path}.${key}: nested select on a scalar (${modelName}.${key})`,
    );
    const nested = value.include || value.select;
    if (nested) walk(field.type, nested, `${path}.${key}`);
  }
}

test('CONFIRMATION_DEAL_INCLUDE matches the real schema', () => {
  walk('Deal', CONFIRMATION_DEAL_INCLUDE, 'Deal');
});

test('DEAL_STATE_INCLUDE matches the real schema', () => {
  walk('Deal', DEAL_STATE_INCLUDE, 'Deal');
});

test('TOUR_DURATION_SELECT matches TourEvent', () => {
  walk('TourEvent', TOUR_DURATION_SELECT, 'TourEvent');
});

// The regression itself, pinned: TourEvent has NO openTourTemplate relation —
// openTourTemplateId is a loose ref, and any include/select naming the
// relation is invalid. If a future migration ADDS the relation, this flips
// and attachSlotTemplate can be retired.
test('openTourTemplate is a loose ref, not a relation (the original bug)', () => {
  assert.equal(fieldOf('TourEvent', 'openTourTemplate'), null);
  assert.ok(fieldOf('TourEvent', 'openTourTemplateId'));
});
