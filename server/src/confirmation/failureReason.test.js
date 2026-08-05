// The truthful-failure-wording contract (production #27074): a blocked
// automatic send must report the composer's ACTUAL warnings, never only the
// generic language label. Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import { autoSendFailureReasonHe, AUTO_FAIL_LABELS } from './failureReason.js';

test('no_tour reads as the operational blocker it is — never as a language gap (#27074)', () => {
  const reason = autoSendFailureReasonHe('send_blocked', [
    { code: 'no_tour', sectionId: 'meeting_point', label: 'נקודת מפגש' },
  ]);
  assert.equal(reason, 'אין סיור משובץ — נקודת המפגש חסרה');
  assert.doesNotMatch(reason, /שפת השליחה/);
});

test('content gaps name their sections', () => {
  const reason = autoSendFailureReasonHe('send_blocked', [
    { code: 'missing_content', sectionId: 'block:b1', label: 'הנחיות הגעה', language: 'en' },
    { code: 'missing_content', sectionId: 'closing', label: 'סיום', language: 'en' },
  ]);
  assert.equal(reason, 'חסר תוכן בשפת השליחה: הנחיות הגעה, סיום');
});

test('mixed warnings: the operational blocker leads, every cause is named once', () => {
  const reason = autoSendFailureReasonHe('send_blocked', [
    { code: 'missing_variable', key: 'tour_city', label: 'עיר הפעילות' },
    { code: 'no_tour', sectionId: 'meeting_point', label: 'נקודת מפגש' },
    { code: 'missing_variable', key: 'tour_date', label: 'תאריך הפעילות' },
    { code: 'missing_variable', key: 'tour_date', label: 'תאריך הפעילות' }, // dupe
  ]);
  assert.equal(
    reason,
    'אין סיור משובץ — נקודת המפגש חסרה · משתנים ללא ערך בעסקה זו: עיר הפעילות, תאריך הפעילות',
  );
});

test('send_blocked with no warnings falls back to the generic label (never crashes)', () => {
  assert.equal(autoSendFailureReasonHe('send_blocked'), AUTO_FAIL_LABELS.send_blocked);
  assert.equal(autoSendFailureReasonHe('send_blocked', []), AUTO_FAIL_LABELS.send_blocked);
  // Unknown warning codes only → same fallback, not an empty string.
  assert.equal(
    autoSendFailureReasonHe('send_blocked', [{ code: 'something_new', label: 'x' }]),
    AUTO_FAIL_LABELS.send_blocked,
  );
});

test('non-blocked errors keep their dedicated labels; unknown codes pass through', () => {
  assert.equal(autoSendFailureReasonHe('no_recipient_email'), 'לאיש הקשר אין כתובת מייל');
  assert.equal(
    autoSendFailureReasonHe('no_confirmation_template', [{ code: 'no_tour' }]),
    'לא הוגדרה תבנית מייל אישור',
    'warnings play no part unless the error is send_blocked',
  );
  assert.equal(autoSendFailureReasonHe('weird_new_code'), 'weird_new_code');
});
