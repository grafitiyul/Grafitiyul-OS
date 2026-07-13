import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guideConversationDto, CONVERSATION_EVENTS } from './dto.js';

// Regression for the "guide can't see the comment they just submitted" bug:
// the conversation must come back through the guide DTO — strictly the OWN
// entry's messages, in order, with sender direction, and nothing else.

const ROWS = [
  { id: 't1', kind: 'payroll', createdAt: '2026-07-10T10:00:00Z', data: { event: 'guide_inquiry', entryId: 'e1', text: 'חסר לי נסיעות' } },
  { id: 't2', kind: 'payroll', createdAt: '2026-07-10T11:00:00Z', data: { event: 'office_reply', entryId: 'e1', text: 'בודקים' } },
  { id: 't3', kind: 'payroll', createdAt: '2026-07-10T12:00:00Z', data: { event: 'guide_message', entryId: 'e1', text: 'תודה' } },
  // Another guide's thread on the SAME activity — must never leak.
  { id: 't4', kind: 'payroll', createdAt: '2026-07-10T10:30:00Z', data: { event: 'guide_inquiry', entryId: 'e2', text: 'סודי של מדריך אחר' } },
  // Non-conversation payroll events — excluded.
  { id: 't5', kind: 'payroll', createdAt: '2026-07-10T09:00:00Z', data: { event: 'office_approved_entries', entryIds: ['e1'] } },
  { id: 't6', kind: 'payroll', createdAt: '2026-07-10T09:30:00Z', data: { event: 'line_changed', entryId: 'e1', changes: [] } },
];

test('conversation: only own entry, chronological, correct sender direction', () => {
  const conv = guideConversationDto(ROWS, 'e1');
  assert.deepEqual(conv.map((m) => m.id), ['t1', 't2', 't3']);
  assert.deepEqual(conv.map((m) => m.byGuide), [true, false, true]);
  assert.equal(conv[0].text, 'חסר לי נסיעות');
});

test('conversation: another guide\'s messages never leak', () => {
  const conv = guideConversationDto(ROWS, 'e1');
  assert.ok(!conv.some((m) => m.text.includes('סודי')));
  const other = guideConversationDto(ROWS, 'e2');
  assert.deepEqual(other.map((m) => m.id), ['t4']);
});

test('conversation: non-message payroll events are excluded', () => {
  const conv = guideConversationDto(ROWS, 'e1');
  assert.ok(!conv.some((m) => m.id === 't5' || m.id === 't6'));
  assert.deepEqual(CONVERSATION_EVENTS, ['guide_inquiry', 'guide_message', 'office_reply']);
});

test('conversation: messages without text are dropped (never render empty bubbles)', () => {
  const conv = guideConversationDto(
    [{ id: 'x', kind: 'payroll', createdAt: '2026-07-10T10:00:00Z', data: { event: 'guide_inquiry', entryId: 'e1' } }],
    'e1',
  );
  assert.deepEqual(conv, []);
});

test('conversation: a guide change starts a fresh thread — the previous guide\'s messages are cut off', () => {
  const rows = [
    // Dor's thread while he owned the entry.
    { id: 'c1', kind: 'payroll', createdAt: '2026-07-10T10:00:00Z', data: { event: 'guide_inquiry', entryId: 'e1', text: 'חסר לי נסיעות (דור)' } },
    { id: 'c2', kind: 'payroll', createdAt: '2026-07-10T11:00:00Z', data: { event: 'office_reply', entryId: 'e1', text: 'תוקן (לדור)' } },
    // Reassignment to Avi.
    { id: 'chg', kind: 'payroll', createdAt: '2026-07-10T12:00:00Z', data: { event: 'guide_changed', entryId: 'e1', from: 'guide:dor', to: 'guide:avi' } },
    // Avi's fresh thread.
    { id: 'c3', kind: 'payroll', createdAt: '2026-07-10T13:00:00Z', data: { event: 'guide_inquiry', entryId: 'e1', text: 'שאלה של אבי' } },
  ];
  const conv = guideConversationDto(rows, 'e1');
  assert.deepEqual(conv.map((m) => m.id), ['c3'], 'only messages AFTER the reassignment belong to the new owner');
  assert.ok(!conv.some((m) => m.text.includes('דור')), 'the previous guide\'s conversation does not transfer');
});

test('conversation: with no guide change, every message still shows (cutoff defaults to open)', () => {
  const conv = guideConversationDto(ROWS, 'e1');
  assert.deepEqual(conv.map((m) => m.id), ['t1', 't2', 't3']);
});
