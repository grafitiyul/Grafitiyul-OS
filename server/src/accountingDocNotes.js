// Default notes for iCount accounting documents — THE composition layer.
//
// One canonical source (AccountingDocSettings, singleton) feeds every surface:
// the Finance Settings screen (פרטי בנק גרפיטיול), the produce-document modal
// prefill, the based-on inheritance flow and the preview. The composed text is
// a SUGGESTION: the operator sees it in the modal's Notes field, edits freely,
// and issueDocument sends the exact edited text (hwc) — nothing is appended
// after confirmation.
//
// Template syntax is the canonical {{key}} moustache (communication registry):
//   • bank_* tokens resolve from the structured bank fields on the settings row
//   • deal tokens (group_name, tour_date, participants, …) resolve through
//     server/src/communication/variables.js — never a parallel resolver
// A missing value resolves to EMPTY (the operator sees the gap and edits) and
// an unknown token is stripped at compose time, so raw moustache can never
// reach a customer document. Save-time validation rejects unknown tokens
// outright (unknownDocNoteTokens).
//
// Composition order per document type: inherited notes from the based-on
// document (its live iCount hwc) → deal-info block → bank block → cancellation
// block, each appended only when enabled for the doctype AND not already
// present in the inherited text.
//
// Deduplication rule (deterministic, template-derived): a block counts as
// "already present" when the inherited text contains the block template's
// longest literal segment — the text between/around {{tokens}}, whitespace-
// normalized (e.g. the bank block's "ניתן לשלם בהעברה בנקאית מראש לחשבון:").
// The anchor comes from the CANONICAL current template, never from guessing at
// the values, so it matches historical documents regardless of which group /
// date / amount they carried.

import { extractTokens, resolveVariables, substituteTokens, TOKEN_RE } from './communication/variables.js';
import { normalizeAfterEmptyFill } from './whatsapp/templateResolve.js';

// ── Bank tokens — resolved from the structured settings fields ───────────────
export const BANK_VARIABLES = [
  { key: 'bank_account_holder', labelHe: 'שם בעל החשבון', field: 'bankAccountHolder' },
  { key: 'bank_name', labelHe: 'שם הבנק', field: 'bankName' },
  { key: 'bank_number', labelHe: 'מספר הבנק', field: 'bankNumber' },
  { key: 'bank_branch_name', labelHe: 'שם הסניף', field: 'bankBranchName' },
  { key: 'bank_branch_number', labelHe: 'מספר הסניף', field: 'bankBranchNumber' },
  { key: 'bank_account_number', labelHe: 'מספר החשבון', field: 'bankAccountNumber' },
];
const BANK_FIELD_BY_TOKEN = Object.fromEntries(BANK_VARIABLES.map((v) => [v.key, v.field]));

// ── Deal tokens — the narrow whitelist this surface supports ─────────────────
// (registry can resolve more; widening = add a key here, same policy as the
// WhatsApp template slice). Sample values feed the Settings preview only.
export const DEAL_NOTE_VARIABLES = [
  { key: 'group_name', sample: 'קבוצת הדוגמה' },
  { key: 'tour_date', sample: '01/01/2027' },
  { key: 'tour_time', sample: '10:00' },
  { key: 'participants', sample: '25' },
  { key: 'deal_number', sample: '27123' },
  { key: 'org_name', sample: 'ארגון לדוגמה' },
  { key: 'sub_organization', sample: 'מחלקת חינוך' },
  { key: 'customer_full_name', sample: 'ישראל ישראלי' },
  { key: 'tour_product', sample: 'סיור גרפיטי בפלורנטין' },
  { key: 'tour_city', sample: 'תל אביב' },
];
const DEAL_KEYS = new Set(DEAL_NOTE_VARIABLES.map((v) => v.key));

// ── Default content — the approved standard wording ──────────────────────────
// Recovered VERBATIM from live iCount חשבון עסקה documents (doc/info hwc,
// verified identical across recent documents, 2026-08-02). Do not rewrite the
// policy text in code — it is operator-editable in Finance Settings.
export const DEFAULT_SETTINGS = {
  bankAccountHolder: 'גרפיטיול בע"מ',
  bankName: 'הפועלים',
  bankNumber: '12',
  bankBranchName: 'יפו',
  bankBranchNumber: '611',
  bankAccountNumber: '219583',
  dealInfoTemplate: 'שם הקבוצה: {{group_name}}\nתאריך הסיור: {{tour_date}}\nכמות משתתפים: {{participants}}',
  bankTemplate:
    'ניתן לשלם בהעברה בנקאית מראש לחשבון: {{bank_account_holder}} , {{bank_name}} - בנק {{bank_number}} , סניף -{{bank_branch_number}} {{bank_branch_name}}, מספר חשבון: {{bank_account_number}}',
  cancellationTemplate:
    'מדיניות ביטול/ דחייה:\n' +
    'ביטול פעילות: ניתן לבטל את הפעילות מכל סיבה שהיא עד 96 שעות טרם המועד שנקבע, ויתקבל החזר כספי מלא\n' +
    'באשראי/ביט/העברה בנקאית. יש לעשות זאת על ידי הודעה מראש באמצעות המייל, אבל ההפסד כולו שלכם\n' +
    'דחיית הפעילות: במידת הצורך, ניתן לדחות את הפעילות עד 48 שעות לפני.\n' +
    'ביטול או דחייה בתוך 48 השעות שטרם הפעילות יגרור חיוב מלא.',
  dealInfoIncludeDeal: true,
  dealInfoIncludeInvoice: false,
  bankIncludeDeal: true,
  bankIncludeInvoice: false,
  cancellationIncludeDeal: true,
  cancellationIncludeInvoice: false,
};

