// Name Cleanup — source contacts whose NAME cannot be imported cleanly into the
// existing GOS Contact model.
//
// ── THE MODEL THIS MUST SATISFY ───────────────────────────────────────────────
// GOS Contact carries FOUR name fields (firstNameHe, lastNameHe, firstNameEn,
// lastNameEn) and ONE validation rule, from routes/contacts.js:
//     if (!firstNameHe && !firstNameEn) → 400 first_name_required
// Surnames may be empty. Pipedrive persons only ever carry first_name/last_name in
// ONE language, so the default import is a script split: a Hebrew name fills the He
// pair, an English name fills the En pair, and the other pair stays empty. That is
// legal and needs no owner decision.
//
// ── WHAT THIS QUEUE IS NOT ────────────────────────────────────────────────────
// Measured on Snapshot #1: 15,184 importable contacts have no name issue at all,
// and a further 5,831 have a first name but no surname — which is PERFECTLY VALID
// ("אילנה" is a complete GOS contact). Neither may ever enter this queue. The real
// defect is the inverse: a name that lives ONLY in last_name produces two empty
// first-name fields and fails validation outright.
//
// A cleanup NEVER silently moves a name between fields: every move is a proposal
// the owner approves, edits, or rejects. The owner's final fields are binding.
import { isNewContactName } from '../phoneCompare.js';
import { sectionForSingle, isImportable } from './contactSections.js';
import { defaultPhoneRow, resolvePhoneRow } from './namePhones.js';
import { applyIdentityEdit } from './contactIdentity.js';

const t = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const HEBREW = /[֐-׿]/, LATIN = /[A-Za-z]/;
export function scriptOf(s) {
  const v = t(s);
  if (!v) return 'empty';
  const h = HEBREW.test(v), l = LATIN.test(v);
  if (h && l) return 'mixed';
  if (h) return 'he';
  if (l) return 'en';
  return 'other'; // digits, punctuation, symbols — not a name in any language
}

