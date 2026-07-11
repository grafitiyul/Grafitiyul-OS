import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadErrorLabel } from './uploadErrors.js';

// Regression guard for the production incident: every failure a user can hit
// on the upload path must resolve to readable Hebrew, never a bare code.

test('known engine/server codes map to Hebrew', () => {
  for (const code of [
    'unsupported_type',
    'file_too_large',
    'network_error',
    'invalid_content',
    'object_missing',
    'tour_cancelled',
    'uploads_disabled',
    'upload_not_found',
    'r2_not_configured',
  ]) {
    const label = uploadErrorLabel(code);
    assert.ok(/[א-ת]/.test(label), `${code} → "${label}" must be Hebrew`);
    assert.notEqual(label, code);
  }
});

test('CORS/network failure (XHR status 0) names both possible causes', () => {
  const label = uploadErrorLabel('network_error');
  assert.match(label, /רשת/);
  assert.match(label, /CORS/);
});

test('R2 HTTP rejections keep the status visible for QA', () => {
  assert.match(uploadErrorLabel('upload_http_403'), /403/);
  assert.match(uploadErrorLabel('upload_http_400'), /400/);
  assert.match(uploadErrorLabel('upload_http_503'), /503/);
});

test('unknown codes degrade readably instead of vanishing', () => {
  assert.match(uploadErrorLabel('something_new'), /שגיאה/);
  assert.equal(uploadErrorLabel(''), '');
  assert.equal(uploadErrorLabel(null), '');
});
