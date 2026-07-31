import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VARIABLES, variablesForTrigger, resolveVariables, substituteTokens, extractTokens,
} from './variables.js';

// Staff variables (context 'staff') — the staff-send registry slice.

const person = {
  displayName: 'דנה כהן לוי',
  phone: '050-1234567',
  email: 'dana@example.com',
  lifecycleHint: 'staff',
  team: { displayName: 'צוות צפון' },
};

const ctx = { staff: { person, portalUrl: 'https://gos.example/p/tok123' } };

test('staff name variables split the displayName (first / last / full)', () => {
  const keys = ['staff_first_name', 'staff_last_name', 'staff_full_name'];
  const { values, missing } = resolveVariables(keys, ctx, 'he');
  assert.equal(values.staff_first_name, 'דנה');
  assert.equal(values.staff_last_name, 'כהן לוי');
  assert.equal(values.staff_full_name, 'דנה כהן לוי');
  assert.deepEqual(missing, []);
});

test('staff contact/team/type/portal variables resolve from the person', () => {
  const keys = ['staff_phone', 'staff_email', 'staff_team', 'staff_type', 'staff_portal_link'];
  const { values, missing } = resolveVariables(keys, ctx, 'he');
  assert.equal(values.staff_phone, '050-1234567');
  assert.equal(values.staff_email, 'dana@example.com');
  assert.equal(values.staff_team, 'צוות צפון');
  assert.equal(values.staff_type, 'צוות');
  assert.equal(values.staff_portal_link, 'https://gos.example/p/tok123');
  assert.deepEqual(missing, []);
});

test('missing values are reported, never silently substituted', () => {
  const bare = { staff: { person: { displayName: 'רון' }, portalUrl: null } };
  const keys = ['staff_last_name', 'staff_phone', 'staff_portal_link', 'staff_type'];
  const { missing } = resolveVariables(keys, bare, 'he');
  assert.deepEqual([...missing].sort(), ['staff_last_name', 'staff_phone', 'staff_portal_link', 'staff_type']);
});

test('per-recipient substitution renders independent texts', () => {
  const template = 'היי {{staff_first_name}}, הפורטל שלך: {{staff_portal_link}}';
  const keys = extractTokens(template);
  const a = resolveVariables(keys, ctx, 'he');
  const b = resolveVariables(keys, {
    staff: { person: { displayName: 'יואב לוי' }, portalUrl: 'https://gos.example/p/tok999' },
  }, 'he');
  assert.equal(substituteTokens(template, a.values), 'היי דנה, הפורטל שלך: https://gos.example/p/tok123');
  assert.equal(substituteTokens(template, b.values), 'היי יואב, הפורטל שלך: https://gos.example/p/tok999');
});

test('staff variables NEVER leak into communication trigger menus', () => {
  // Every trigger context combination used by the Communication Center.
  const menus = [
    variablesForTrigger(['contact']),
    variablesForTrigger(['deal', 'tour', 'payment']),
    variablesForTrigger(['org', 'deal', 'change', 'quote', 'reservation']),
  ];
  for (const menu of menus) {
    assert.equal(menu.some((v) => v.category === 'staff'), false);
  }
  // ...and they DO surface for the staff context.
  const staffMenu = variablesForTrigger(['staff']);
  assert.equal(staffMenu.filter((v) => v.category === 'staff').length,
    VARIABLES.filter((v) => v.category === 'staff').length);
});
