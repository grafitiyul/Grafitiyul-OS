// One-time maintenance logic: route Contact name values into the language slot
// their SCRIPT proves they belong to.
//
// WHY: Pipedrive kept separate first/last name fields with no language notion.
// The migration landed Latin names in the Hebrew columns (and Hebrew names in
// the English columns) on an unknown number of Contacts.
//
// RELATIONSHIP TO shared/nameLanguage.mjs (THE canonical classifier):
// classifyNameScript is the live product rule — it answers the only question
// the app ever asks ("Hebrew field or English field?") and deliberately folds
// every non-Hebrew, non-Latin script into 'neutral'. That is correct for
// routing, but this one-time sweep must also COUNT Cyrillic / Arabic / other
// scripts so the owner can decide whether dedicated fields are needed. So this
// module refines — never contradicts — the canonical rule:
//
//   canonical 'he'      → 'hebrew'
//   canonical 'en'      → 'latin'
//   canonical 'mixed'   → 'mixed'      (never guessed, never split)
//   canonical 'neutral' → split into 'cyrillic' | 'arabic' | 'greek' |
//                         'other_script' | 'no_letters'
//
// Every value that this module would MOVE is one the canonical classifier
// already agrees is misplaced, or one it calls 'neutral' and the product rule
// (owner decision, 2026-08-07) parks in the English slot until dedicated
// language fields exist. Nothing is transliterated or translated — the exact
// stored text is moved between columns, verbatim.

import { classifyNameScript } from '../../../shared/nameLanguage.mjs';

// Letter ranges for the scripts we need to COUNT (beyond he/latin). Ordered
// checks — a value is only labelled by a script whose letters it actually has.
const CYRILLIC_RE = /[Ѐ-ӿԀ-ԯⷠ-ⷿꙀ-ꚟ]/;
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const GREEK_RE = /[Ͱ-Ͽἀ-῿]/;
// Any other cased/ideographic letter we do not name individually (CJK, Thai,
// Devanagari, Armenian, Georgian, Hangul…). Deliberately broad: its only job is
// to separate "a name in a script we did not enumerate" from "no letters at
// all" (punctuation, digits, whitespace).
const OTHER_LETTER_RE =
  /[԰-֏ऀ-෿฀-໿Ⴀ-ჿᄀ-ᇿ぀-ヿ㄰-㆏㐀-鿿가-힯]/;

export const SCRIPTS = [
  'empty',
  'hebrew',
  'latin',
  'cyrillic',
  'arabic',
  'greek',
  'other_script',
  'mixed',
  'no_letters',
];

/**
 * Classify ONE stored name value (never a whole Contact).
 * → 'empty' | 'hebrew' | 'latin' | 'cyrillic' | 'arabic' | 'greek'
 *   | 'other_script' | 'mixed' | 'no_letters'
 */
export function classifyFieldScript(raw) {
  const canonical = classifyNameScript(raw);
  if (canonical === 'empty') return 'empty';
  if (canonical === 'he') return 'hebrew';
  if (canonical === 'en') return 'latin';
  if (canonical === 'mixed') return 'mixed';

  // canonical === 'neutral' — no Hebrew and no Latin letters. Refine.
  const s = String(raw || '').trim();
  const hits = [
    CYRILLIC_RE.test(s) && 'cyrillic',
    ARABIC_RE.test(s) && 'arabic',
    GREEK_RE.test(s) && 'greek',
    OTHER_LETTER_RE.test(s) && 'other_script',
  ].filter(Boolean);
  if (hits.length > 1) return 'mixed';
  if (hits.length === 1) return hits[0];
  return 'no_letters';
}

// Scripts that PROVE the value does not belong in a Hebrew name column.
const NON_HEBREW_LETTERS = new Set(['latin', 'cyrillic', 'arabic', 'greek', 'other_script']);

// A destination slot is only free when it is truly empty. A slot holding
// punctuation/digits ('-', '.') is NOT treated as free: it is content someone
// stored, and overwriting it would destroy evidence. Those surface as conflicts.
const isFree = (v) => String(v || '').trim() === '';

