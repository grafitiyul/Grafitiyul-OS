// Confirmation Email — the Filler registry. Pure, no DB (the adminReports
// registry pattern: code-defined kinds, data-defined instances).
//
// A "filler" is a structured, operator-declared deviation of THIS deal from
// the standard terms — it changes what the confirmation email says. Storage:
// DealConfirmation.fillers = [{ kind, ...payload }], at most one entry per
// kind. Adding a future filler kind = ONE entry here (label + affected
// sections + payload validation); nothing downstream is hardcoded.
//
// PRODUCT RULE (approved): every customer-facing editable text in filler UIs
// is headed "הערה ללקוח" (Customer Note) — never plain "הערה" — so operators
// can never confuse these with internal notes.

import { categoryForFillerKind } from './specialTexts.js';

const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');
const hasNote = (p) => Boolean(trimmed(p?.noteHe) || trimmed(p?.noteEn));

// The three ways ANY special-text filler resolves its wording. One vocabulary
// for cancellation, new guide and every future category.
export const SPECIAL_TEXT_MODES = ['default', 'policy', 'override'];
// Back-compat alias — the cancellation-only name this vocabulary started as.
export const CANCELLATION_MODES = SPECIAL_TEXT_MODES;

// Shared validation for every filler that selects from a special-text
// category (registry-linked): default = the category's ★ option, policy = a
// specific option (specialTextId), override = a per-deal Customer Note.
function validateSpecialTextFiller(p) {
  const errs = [];
  if (!SPECIAL_TEXT_MODES.includes(p?.mode)) errs.push('invalid_mode');
  if (p?.mode === 'policy' && !trimmed(p?.specialTextId)) errs.push('policy_required');
  if (p?.mode === 'override' && !hasNote(p)) errs.push('note_required');
  return errs;
}

export const FILLER_KINDS = [
  {
    kind: 'cancellation_policy',
    labelHe: 'מדיניות ביטול',
    affects: ['cancellation'],
    // { mode:'default'|'policy'|'override', specialTextId?, noteHe?, noteEn? }
    // Options live in ConfirmationSpecialText (CRM Settings), NOT in code.
    validate: validateSpecialTextFiller,
  },
  {
    kind: 'activity_duration',
    labelHe: 'משך הפעילות',
    affects: ['tour_details'],
    // { durationHours, noteHe?, noteEn? } — durationHours is ALSO written to
    // Deal.durationHours (structured, changelog-tracked); the email shows the
    // RESOLVED effective duration (tours/tourTime.js effectiveDurationHours),
    // with the Customer Note rendered beneath the tour details.
    validate(p) {
      const h = Number(p?.durationHours);
      return Number.isFinite(h) && h > 0 && h <= 24 ? [] : ['invalid_duration'];
    },
  },
  {
    kind: 'new_guide',
    labelHe: 'מדריך חדש',
    affects: ['special_terms'],
    // Same shape as cancellation: the wording comes from the "מדריך חדש"
    // special-text category (default / another predefined / deal override) —
    // no hardcoded default wording lives in code any more.
    validate: validateSpecialTextFiller,
  },
  {
    kind: 'other_note',
    labelHe: 'הערה נוספת ללקוח',
    affects: ['special_terms'],
    // { noteHe?, noteEn? } — no default wording, pure Customer Note.
    validate(p) {
      return hasNote(p) ? [] : ['note_required'];
    },
  },
];

export const FILLER_KIND_KEYS = FILLER_KINDS.map((f) => f.kind);

const BY_KIND = Object.fromEntries(FILLER_KINDS.map((f) => [f.kind, f]));

export function getFillerKind(kind) {
  return BY_KIND[kind] || null;
}

/** The special-text category this filler picks from, or null (plain note). */
export function fillerSpecialTextCategory(kind) {
  return categoryForFillerKind(kind)?.key || null;
}

export function isSpecialTextFiller(kind) {
  return !!categoryForFillerKind(kind);
}

/**
 * Sanitize a stored/incoming list: known kinds only, FIRST entry per kind wins
 * (deterministic; the UI never produces duplicates), string fields trimmed,
 * empty strings dropped, durationHours coerced to a number. Never throws —
 * validation is a separate concern (validateFillers).
 */
export function normalizeFillers(raw) {
  const seen = new Set();
  const out = [];
  for (const f of Array.isArray(raw) ? raw : []) {
    if (!f || !BY_KIND[f.kind] || seen.has(f.kind)) continue;
    seen.add(f.kind);
    const clean = { kind: f.kind };
    if (trimmed(f.mode)) clean.mode = trimmed(f.mode);
    // specialTextId is canonical; policyId is the cancellation-era name kept
    // readable so rows written before the generic model still resolve.
    const specialTextId = trimmed(f.specialTextId) || trimmed(f.policyId);
    if (specialTextId) clean.specialTextId = specialTextId;
    if (trimmed(f.noteHe)) clean.noteHe = trimmed(f.noteHe);
    if (trimmed(f.noteEn)) clean.noteEn = trimmed(f.noteEn);
    if (f.durationHours !== null && f.durationHours !== undefined && f.durationHours !== '') {
      const h = Number(f.durationHours);
      if (Number.isFinite(h)) clean.durationHours = h;
    }
    // A special-text filler stored before modes existed (a bare note — the
    // old new_guide shape) IS a deal override; one with nothing chosen falls
    // to the category default. Normalizing here keeps validation mode-only.
    if (isSpecialTextFiller(clean.kind) && !clean.mode) {
      clean.mode = hasNote(clean) ? 'override' : 'default';
    }
    out.push(clean);
  }
  return out;
}

/**
 * Validate a (normalized) filler list. Returns [] when everything is valid,
 * else [{ kind, errors: [code] }] — callers map codes to Hebrew messages.
 */
export function validateFillers(fillers) {
  const problems = [];
  for (const f of Array.isArray(fillers) ? fillers : []) {
    const def = BY_KIND[f?.kind];
    if (!def) {
      problems.push({ kind: String(f?.kind ?? ''), errors: ['unknown_kind'] });
      continue;
    }
    const errs = def.validate(f);
    if (errs.length) problems.push({ kind: f.kind, errors: errs });
  }
  return problems;
}

/** The gate for the preview dialog: fillers exist → large preview; else direct send. */
export function hasActiveFillers(fillers) {
  return normalizeFillers(fillers).length > 0;
}

/** Fillers feeding a given email section (e.g. 'special_terms'), in stored order. */
export function fillersAffecting(fillers, sectionKey) {
  return normalizeFillers(fillers).filter((f) => BY_KIND[f.kind].affects.includes(sectionKey));
}
