import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnswerValue } from './types.js';
import { sanitizeDraftAnswers } from './validation.js';
import { sniffQuestionnaireUpload, MAX_UPLOAD_BYTES } from './uploads.js';

// Slice 5 — upload + signature types (validators + sniffing policy).

const q = (key, type, extra = {}) => ({
  key, type, label: { he: key }, required: false, sortOrder: 0,
  config: null, visibleWhen: null, options: [], ...extra,
});

const UPLOAD_VALUE = { assetId: 'ck123', url: '/api/media/ck123', name: 'photo.jpg', mime: 'image/jpeg', size: 1234 };

test('image_upload: accepts image refs, rejects pdf/malformed', () => {
  const iq = q('img', 'image_upload');
  assert.equal(validateAnswerValue(UPLOAD_VALUE, iq), null);
  assert.equal(validateAnswerValue({ ...UPLOAD_VALUE, mime: 'application/pdf' }, iq), 'unsupported_file_type');
  assert.equal(validateAnswerValue({ name: 'x' }, iq), 'invalid_upload');
  assert.equal(validateAnswerValue('not-an-object', iq), 'invalid_type');
});

test('file_upload: accepts images AND pdf, rejects other mimes', () => {
  const fq = q('file', 'file_upload');
  assert.equal(validateAnswerValue(UPLOAD_VALUE, fq), null);
  assert.equal(validateAnswerValue({ ...UPLOAD_VALUE, mime: 'application/pdf' }, fq), null);
  assert.equal(validateAnswerValue({ ...UPLOAD_VALUE, mime: 'application/zip' }, fq), 'unsupported_file_type');
});

test('signature: PNG data URL only, size-capped', () => {
  const sq = q('sig', 'signature');
  assert.equal(validateAnswerValue('data:image/png;base64,iVBORw0KGgo=', sq), null);
  assert.equal(validateAnswerValue('data:image/jpeg;base64,xxxx', sq), 'invalid_signature');
  assert.equal(validateAnswerValue('plain text', sq), 'invalid_signature');
  assert.equal(validateAnswerValue(`data:image/png;base64,${'A'.repeat(500_000)}`, sq), 'too_long');
});

test('sanitizeDraftAnswers: object values allowed ONLY for upload types', () => {
  const structure = {
    sections: [{
      key: 's1', title: { he: 'x' }, sortOrder: 0, visibleWhen: null,
      questions: [q('img', 'image_upload'), q('name', 'text')],
    }],
  };
  const { accepted } = sanitizeDraftAnswers(structure, {
    img: UPLOAD_VALUE,
    name: { sneaky: 'object' }, // object into a text question → dropped
  });
  assert.deepEqual(Object.keys(accepted), ['img']);
  assert.deepEqual(accepted.img, UPLOAD_VALUE);
});

test('upload sniffing: PDF magic accepted, junk rejected, size cap enforced', () => {
  const pdf = Buffer.from('%PDF-1.7 fake body');
  assert.deepEqual(sniffQuestionnaireUpload(pdf), { mime: 'application/pdf', kind: 'file' });

  // PNG magic bytes.
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64),
  ]);
  assert.deepEqual(sniffQuestionnaireUpload(png), { mime: 'image/png', kind: 'image' });

  assert.throws(() => sniffQuestionnaireUpload(Buffer.from('just some text')), /unsupported_file_type/);
  assert.throws(() => sniffQuestionnaireUpload(Buffer.alloc(0)), /empty_file/);
  assert.throws(() => sniffQuestionnaireUpload(Buffer.alloc(MAX_UPLOAD_BYTES + 1)), /file_too_large/);
});