/**
 * Plan the language repair for ONE name slot (first or last) of one Contact.
 *
 *   he / en — the two stored values for that slot
 * → { slot, he, en, heScript, enScript, action, reason, next? }
 *
 * action is one of:
 *   'none'            nothing to do (already correct, or both empty)
 *   'he_to_en'        the Hebrew column holds non-Hebrew script; English free
 *   'en_to_he'        the English column holds Hebrew; Hebrew column free
 *   'swap'            each column holds exactly the other's script
 *   'conflict'        a move is indicated but the destination is occupied
 *   'mixed'           a mixed-script value — never split or guessed
 *   'no_letters'      a value with no meaningful letters — nothing to prove
 */
export function planNameSlot(slot, he, en) {
  const heScript = classifyFieldScript(he);
  const enScript = classifyFieldScript(en);
  const base = { slot, he: he ?? '', en: en ?? '', heScript, enScript };

  const heMisplaced = NON_HEBREW_LETTERS.has(heScript);
  const enMisplaced = enScript === 'hebrew';

  // Mixed values are never touched — the canonical rule refuses to guess and so
  // does this sweep. Reported so the owner can resolve them by hand.
  if (heScript === 'mixed' || enScript === 'mixed') {
    return { ...base, action: 'mixed', reason: 'mixed_script_never_split' };
  }

  // Both columns hold the other's script → a lossless swap. Nothing is
  // overwritten: every character survives, each in its script-correct column.
  if (heMisplaced && enMisplaced) {
    return {
      ...base,
      action: 'swap',
      reason: `he_holds_${heScript}_and_en_holds_hebrew`,
      next: { he: base.en, en: base.he },
    };
  }

  if (heMisplaced) {
    if (!isFree(en)) {
      return {
        ...base,
        action: 'conflict',
        reason: `he_holds_${heScript}_but_en_occupied_by_${enScript}`,
      };
    }
    return {
      ...base,
      action: 'he_to_en',
      reason: `he_holds_${heScript}`,
      next: { he: '', en: base.he },
    };
  }

  if (enMisplaced) {
    if (!isFree(he)) {
      return {
        ...base,
        action: 'conflict',
        reason: `en_holds_hebrew_but_he_occupied_by_${heScript}`,
      };
    }
    return {
      ...base,
      action: 'en_to_he',
      reason: 'en_holds_hebrew',
      next: { he: base.en, en: '' },
    };
  }

  // A no-letter value sitting alone is worth reporting but never moving.
  if (heScript === 'no_letters' || enScript === 'no_letters') {
    return { ...base, action: 'no_letters', reason: 'no_meaningful_letters' };
  }

  return { ...base, action: 'none', reason: 'already_correct' };
}

// The four columns, as two slots. first stays first, last stays last — this
// sweep is language placement, never semantic name guessing.
const SLOTS = [
  { slot: 'first', heField: 'firstNameHe', enField: 'firstNameEn' },
  { slot: 'last', heField: 'lastNameHe', enField: 'lastNameEn' },
];

const MOVE_ACTIONS = new Set(['he_to_en', 'en_to_he', 'swap']);

/**
 * Plan both slots of one Contact.
 * → { contactId, contactNo, slots: [plan, plan], patch, moves, hasBlocked }
 * `patch` holds ONLY the changed columns (empty object when nothing moves).
 */
export function planContactNames(contact) {
  const slots = SLOTS.map(({ slot, heField, enField }) =>
    planNameSlot(slot, contact[heField], contact[enField]),
  );

  const patch = {};
  slots.forEach((plan, i) => {
    if (!MOVE_ACTIONS.has(plan.action) || !plan.next) return;
    const { heField, enField } = SLOTS[i];
    if (plan.next.he !== plan.he) patch[heField] = plan.next.he;
    if (plan.next.en !== plan.en) patch[enField] = plan.next.en;
  });

  return {
    contactId: contact.id,
    contactNo: contact.contactNo ?? null,
    slots,
    patch,
    moves: slots.filter((p) => MOVE_ACTIONS.has(p.action)).length,
    hasBlocked: slots.some((p) => p.action === 'conflict' || p.action === 'mixed'),
  };
}

/**
 * The invariant this sweep establishes, checked against a repaired row:
 *   - no Hebrew column holds a purely non-Hebrew-script value while its English
 *     counterpart is free
 *   - no English column holds a purely Hebrew value while its Hebrew
 *     counterpart is free
 * Anything still violating it must be a reported conflict/mixed case.
 * → array of violation strings (empty when clean).
 */
export function verifyContactNames(contact) {
  return planContactNames(contact)
    .slots.filter((p) => MOVE_ACTIONS.has(p.action))
    .map((p) => `${p.slot}: ${p.action} (${p.reason})`);
}
