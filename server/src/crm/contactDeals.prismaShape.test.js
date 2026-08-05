// Prisma-shape contract test for the contact-deals panel query — the guard
// the fake-db blind spot demands: a stub suite stays green while a select
// naming a non-existent Deal field 500s every production request. Walks
// CONTACT_DEALS_SELECT against the GENERATED Prisma DMMF.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { CONTACT_DEALS_SELECT } from './dealResolution.js';

const DEAL = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Deal');

test('CONTACT_DEALS_SELECT only names real Deal scalar fields', () => {
  assert.ok(DEAL, 'Deal model exists in the generated schema');
  for (const key of Object.keys(CONTACT_DEALS_SELECT)) {
    const field = DEAL.fields.find((f) => f.name === key);
    assert.ok(field, `Deal.${key} exists in the schema`);
    assert.notEqual(field.kind, 'object', `Deal.${key} is a scalar (plain select)`);
  }
});