// ── detectors ─────────────────────────────────────────────────────────────────
const EMAIL_RE = /@/;
const PHONE_RE = /^[\d\s()+\-.]{6,}$/;
// Organisation markers. Deliberately generic legal/institutional words — NOT a
// hardcoded list of banks, health funds or universities (an owner-approved rule).
const COMPANY_RE = /(בע"?מ|בעמ|חל"?צ|עמותה|חברת|בית ספר|בי"?ס|מלון|קיבוץ|מועצה|משרד ה|אוניברסיט|מכללה|בנק |עיריי?ת|\bltd\b|\bl\.t\.d\b|\binc\b|\bllc\b|\bgmbh\b|\bcorp\b|\bcompany\b)/i;
// Operational notes typed into a name field, and test/junk records.
const OPS_RE = /(\btest\b|בדיקה|בדיקת|\bdemo\b|\bdev\b|לא לשלוח|למחוק|לא רלוונטי|ללא שם|no name|unknown|\?\?)/i;
const MARKUP_RE = /[<>|{}[\]]|https?:\/\//i;
const JUNK_ONLY_RE = /^[-–—.,_*/\\+#'"`~^]+$/;

export const CLEANUP_KINDS = {
  no_first_name: { label: 'אין שם פרטי — הייבוא ייכשל', blocking: true, deterministic: true },
  name_is_email: { label: 'כתובת אימייל בשדה השם', blocking: false, deterministic: false },
  name_is_phone: { label: 'מספר טלפון בשדה השם', blocking: false, deterministic: false },
  name_is_company: { label: 'שם של ארגון ולא של אדם', blocking: false, deterministic: false },
  operational_text: { label: 'טקסט תפעולי בתוך השם', blocking: false, deterministic: false },
  junk_name: { label: 'השם אינו שם בשום שפה', blocking: false, deterministic: false },
  cross_script_fields: { label: 'עברית ואנגלית בשדות הלא נכונים', blocking: false, deterministic: false },
  mixed_script_field: { label: 'עברית ואנגלית מעורבות באותו שדה', blocking: false, deterministic: false },
  junk_surname: { label: 'שם המשפחה אינו שם', blocking: false, deterministic: true },
};

// The default, no-decision-needed import mapping: split by script, other pair empty.
export function defaultFields(first, last) {
  const f = t(first), l = t(last);
  const s = scriptOf(f) === 'empty' ? scriptOf(l) : scriptOf(f);
  if (s === 'en') return { firstNameHe: '', lastNameHe: '', firstNameEn: f, lastNameEn: l };
  return { firstNameHe: f, lastNameHe: l, firstNameEn: '', lastNameEn: '' };
}

// The canonical GOS rule, mirrored EXACTLY (routes/contacts.js).
export function validateContactNames(fields) {
  const problems = [];
  if (!t(fields.firstNameHe) && !t(fields.firstNameEn)) problems.push('חובה שם פרטי — בעברית או באנגלית');
  return { valid: problems.length === 0, problems };
}

// What is wrong with this record's name, and what should it become?
// Returns null when the name imports cleanly and needs no owner decision.
export function analyzeName(person) {
  const first = t(person.first_name ?? person.firstName);
  const last = t(person.last_name ?? person.lastName);
  const display = t(person.name);
  const whole = `${first} ${last}`.trim() || display;
  const sf = scriptOf(first), sl = scriptOf(last);

  const issues = [];
  if (!first && !last && !display) issues.push('junk_name');
  if (!first && last) issues.push('no_first_name');
  if (EMAIL_RE.test(whole)) issues.push('name_is_email');
  if (PHONE_RE.test(whole)) issues.push('name_is_phone');
  if (COMPANY_RE.test(whole)) issues.push('name_is_company');
  if (OPS_RE.test(whole) || MARKUP_RE.test(whole)) issues.push('operational_text');
  if (first && JUNK_ONLY_RE.test(first)) issues.push('junk_name');
  if (last && JUNK_ONLY_RE.test(last)) issues.push('junk_surname');
  if (sf === 'other' && sl === 'empty' && !issues.includes('junk_name')) issues.push('junk_name');
  if (sl === 'other' && !issues.includes('junk_surname')) issues.push('junk_surname');
  if (sf !== 'empty' && sl !== 'empty' && sf !== sl && ['he', 'en'].includes(sf) && ['he', 'en'].includes(sl)) issues.push('cross_script_fields');
  if (sf === 'mixed' || sl === 'mixed') issues.push('mixed_script_field');

  // A first name with no surname is COMPLETE — never a cleanup case.
  if (!issues.length) return null;

  return { issues, ...proposeFor({ first, last, display, sf, sl, issues }) };
}

function proposeFor({ first, last, sf, sl, issues }) {
  // Records that are not people at all: propose exclusion, never a guessed name.
  // Always ambiguous — only the owner knows whether a company name hides a real
  // contact behind it.
  if (issues.some((i) => ['name_is_email', 'name_is_phone', 'name_is_company', 'operational_text', 'junk_name'].includes(i))) {
    const why = issues.includes('name_is_email') ? 'כתובת אימייל'
      : issues.includes('name_is_phone') ? 'מספר טלפון'
      : issues.includes('name_is_company') ? 'שם של ארגון'
      : issues.includes('junk_name') ? 'לא שם של אדם'
      : 'טקסט תפעולי';
    return {
      treatment: 'exclude',
      fields: defaultFields(first, last),
      deterministic: false,
      reason: `בשדה השם מופיע ${why} ולא שם של אדם. הצעה: לא לייבא כאיש קשר — הרשומה נשמרת בצילום ובארכיון.`,
    };
  }

  // The name lives only in last_name → the import would fail validation.
  //
  // NOT deterministic, despite being mechanically trivial. Moving the string is
  // only identity-preserving IF the record is a person — and that is exactly what
  // cannot be determined automatically. A measured sample of this class was
  // dominated by ORGANISATIONS ("<firm> ושות", "… Tours", acronyms, nonprofits)
  // that no generic company pattern catches, and hardcoding organisation-type
  // names is an owner-approved prohibition. Batch-approving would have created
  // ~85 GOS "people" named after companies. Only the owner can tell these apart,
  // so every one of them is an individual decision.
  if (issues.includes('no_first_name')) {
    const s = sl === 'en' ? 'en' : 'he';
    const fields = s === 'en'
      ? { firstNameHe: '', lastNameHe: '', firstNameEn: last, lastNameEn: '' }
      : { firstNameHe: last, lastNameHe: '', firstNameEn: '', lastNameEn: '' };
    return {
      treatment: 'import',
      fields,
      deterministic: false,
      reason: `השם קיים רק בשדה שם המשפחה, ולכן הייבוא ייכשל (חובה שם פרטי). ההצעה מעבירה "${last}" לשם הפרטי — אבל בדוק קודם: אם זה שם של ארגון ולא של אדם, עדיף להחריג.`,
    };
  }

  // Hebrew and English split across the two fields. Both are real, but neither
  // language pair is complete — only the owner can say which is the person's name
  // and which is a transliteration.
  if (issues.includes('cross_script_fields')) {
    const fields = sf === 'he'
      ? { firstNameHe: first, lastNameHe: '', firstNameEn: '', lastNameEn: last }
      : { firstNameHe: '', lastNameHe: last, firstNameEn: first, lastNameEn: '' };
    return {
      treatment: 'import',
      fields,
      deterministic: false,
      reason: `השם הפרטי ב${sf === 'he' ? 'עברית' : 'אנגלית'} ושם המשפחה ב${sl === 'he' ? 'עברית' : 'אנגלית'}. ההצעה משאירה כל חלק בשפה שלו — כדאי להשלים ידנית את השדות החסרים.`,
    };
  }

  if (issues.includes('mixed_script_field')) {
    return {
      treatment: 'import',
      fields: defaultFields(first, last),
      deterministic: false,
      reason: 'עברית ואנגלית מעורבות באותו שדה — אי אפשר לפצל אוטומטית בלי לנחש. נדרשת הכרעה.',
    };
  }

  // Only the surname is junk ("-", a phone number, punctuation): drop it and keep
  // the person. Deterministic in the sense that MATTERS: the FIRST NAME — the field
  // that carries identity and that GOS validates — is untouched, and the record was
  // already importable, so this changes tidiness and nothing else. Note this DOES
  // discard a token; it is not "the same string", and the discarded value stays
  // visible in the snapshot and in the proposal's `original`.
  if (issues.includes('junk_surname')) {
    const d = defaultFields(first, '');
    return {
      treatment: 'import',
      fields: d,
      deterministic: true,
      reason: `שם המשפחה ("${last}") אינו שם. הצעה: לייבא בלי שם משפחה — השם הפרטי נשאר בדיוק כפי שהוא.`,
    };
  }

  return { treatment: 'import', fields: defaultFields(first, last), deterministic: false, reason: 'נדרשת הכרעה.' };
}

export const nameSubjectKey = (legacyId) => `name:${legacyId}`;
export const legacyIdFromNameKey = (k) => {
  const m = /^name:(\d+)$/.exec(String(k || ''));
  return m ? Number(m[1]) : null;
};

// One proposal row. `section` reuses the Contacts business-impact ladder so the two
// queues rank work the same way; an empty shell lands in `none` and costs the owner
// nothing (subject to the secondary-participant question staying open).
export function buildNameProposal(person, analysis) {
  const importableNow = isImportable(person);
  // A single record, NOT a cluster: one importable record is a real decision.
  const section = sectionForSingle(person);
  const fields = analysis.fields;
  const validation = validateContactNames(fields);
  return {
    kind: 'name_cleanup',
    legacyId: person.legacyId,
    displayName: t(person.name) || '(ללא שם)',
    // The EXACT source fields, always shown, never rewritten.
    original: {
      name: t(person.name),
      first_name: t(person.firstName),
      last_name: t(person.lastName),
    },
    // What the default import would have produced with no cleanup — so the owner can
    // see precisely what the proposal changes.
    currentMapping: defaultFields(person.firstName, person.lastName),
    proposedFields: fields,
    treatment: analysis.treatment,
    deterministic: analysis.deterministic,
    issues: analysis.issues,
    issueLabels: analysis.issues.map((i) => CLEANUP_KINDS[i]?.label || i),
    reason: analysis.reason,
    // A record whose import would CRASH is blocking; everything else is tidiness.
    blocking: analysis.issues.some((i) => CLEANUP_KINDS[i]?.blocking) && importableNow,
    validationBefore: validateContactNames(defaultFields(person.firstName, person.lastName)),
    validationAfter: validation,
    context: {
      phones: person.phones || [],
      emails: person.emails || [],
      orgName: person.orgName || null,
      orgId: person.orgId || null,
      dealCount: person.dealCount || 0,
      openDealCount: person.openDealCount || 0,
      futureTourDeals: person.futureTourDeals || 0,
      activityCount: person.activityCount || 0,
      noteCount: person.noteCount || 0,
      operationallyActive: (person.openDealCount || 0) > 0 || (person.futureTourDeals || 0) > 0,
    },
    importable: importableNow,
    section,
    // Deterministic AND identity-preserving → may be batch-approved as a group.
    // Never applied without the owner pressing the button.
    batchApprovable: analysis.deterministic && analysis.treatment === 'import' && importableNow,
    decisionRequired: importableNow,
    source: { entity: 'pipedrive/persons', id: person.legacyId },
  };
}

export function buildNameCleanupProposals({ contacts }) {
  const proposals = [];
  let scanned = 0, spam = 0, clean = 0, shells = 0;
  for (const c of contacts) {
    // "New Contact" spam is excluded from Contact creation entirely — it is not a
    // name to clean, it is a record that never becomes a contact.
    if (isNewContactName(`${c.firstName || ''} ${c.name || ''}`)) { spam++; continue; }
    scanned++;
    const a = analyzeName({ name: c.name, first_name: c.firstName, last_name: c.lastName });
    if (!a) { clean++; continue; }
    const p = buildNameProposal(c, a);
    if (!p.importable) shells++;
    proposals.push(p);
  }
  proposals.sort(compareNameProposals);
  proposals.forEach((p, i) => { p.rank = i + 1; });

  const bySection = {};
  const byIssue = {};
  for (const p of proposals) {
    bySection[p.section] = (bySection[p.section] || 0) + 1;
    for (const i of p.issues) byIssue[i] = (byIssue[i] || 0) + 1;
  }
  return {
    proposals,
    stats: {
      totalPersons: contacts.length,
      newContactSpamExcluded: spam,
      scanned,
      noCleanupRequired: clean,
      requiresDecision: proposals.filter((p) => p.decisionRequired).length,
      batchApprovable: proposals.filter((p) => p.batchApprovable).length,
      needsIndividualReview: proposals.filter((p) => p.decisionRequired && !p.batchApprovable).length,
      criticalBeforeImport: proposals.filter((p) => p.decisionRequired && p.section === 'critical').length,
      blockingValidation: proposals.filter((p) => p.blocking).length,
      proposedExclusion: proposals.filter((p) => p.treatment === 'exclude' && p.importable).length,
      emptyShellIssues: shells,
      bySection,
      byIssue,
    },
  };
}

const SEC_RANK = { critical: 0, recent: 1, historical: 2, low: 3, none: 4, safe: 5 };
export function compareNameProposals(a, b) {
  return (
    (SEC_RANK[a.section] ?? 9) - (SEC_RANK[b.section] ?? 9) ||
    Number(b.blocking) - Number(a.blocking) ||
    b.context.openDealCount - a.context.openDealCount ||
    b.context.futureTourDeals - a.context.futureTourDeals ||
    b.context.dealCount - a.context.dealCount ||
    a.legacyId - b.legacyId
  );
}

// The owner's binding result. Their edited fields ARE the Identity Import outcome.
//
// `phones` is the owner's phone-editing state (see namePhones.js). When present,
// approval gates on it strictly; when ABSENT (the deterministic name-only batch),
// the decision records phones as NOT EDITED and the import uses the original
// snapshot values untouched — exactly what happens to the 27k contacts that never
// enter this queue at all. One resolver, two documented modes; never two
// interpretations of the same decision.
export function nameDraftFromProposal(proposal, decision = null) {
  // Tolerate a partial decision and a proposal with no fields: fall back rather than
  // throw, so a malformed payload becomes a validation error the owner can see.
  const base = decision?.fields || proposal?.proposedFields || { firstNameHe: '', lastNameHe: '', firstNameEn: '', lastNameEn: '' };
  const sourcePhones = proposal?.context?.phones || [];
  const phones = Array.isArray(decision?.phones)
    ? decision.phones.map((p) => ({ ...defaultPhoneRow(p.original, 0), ...p }))
    : sourcePhones.map((raw, i) => defaultPhoneRow(raw, i));
  return {
    treatment: decision?.treatment || proposal?.treatment || 'import',
    fields: {
      firstNameHe: t(base.firstNameHe), lastNameHe: t(base.lastNameHe),
      firstNameEn: t(base.firstNameEn), lastNameEn: t(base.lastNameEn),
    },
    phones,
  };
}

// ctx (all optional, supplied by the service):
//   identityEdit  — this person's contact_identity override, for effective emails.
//   claimedPhones — Map<normalizedDigits, {label}> of numbers already claimed by
//                   OTHER decisions; a kept phone colliding with one is a blocker.
export function resolveNameResult(proposal, draft, ctx = {}) {
  const fields = {
    firstNameHe: t(draft.fields.firstNameHe), lastNameHe: t(draft.fields.lastNameHe),
    firstNameEn: t(draft.fields.firstNameEn), lastNameEn: t(draft.fields.lastNameEn),
  };
  const excluded = draft.treatment === 'exclude';
  const problems = [];
  const warnings = [];
  if (!excluded) problems.push(...validateContactNames(fields).problems);

  // ── phones (only when the draft carries them — i.e. the editing flow) ────────
  let phones = null;
  if (!excluded && Array.isArray(draft.phones)) {
    phones = draft.phones.map((row) => resolvePhoneRow(row));
    const kept = phones.filter((p) => !p.remove);
    for (const p of kept) {
      for (const prob of p.problems) problems.push(`טלפון ${p.value || p.original}: ${prob}`);
    }
    // The same normalized number twice on one contact.
    const seen = new Map();
    for (const p of kept) {
      if (!p.normalized) continue;
      if (seen.has(p.normalized)) problems.push(`המספר ${p.normalized} מופיע פעמיים באיש הקשר`);
      seen.set(p.normalized, true);
    }
    // Claimed elsewhere. Removing the phone resolves the conflict; keeping it blocks.
    for (const p of kept) {
      if (!p.normalized) continue;
      const owner = ctx.claimedPhones?.get?.(p.normalized);
      if (owner) problems.push(`המספר ${p.normalized} כבר שויך להחלטה אחרת (${owner.label}) — הסר אותו מאחד הצדדים`);
    }
    if (kept.filter((p) => p.isPrimary).length > 1) problems.push('סומן יותר מטלפון מועדף אחד');
    const removed = phones.filter((p) => p.remove);
    if (removed.length) warnings.push(`${removed.length} מספרים לא ייובאו — הם נשארים בצילום ובארכיון`);
  }

  // ── effective emails: identity corrections applied, never re-derived ─────────
  const emails = excluded ? [] : applyIdentityEdit({ phones: [], emails: proposal.context?.emails || [] }, ctx.identityEdit || null).emails;

  if (!excluded) {
    const orig = `${proposal.original.first_name} ${proposal.original.last_name}`.trim();
    const now = [fields.firstNameHe, fields.lastNameHe, fields.firstNameEn, fields.lastNameEn].filter(Boolean).join(' ');
    if (orig && now && orig !== now) warnings.push(`השם שונה מהמקור: "${orig}" ← "${now}"`);
  }
  if (excluded && proposal.context.dealCount > 0) {
    warnings.push(`הרשומה מוחרגת למרות ${proposal.context.dealCount} עסקאות מקושרות — העסקאות יישארו ללא איש קשר`);
  }
  return {
    treatment: draft.treatment,
    fields,
    displayHe: `${fields.firstNameHe} ${fields.lastNameHe}`.trim(),
    displayEn: `${fields.firstNameEn} ${fields.lastNameEn}`.trim(),
    // The import payload, per phone: original / country / edited value / normalized.
    phones: phones
      ? phones.map((p) => ({
          original: p.original, country: p.country, value: t(p.value),
          normalized: p.normalized, isPrimary: !!p.isPrimary, remove: !!p.remove,
          confirmUnverified: !!p.confirmUnverified, problems: p.problems,
        }))
      : null,
    emails,
    excluded,
    warnings,
    problems,
    valid: problems.length === 0,
  };
}

export function nameDecisionFromDraft(proposal, draft, ctx = {}) {
  const result = resolveNameResult(proposal, draft, ctx);
  return {
    treatment: draft.treatment,
    fields: result.fields,
    // Kept phones with their full audit shape; removed ones stay listed with
    // remove:true so the decision is complete. null = phones were never edited
    // (batch name-only fix) and the import uses the snapshot originals.
    phones: result.phones,
    result,
  };
}
