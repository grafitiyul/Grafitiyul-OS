import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contactRef, organizationRef, contactPath, organizationPath, dealPath,
} from './entityRefs.js';

// The point of this module is that ONE entity has ONE address, whichever
// provider surfaced it. Before it existed the contacts provider linked a person
// by their public contactNo and the timeline provider linked the same person by
// cuid — two URLs for one human.

test('the public number is the canonical address, cuid only as a fallback', () => {
  assert.equal(contactPath({ id: 'ck1', contactNo: 50123 }), '/admin/crm/contacts/50123');
  assert.equal(contactPath({ id: 'ck1', contactNo: null }), '/admin/crm/contacts/ck1');
  assert.equal(organizationPath({ id: 'og1', orgNo: 10007 }), '/admin/crm/organizations/10007');
  assert.equal(organizationPath({ id: 'og1', orgNo: null }), '/admin/crm/organizations/og1');
  assert.equal(dealPath({ id: 'dl1', orderNo: 27100 }), '/admin/crm/deals/27100');
});

test('a contact ref carries the display name and the canonical path', () => {
  const ref = contactRef({
    id: 'c1', contactNo: 50001,
    firstNameHe: 'דנה', lastNameHe: 'כהן', firstNameEn: 'Dana', lastNameEn: 'Cohen',
  });
  assert.deepEqual(ref, {
    type: 'contact', id: 'c1', name: 'דנה כהן', path: '/admin/crm/contacts/50001',
  });
});

test('an English-only contact still gets a usable name', () => {
  const ref = contactRef({
    id: 'c2', contactNo: 50002,
    firstNameHe: '', lastNameHe: '', firstNameEn: 'John', lastNameEn: 'Smith',
  });
  assert.equal(ref.name, 'John Smith');
});

test('a nameless or absent entity produces NO ref — the row falls back to text', () => {
  assert.equal(contactRef(null), null);
  assert.equal(contactRef({ id: 'c3', firstNameHe: '', lastNameHe: '', firstNameEn: '', lastNameEn: '' }), null);
  assert.equal(organizationRef(null), null);
  assert.equal(organizationRef({ id: 'o1', name: '' }), null);
});

test('the unit rides on the organization ref — it has no page of its own', () => {
  const ref = organizationRef({ id: 'o1', orgNo: 10010, name: 'סמסונג' }, { id: 'u1', name: 'מחלקת HR' });
  assert.deepEqual(ref, {
    type: 'organization',
    id: 'o1',
    name: 'סמסונג',
    path: '/admin/crm/organizations/10010',
    unitId: 'u1',
    unitName: 'מחלקת HR',
  });
  const noUnit = organizationRef({ id: 'o1', orgNo: 10010, name: 'סמסונג' });
  assert.equal(noUnit.unitId, null);
  assert.equal(noUnit.unitName, null);
});
