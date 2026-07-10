// Question-type registry — the ONE place that knows what a question type is:
// its value shape, its config keys, and its server-side validator. Adding a
// type is a registry entry + a client renderer; never an engine change
// (blueprint §8). Slice 1 ships the core input types; upload/signature types
// land with their renderers + storage in Slice 5 so production never has a
// published question the runtime can't render.
//
// Validators return an error CODE string (snake_case) or null. They are pure
// (no DB) so they are unit-testable and reusable by the public/staff routes.

import { isEmptyAnswer } from '../../../shared/questionnaire/conditions.mjs';

// "Other" answers on choice/multi keep the value a plain string with a
// sentinel prefix (same pragmatic convention proven in the Challenge engine):
//   '__other__:<free text>'
export const OTHER_PREFIX = '__other__:';
export function isOtherValue(v) {
  return typeof v === 'string' && v.startsWith(OTHER_PREFIX);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Deliberately simple e-mail shape check — the goal is catching obvious junk,
// not RFC 5322 conformance.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function str(v) {
  return typeof v === 'string' ? v : null;
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function validateStringLength(v, config, defMax) {
  const max = Number(config?.maxLength) > 0 ? Number(config.maxLength) : defMax;
  if (v.length > max) return 'too_long';
  if (config?.regex) {
    try {
      if (!new RegExp(config.regex).test(v)) return 'pattern_mismatch';
    } catch {
      // Broken admin regex must not brick submissions — publish validation
      // rejects it; if one slips through, skip the check.
    }
  }
  return null;
}

function validateNumberRange(v, config, defMin, defMax) {
  const min = config?.min !== undefined && config?.min !== null ? Number(config.min) : defMin;
  const max = config?.max !== undefined && config?.max !== null ? Number(config.max) : defMax;
  if (min !== undefined && !Number.isNaN(min) && v < min) return 'below_min';
  if (max !== undefined && !Number.isNaN(max) && v > max) return 'above_max';
  return null;
}

function optionValues(question) {
  return new Set((question.options || []).map((o) => o.value));
}

function validateChoiceValue(v, question) {
  const s = str(v);
  if (s === null) return 'invalid_type';
  if (isOtherValue(s)) {
    if (!question.config?.allowOther) return 'other_not_allowed';
    if (s.slice(OTHER_PREFIX.length).trim() === '') return 'other_text_required';
    return null;
  }
  return optionValues(question).has(s) ? null : 'unknown_option';
}

export const QUESTION_TYPES = {
  text: {
    valueKind: 'string',
    validate: (v, q) => (str(v) === null ? 'invalid_type' : validateStringLength(v, q.config, 1000)),
  },
  textarea: {
    valueKind: 'string',
    validate: (v, q) => (str(v) === null ? 'invalid_type' : validateStringLength(v, q.config, 20000)),
  },
  number: {
    valueKind: 'number',
    validate: (v, q) => {
      if (num(v) === null) return 'invalid_type';
      if (q.config?.integer && !Number.isInteger(v)) return 'not_integer';
      return validateNumberRange(v, q.config, undefined, undefined);
    },
  },
  email: {
    valueKind: 'string',
    validate: (v) => {
      const s = str(v);
      if (s === null) return 'invalid_type';
      return EMAIL_RE.test(s.trim()) ? null : 'invalid_email';
    },
  },
  phone: {
    valueKind: 'string',
    validate: (v) => {
      const s = str(v);
      if (s === null) return 'invalid_type';
      const digits = s.replace(/\D/g, '');
      return digits.length >= 7 && digits.length <= 15 ? null : 'invalid_phone';
    },
  },
  url: {
    valueKind: 'string',
    validate: (v) => {
      const s = str(v);
      if (s === null) return 'invalid_type';
      try {
        const u = new URL(s);
        return ['http:', 'https:'].includes(u.protocol) ? null : 'invalid_url';
      } catch {
        return 'invalid_url';
      }
    },
  },
  date: {
    valueKind: 'string',
    validate: (v) => {
      const s = str(v);
      if (s === null) return 'invalid_type';
      if (!DATE_RE.test(s)) return 'invalid_date';
      return Number.isNaN(Date.parse(s)) ? 'invalid_date' : null;
    },
  },
  time: {
    valueKind: 'string',
    validate: (v) => {
      const s = str(v);
      if (s === null) return 'invalid_type';
      return TIME_RE.test(s) ? null : 'invalid_time';
    },
  },
  datetime: {
    valueKind: 'string',
    validate: (v) => {
      const s = str(v);
      if (s === null) return 'invalid_type';
      return Number.isNaN(Date.parse(s)) ? 'invalid_datetime' : null;
    },
  },
  yesno: {
    valueKind: 'boolean',
    validate: (v) => (typeof v === 'boolean' ? null : 'invalid_type'),
  },
  choice: {
    valueKind: 'string',
    hasOptions: true,
    validate: (v, q) => validateChoiceValue(v, q),
  },
  dropdown: {
    valueKind: 'string',
    hasOptions: true,
    validate: (v, q) => validateChoiceValue(v, q),
  },
  multi: {
    valueKind: 'array',
    hasOptions: true,
    validate: (v, q) => {
      if (!Array.isArray(v)) return 'invalid_type';
      if (new Set(v).size !== v.length) return 'duplicate_values';
      for (const item of v) {
        const err = validateChoiceValue(item, q);
        if (err) return err;
      }
      const minSel = Number(q.config?.minSelections) || 0;
      const maxSel = Number(q.config?.maxSelections) || Infinity;
      if (v.length < minSel) return 'too_few_selections';
      if (v.length > maxSel) return 'too_many_selections';
      return null;
    },
  },
  scale: {
    valueKind: 'number',
    validate: (v, q) => {
      if (num(v) === null || !Number.isInteger(v)) return 'invalid_type';
      const min = Number(q.config?.scaleMin ?? 1);
      const max = Number(q.config?.scaleMax ?? 10);
      return v >= min && v <= max ? null : 'out_of_range';
    },
  },
  rating: {
    valueKind: 'number',
    validate: (v, q) => {
      if (num(v) === null || !Number.isInteger(v)) return 'invalid_type';
      const max = Number(q.config?.ratingMax ?? 5);
      return v >= 1 && v <= max ? null : 'out_of_range';
    },
  },
  slider: {
    valueKind: 'number',
    validate: (v, q) => {
      if (num(v) === null) return 'invalid_type';
      return validateNumberRange(v, q.config, Number(q.config?.min ?? 0), Number(q.config?.max ?? 100));
    },
  },
  // Display-only rich block — never accepts an answer. Its localized HTML
  // lives in the question's `label` map.
  static_text: {
    valueKind: 'none',
    validate: () => 'not_answerable',
  },
  // Uploaded media (Slice 5). Value = { assetId, url, name, mime, size } —
  // the asset itself lives in MediaAsset (unguessable cuid id, immutable
  // serve); the answer stores only the reference.
  image_upload: {
    valueKind: 'object',
    validate: (v) => validateUploadValue(v, ['image/']),
  },
  file_upload: {
    valueKind: 'object',
    validate: (v) => validateUploadValue(v, ['image/', 'application/pdf']),
  },
  // Drawn signature — PNG data URL, same storage convention as the public
  // quote signing flow (QuoteSignature.signatureImage: no admin storage path
  // for public signers). Size-capped server-side.
  signature: {
    valueKind: 'string',
    validate: (v) => {
      if (typeof v !== 'string') return 'invalid_type';
      if (!v.startsWith('data:image/png;base64,')) return 'invalid_signature';
      if (v.length > 400_000) return 'too_long';
      return null;
    },
  },
};

function validateUploadValue(v, allowedMimePrefixes) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'invalid_type';
  if (typeof v.assetId !== 'string' || !v.assetId.trim()) return 'invalid_upload';
  if (typeof v.name !== 'string' || !v.name.trim()) return 'invalid_upload';
  if (typeof v.mime !== 'string') return 'invalid_upload';
  const ok = allowedMimePrefixes.some((p) =>
    p.endsWith('/') ? v.mime.startsWith(p) : v.mime === p);
  return ok ? null : 'unsupported_file_type';
}

export const QUESTION_TYPE_KEYS = Object.keys(QUESTION_TYPES);

export function isKnownType(type) {
  return Object.prototype.hasOwnProperty.call(QUESTION_TYPES, type);
}

export function typeHasOptions(type) {
  return !!QUESTION_TYPES[type]?.hasOptions;
}

export function typeIsAnswerable(type) {
  return isKnownType(type) && QUESTION_TYPES[type].valueKind !== 'none';
}

// Validate a single non-empty answer value against its question.
// Returns an error code or null. Empty values are the pipeline's business
// (required-ness), not the type's.
export function validateAnswerValue(value, question) {
  const def = QUESTION_TYPES[question.type];
  if (!def) return 'unknown_question_type';
  if (isEmptyAnswer(value)) return null;
  return def.validate(value, question);
}
