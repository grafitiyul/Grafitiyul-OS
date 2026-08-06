import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORGANIZATION_REQUIRED,
  ORG_REQUIRED_COPY,
  contactOrganizationSuggestions,
  isOrganizationRequiredError,
  needsOrganization,
} from './quoteOrgGate.js';

// The client half of the "a quote is always issued to an organization" rule.

test('a deal without an organization is gated; a linked one is not', () => {
  assert.equal(needsOrganization({ id: 'd1', organizationId: null }), true);
  assert.equal(needsOrganization({ id: 'd1' }), true, 'missing field counts as missing org');
  assert.equal(needsOrganization({ id: 'd1', organizationId: '' }), true);
  assert.equal(needsOrganization(null), true, 'no deal → never generate');
  assert.equal(needsOrganization({ id: 'd1', organizationId: 'org_1' }), false, 'linked → straight to generation');
});

test("the server's coded refusal is recognised from any quote path", () => {
  assert.equal(isOrganizationRequiredError({ payload: { error: ORGANIZATION_REQUIRED } }), true);
  assert.equal(isOrganizationRequiredError({ error: ORGANIZATION_REQUIRED }), true);
  assert.equal(isOrganizationRequiredError({ message: ORGANIZATION_REQUIRED }), true);
  // Other failures stay ordinary errors — they must NOT open the dialog.
  assert.equal(isOrganizationRequiredError({ payload: { error: 'not_draft' } }), false);
  assert.equal(isOrganizationRequiredError(new Error('network')), false);
  assert.equal(isOrganizationRequiredError(null), false);
});

test('the dialog copy is the agreed wording', () => {
  assert.equal(ORG_REQUIRED_COPY.title, 'נדרש ארגון להפקת הצעת מחיר');
  assert.equal(ORG_REQUIRED_COPY.body, 'כדי להפיק הצעת מחיר יש לשייך את הדיל לארגון.');
  assert.equal(ORG_REQUIRED_COPY.confirmLabel, 'שמור ארגון והמשך להפקת ההצעה');
});

test("suggestions are the contacts' PROVEN memberships, primary first, deduped", () => {
  const contacts = [
    {
      id: 'c1',
      fullNameHe: 'ישראל ישראלי',
      orgLinks: [
        { isPrimary: false, organization: { id: 'o2', name: 'עיריית תל אביב' }, organizationUnit: { id: 'u1', name: 'מחלקת נוער' } },
        { isPrimary: true, organization: { id: 'o1', name: 'בית ספר אורט' }, organizationUnit: null },
      ],
    },
    {
      id: 'c2',
      fullNameHe: 'דנה כהן',
      // Same organization through a second contact — one suggestion, not two.
      orgLinks: [{ isPrimary: false, organization: { id: 'o1', name: 'בית ספר אורט' }, organizationUnit: null }],
    },
  ];
  const s = contactOrganizationSuggestions(contacts);
  assert.deepEqual(s.map((x) => x.id), ['o1', 'o2'], 'primary first, deduped');
  assert.equal(s[0].isPrimary, true);
  assert.equal(s[1].unitId, 'u1', 'the membership unit rides along (it belongs to that org by construction)');
  assert.equal(s[1].unitName, 'מחלקת נוער');
});

test('no organization is ever invented for a contact that has none', () => {
  assert.deepEqual(contactOrganizationSuggestions([]), []);
  assert.deepEqual(contactOrganizationSuggestions([{ id: 'c1', orgLinks: [] }]), []);
  // A deal title / email domain / phone is not an input at all — the helper
  // only ever reads orgLinks.
  assert.deepEqual(
    contactOrganizationSuggestions([
      { id: 'c1', fullNameHe: 'ישראל', emails: [{ value: 'x@ort.org.il' }], orgLinks: [] },
    ]),
    [],
  );
  // Malformed links are skipped, not crashed on.
  assert.deepEqual(contactOrganizationSuggestions([{ id: 'c1', orgLinks: [{ isPrimary: true }] }]), []);
});
