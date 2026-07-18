// Pricing-note templates — pure, no Prisma/IO.
//
// A Pricing Card carries TWO note templates: firstLineNote (single group) and
// multiGroupNote (groups > 1; empty → falls back to the single-group note).
// Wording is entirely business-authored; the engine ONLY substitutes the
// {{variable}} placeholders and never invents text. Rendering happens at
// regeneration time, before the note is written onto the builder line — the
// persisted QuoteLine.note is final text.

import { richTextIsEmpty } from './cardNotes.js';

// Money in MINOR units → display number ("1,900" / "99.50"). No currency
// symbol — the template author writes ₪ where they want it.
function money(minor) {
  if (minor == null || !Number.isFinite(Number(minor))) return '';
  const major = Number(minor) / 100;
  return major.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
function count(n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  return Number(n).toLocaleString('en-US');
}

// The supported variables (exported so the editor's "insert variable" menu and
// the renderer never drift apart). Keys are the {{placeholder}} names.
export const NOTE_VARIABLES = [
  { key: 'groups', labelHe: 'מספר קבוצות' },
  { key: 'participants', labelHe: 'משתתפים' },
  { key: 'includedPerGroup', labelHe: 'משתתפים כלולים לקבוצה' },
  { key: 'includedTotal', labelHe: 'סה״כ משתתפים כלולים' },
  { key: 'pricePerGroup', labelHe: 'מחיר לקבוצה' },
  { key: 'baseTotal', labelHe: 'סה״כ בסיס' },
  { key: 'extraParticipants', labelHe: 'משתתפים נוספים' },
  { key: 'extraPrice', labelHe: 'מחיר למשתתף נוסף' },
  { key: 'extraTotal', labelHe: 'סה״כ תוספת משתתפים' },
  { key: 'lineTotal', labelHe: 'סה״כ השורה' },
  { key: 'variant', labelHe: 'וריאנט' },
  { key: 'city', labelHe: 'עיר' },
];

// Build the substitution values from an engine result + context names. Values
// that don't exist for the winning model render as '' (never invented).
export function buildNoteVars({ engineResult, groupCount, participantCount, variantName, cityName }) {
  const d = engineResult?.debug || {};
  const b = engineResult?.breakdown || null;
  const groups = Math.max(1, Number(groupCount) || 1);
  const includedPerGroup = d.baseParticipants ?? null;
  const includedTotal = d.includedParticipants ?? (includedPerGroup != null ? includedPerGroup * groups : null);
  const pricePerGroupMinor = b ? b.unitBaseMinor : null;
  const baseTotalMinor = d.baseTotalMinor ?? (b ? b.unitBaseMinor * b.unitQuantity : null);
  const extraQty = b?.extra?.quantity ?? d.extraParticipants ?? null;
  const extraUnitMinor = b?.extra?.unitPriceMinor ?? null;
  return {
    groups: count(groups),
    participants: count(participantCount),
    includedPerGroup: count(includedPerGroup),
    includedTotal: count(includedTotal),
    pricePerGroup: money(pricePerGroupMinor),
    baseTotal: money(baseTotalMinor),
    extraParticipants: extraQty ? count(extraQty) : count(0),
    extraPrice: money(extraUnitMinor),
    extraTotal: extraQty && extraUnitMinor != null ? money(extraQty * extraUnitMinor) : '',
    lineTotal: money(engineResult?.grossMinor),
    variant: variantName || '',
    city: cityName || '',
  };
}

// Choose the template: multi-group note when groups > 1 and it has content,
// else the single-group note. Blank rich markup counts as empty.
export function selectNoteTemplate({ firstLineNote, multiGroupNote }, groupCount) {
  const groups = Math.max(1, Number(groupCount) || 1);
  if (groups > 1 && !richTextIsEmpty(multiGroupNote)) return multiGroupNote;
  return firstLineNote || null;
}

// Substitute {{key}} placeholders (whitespace-tolerant) in the template's HTML.
// Unknown keys render as '' — the engine never leaves raw placeholders behind
// and never invents wording.
export function renderNoteTemplate(template, vars) {
  if (richTextIsEmpty(template)) return null;
  return String(template).replace(/\{\{\s*([A-Za-z]+)\s*\}\}/g, (_m, key) =>
    Object.prototype.hasOwnProperty.call(vars || {}, key) ? String(vars[key]) : '',
  );
}