const BLOCKS = ['dealInfo', 'bank', 'cancellation'];

// Singleton read with lazy seeding (TourSettings / GuidePortalSettings pattern).
export async function getAccountingDocSettings(prisma) {
  const existing = await prisma.accountingDocSettings.findUnique({ where: { id: 'singleton' } });
  if (existing) return existing;
  return prisma.accountingDocSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton', ...DEFAULT_SETTINGS },
  });
}

/** Tokens in a template that neither the bank fields nor the deal whitelist
 *  can resolve — save-time rejection so they can never reach a document. */
export function unknownDocNoteTokens(template) {
  return extractTokens(template).filter((k) => !BANK_FIELD_BY_TOKEN[k] && !DEAL_KEYS.has(k));
}

// The minimal variable-resolution context from a deal loaded with
// ICOUNT_DEAL_INCLUDE — same registry, no extra queries.
export function dealNotesContext(deal) {
  if (!deal) return null;
  return {
    deal,
    org: deal.organization || null,
    contact: deal.contacts?.[0]?.contact || null,
    tour: null, // registry resolvers fall back to deal.tourDate / tourTime
  };
}

const normalizeForMatch = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** The template's longest literal segment (text between/around tokens and
 *  newlines), whitespace-normalized — the deterministic dedup anchor. */
export function blockAnchor(template) {
  const segments = String(template || '')
    .replace(TOKEN_RE, '\u0000')
    .split(/[\n\u0000]/)
    .map(normalizeForMatch)
    .filter((s) => s.length >= 8);
  if (!segments.length) return null;
  return segments.reduce((a, b) => (b.length > a.length ? b : a));
}

/** Is this block already present in `text`? (anchor containment, normalized) */
export function blockPresent(text, template) {
  const anchor = blockAnchor(template);
  if (!anchor) return false;
  return normalizeForMatch(text).includes(anchor);
}

// Render ONE block: bank tokens from the settings fields, deal tokens through
// the canonical registry; every referenced token is substituted (empty when
// missing/unknown) so raw moustache never survives into a document.
export function renderBlock(template, settings, dealCtx) {
  const tokens = extractTokens(template);
  if (!tokens.length) return String(template || '');
  const fill = {};
  const dealKeys = [];
  for (const t of tokens) {
    if (BANK_FIELD_BY_TOKEN[t]) fill[t] = String(settings?.[BANK_FIELD_BY_TOKEN[t]] || '').trim();
    else if (DEAL_KEYS.has(t)) dealKeys.push(t);
    else fill[t] = '';
  }
  if (dealKeys.length) {
    const { values } = dealCtx ? resolveVariables(dealKeys, dealCtx, 'he') : { values: {} };
    for (const k of dealKeys) fill[k] = values[k] ?? '';
  }
  const out = substituteTokens(template, fill);
  return tokens.some((t) => !fill[t]) ? normalizeAfterEmptyFill(out) : out;
}

/**
 * Compose the suggested Notes text for one document type.
 *   inherited notes (based-on document's hwc, verbatim)
 *   + each enabled-for-doctype block not already present in the inherited text
 * Blocks join with single newlines (the standard wording is contiguous);
 * inherited text is separated from appended blocks by a blank line.
 * Doctypes without default flags (invrec / receipt / refund) get the inherited
 * text only.
 */
export function composeNotesForDoctype(settings, doctype, dealCtx, { inheritedNotes = '' } = {}) {
  const inherited = String(inheritedNotes || '').trim();
  const flagSuffix = doctype === 'deal' ? 'IncludeDeal' : doctype === 'invoice' ? 'IncludeInvoice' : null;
  if (!flagSuffix) return inherited;

  const rendered = [];
  for (const block of BLOCKS) {
    if (!settings?.[`${block}${flagSuffix}`]) continue;
    const template = String(settings?.[`${block}Template`] || '');
    if (!template.trim()) continue;
    if (inherited && blockPresent(inherited, template)) continue;
    const text = renderBlock(template, settings, dealCtx).trim();
    if (text) rendered.push(text);
  }
  return [inherited, rendered.join('\n')].filter(Boolean).join('\n\n');
}

/** The per-doctype suggestion map the modal swaps through as the operator
 *  changes the document type / base selection. */
export function buildNotesByDoctype(settings, deal, { inheritedNotes = '' } = {}) {
  const ctx = dealNotesContext(deal);
  const map = {};
  for (const doctype of ['deal', 'invoice', 'invrec', 'receipt', 'refund']) {
    map[doctype] = composeNotesForDoctype(settings, doctype, ctx, { inheritedNotes });
  }
  return map;
}

// ── Settings-screen support ──────────────────────────────────────────────────

/** Variable catalogs for the settings screen picker + client-side preview:
 *  bank entries carry the structured-field name their value resolves from,
 *  deal entries carry a sample value. Labels come from the canonical registry
 *  (variableByKey injected to avoid a circular import). */
export function docNotesVariableCatalog(variableByKey) {
  return {
    bank: BANK_VARIABLES.map(({ key, labelHe, field }) => ({ key, labelHe, field })),
    deal: DEAL_NOTE_VARIABLES.map(({ key, sample }) => ({
      key,
      labelHe: variableByKey(key)?.labelHe || key,
      sample,
    })),
  };
}
