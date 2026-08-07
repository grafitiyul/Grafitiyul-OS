// ── Deal merge: THE resolution rules ────────────────────────────────────────
//
// Pure functions only — no Prisma, no IO — so every rule about "what happens to
// this field when two deals become one" is unit-testable without a database,
// and the orchestrator (dealMerge.js) contains sequencing rather than policy.
//
// ── The classification, and why it is a table ───────────────────────────────
// A deal has ~30 meaningful fields. Merging two of them is not one decision, it
// is thirty, and the ONLY way that stays correct as the Deal model grows is a
// table that names every field and its policy. A field added to Deal that
// belongs in a merge gets a row here; one that must never travel is listed in
// NEVER_MERGED with the reason. The shape test asserts both lists are real
// Prisma fields, so a rename cannot leave a silently dead rule behind.
//
// ── The auto-resolve rule ───────────────────────────────────────────────────
// The operator is asked ONLY about genuine conflicts. Everywhere one side is
// empty, or both agree, the answer is not a decision — it is arithmetic — and
// prompting for it would train the operator to click through the screen that
// also contains the real questions.
//
//     one side empty      → take the non-empty one   (reported, never asked)
//     both equal          → keep it                  (reported, never asked)
//     both set, different → ASK                      (the only prompts)

import { lineSign } from '../../../shared/lineMath.mjs';

// ── What "empty" means ──────────────────────────────────────────────────────
// Deliberately NOT a blanket falsy test. `0` is empty for a COUNT or a PRICE
// (a deal worth ₪0 carries no commercial information — the spec's own rule),
// and meaningful nowhere else in this table, so numeric emptiness is opt-in per
// field rather than global. `false` is never empty.
export function isEmptyValue(v, { zeroIsEmpty = false } = {}) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (zeroIsEmpty && (typeof v === 'number' || typeof v === 'bigint')) return Number(v) === 0;
  return false;
}

// Values are compared as strings so a BigInt total and its Number twin, or a
// Date and its ISO string, cannot read as "different" and raise a phantom
// conflict the operator has no way to resolve.
export function sameValue(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (a instanceof Date || b instanceof Date) {
    return new Date(a).getTime() === new Date(b).getTime();
  }
  return String(a) === String(b);
}

// ── THE field table ─────────────────────────────────────────────────────────
// `group` drives how the wizard lays the conflict out; `labelHe` is what the
// operator reads (never the column name — rule 9 of the product standards).
// `zeroIsEmpty` marks the numeric fields where 0 means "not filled in".
export const MERGE_FIELDS = Object.freeze([
  // commercial / classification
  { key: 'organizationId', labelHe: 'ארגון', group: 'classification', ref: 'organization' },
  { key: 'organizationUnitId', labelHe: 'סניף / יחידה', group: 'classification', follows: 'organizationId' },
  { key: 'organizationSubtypeId', labelHe: 'תת-סוג ארגון', group: 'classification', follows: 'organizationId' },
  { key: 'organizationTypeId', labelHe: 'סוג ארגון', group: 'classification', follows: 'organizationId' },
  { key: 'activityType', labelHe: 'סוג פעילות', group: 'classification' },
  // operational context
  { key: 'productId', labelHe: 'מוצר', group: 'operational', ref: 'product' },
  { key: 'productVariantId', labelHe: 'וריאנט / עיר', group: 'operational', follows: 'productId' },
  { key: 'locationId', labelHe: 'עיר', group: 'operational' },
  { key: 'tourDate', labelHe: 'תאריך הפעילות', group: 'operational' },
  { key: 'tourTime', labelHe: 'שעת הפעילות', group: 'operational' },
  { key: 'groups', labelHe: 'מספר קבוצות', group: 'operational', zeroIsEmpty: true },
  { key: 'durationHours', labelHe: 'משך הפעילות', group: 'operational', zeroIsEmpty: true },
  { key: 'tourLanguage', labelHe: 'שפת הסיור', group: 'operational' },
  // commercial terms
  { key: 'paymentTermId', labelHe: 'תנאי תשלום', group: 'commercial' },
  { key: 'paymentMethodId', labelHe: 'אמצעי תשלום', group: 'commercial' },
  { key: 'currency', labelHe: 'מטבע', group: 'commercial' },
  // CRM context
  { key: 'dealSourceId', labelHe: 'מקור הליד', group: 'crm' },
  { key: 'source', labelHe: 'פירוט מקור', group: 'crm' },
  { key: 'communicationLanguage', labelHe: 'שפת תקשורת', group: 'crm' },
  { key: 'groupName', labelHe: 'שם הקבוצה', group: 'crm' },
  { key: 'expectedCloseDate', labelHe: 'תאריך סגירה צפוי', group: 'crm' },
  { key: 'ownerUserId', labelHe: 'אחראי', group: 'crm' },
]);

/**
 * Fields that NEVER travel from the retired deal, each with the reason. Not
 * decoration: the merge writes only MERGE_FIELDS, so this list is the
 * documented, reviewable answer to "why didn't X come across?" — and the shape
 * test proves every name here is a real column.
 */
export const NEVER_MERGED = Object.freeze({
  orderNo: 'מספר ההזמנה של הדיל השורד נשמר — מספרים לעולם אינם ממוחזרים',
  paymentToken: 'קישור התשלום הקבוע שייך לדיל שהפיק אותו',
  wonAt: 'רגע הסגירה הוא עובדה היסטורית של הדיל שנסגר',
  wonActor: 'מי סגר את הדיל הוא תיעוד היסטורי בלתי משתנה',
  wonQuoteRef: 'ההצעה שעליה נסגר הדיל היא תיעוד היסטורי',
  historicalWonAt: 'תיקון היסטורי מתועד שייך לדיל שבו בוצע',
  historicalWonNote: 'תיקון היסטורי מתועד שייך לדיל שבו בוצע',
  lostAt: 'סיבת ומועד ה-LOST הם היסטוריה של הדיל שאבד',
  lostReasonId: 'סיבת ומועד ה-LOST הם היסטוריה של הדיל שאבד',
  lostNotes: 'סיבת ומועד ה-LOST הם היסטוריה של הדיל שאבד',
  noPaymentWaiver: 'ויתור על תשלום הוא החלטה על הכסף של דיל מסוים',
  conversionOpId: 'מזהה פעולה טכני של הדיל המקורי',
  collectionReview: 'סימון בדיקת גבייה מתייחס לראיות של הדיל המקורי',
  collectionReviewStatus: 'סטטוס תור הגבייה מחושב מחדש לדיל השורד',
  paymentReviewStatus: 'סיווג התשלום מתייחס לראיות של הדיל המקורי',
  lastViewedAt: 'מי צפה בדיל אינו נתון עסקי',
  lastViewedById: 'מי צפה בדיל אינו נתון עסקי',
  lastViewedByName: 'מי צפה בדיל אינו נתון עסקי',
  basePriceOverridden: 'דגל מדור קודם שאינו בשימוש',
});

/**
 * Resolve ONE field.
 *
 * @returns { key, labelHe, group, resolution, value, survivorValue, otherValue }
 *   resolution: 'equal' | 'survivor_only' | 'other_only' | 'conflict' | 'both_empty'
 */
export function resolveField(field, survivor, other, choice = null) {
  const { key } = field;
  const a = survivor?.[key] ?? null;
  const b = other?.[key] ?? null;
  const opts = { zeroIsEmpty: !!field.zeroIsEmpty };
  const aEmpty = isEmptyValue(a, opts);
  const bEmpty = isEmptyValue(b, opts);

  const base = { ...field, survivorValue: a, otherValue: b };
  if (aEmpty && bEmpty) return { ...base, resolution: 'both_empty', value: a };
  if (!aEmpty && bEmpty) return { ...base, resolution: 'survivor_only', value: a };
  if (aEmpty && !bEmpty) return { ...base, resolution: 'other_only', value: b };
  if (sameValue(a, b)) return { ...base, resolution: 'equal', value: a };
  // Both set and different — the operator's call. Until they make it, the
  // survivor's value stands, so a preview is always renderable and a merge
  // confirmed without an answer can never invent one.
  return { ...base, resolution: 'conflict', value: choice === 'other' ? b : a, choice: choice || null };
}

/**
 * Resolve every field in the table.
 *
 * `choices` is { [fieldKey]: 'survivor' | 'other' } — only conflicts consult it.
 *
 * ── Dependent fields ──
 * `follows` binds a field to its parent (a unit belongs to an organization; a
 * variant belongs to a product). When the parent resolves to a side, the child
 * takes THAT SIDE'S value even if the child would have resolved differently on
 * its own — otherwise a merge could pair organization A with a branch that
 * belongs to organization B, which is not a state the CRM can represent.
 */
export function resolveFields(survivor, other, choices = {}) {
  const byKey = new Map();
  const results = [];
  for (const field of MERGE_FIELDS) {
    const r = resolveField(field, survivor, other, choices[field.key]);
    byKey.set(field.key, r);
    results.push(r);
  }

  for (const r of results) {
    if (!r.follows) continue;
    const parent = byKey.get(r.follows);
    if (!parent) continue;
    // Which side did the parent actually land on?
    const parentSide =
      parent.resolution === 'other_only' || (parent.resolution === 'conflict' && parent.choice === 'other')
        ? 'other'
        : 'survivor';
    const forced = parentSide === 'other' ? r.otherValue : r.survivorValue;
    if (!sameValue(r.value, forced)) {
      r.value = forced;
      r.forcedBy = r.follows;
      // A child dragged along by its parent is no longer an open question.
      if (r.resolution === 'conflict') r.resolution = 'resolved_by_parent';
    }
  }

  const patch = {};
  for (const r of results) {
    // 'both_empty' writes nothing: sending null for a field that is already
    // null is noise in the changelog, and Prisma rejects a plain null on
    // nullable Json columns.
    if (r.resolution === 'both_empty') continue;
    patch[r.key] = r.value;
  }

  return {
    fields: results,
    patch,
    conflicts: results.filter((r) => r.resolution === 'conflict'),
    autoResolved: results.filter((r) => r.resolution === 'other_only'),
    unanswered: results.filter((r) => r.resolution === 'conflict' && !r.choice),
  };
}

// ── Participants ────────────────────────────────────────────────────────────

export const PARTICIPANT_CHOICES = Object.freeze(['survivor', 'other', 'combined', 'custom']);

/**
 * The participant count of the merged deal.
 *
 * Combining is NEVER the default. Two deals for the same real transaction most
 * often describe the SAME people twice (that is why they are being merged), so
 * summing would silently double the group; but two contacts who each booked
 * their own half is equally real. Only the operator knows which, so a genuine
 * conflict is always asked, and `combined` is one option among four rather than
 * an assumption.
 */
export function resolveParticipants(survivorCount, otherCount, choice = null, custom = null) {
  const a = Number(survivorCount) || 0;
  const b = Number(otherCount) || 0;

  if (a === 0 && b === 0) return { resolution: 'both_empty', value: null, needsChoice: false };
  if (a > 0 && b === 0) return { resolution: 'survivor_only', value: a, needsChoice: false };
  if (a === 0 && b > 0) return { resolution: 'other_only', value: b, needsChoice: false };
  if (a === b) return { resolution: 'equal', value: a, needsChoice: false };

  // `custom` with an empty box must stay UNANSWERED, not collapse to zero:
  // Number(null) and Number('') are both 0, so a plain isFinite check would
  // silently merge the deal down to nought participants — and a zero
  // participant count on a WON deal quietly empties a tour roster.
  const customNum = custom === null || custom === undefined || custom === ''
    ? null
    : Number(custom);
  const value =
    choice === 'other' ? b
      : choice === 'combined' ? a + b
        : choice === 'custom' ? (Number.isFinite(customNum) && customNum >= 0 ? customNum : null)
          : a;
  return {
    resolution: 'conflict',
    value,
    choice: choice || null,
    needsChoice: !choice || (choice === 'custom' && value === null),
    options: { survivor: a, other: b, combined: a + b },
  };
}

// ── Lifecycle status ────────────────────────────────────────────────────────

export const MERGE_STATUS_CHOICES = Object.freeze(['won', 'open', 'lost']);

/**
 * The merged deal's lifecycle status.
 *
 * The rule is "preserve the REAL business state", not "whichever deal won the
 * survivor vote" — a WON deal merged into an OPEN one describes a transaction
 * that really closed, and downgrading it to OPEN would un-sell a sale.
 *
 *     won  + anything  → won    (the sale happened)
 *     open + lost      → open   (a live deal outranks a dead one)
 *     same + same      → same
 *
 * `needsChoice` is true whenever the two differ: the default is applied but the
 * operator is always SHOWN the decision, because the reverse ("we really did
 * lose this") is a legitimate business answer the system cannot infer.
 */
export function resolveStatus(survivorStatus, otherStatus, choice = null) {
  const a = survivorStatus || 'open';
  const b = otherStatus || 'open';
  const rank = { won: 3, open: 2, lost: 1 };
  const suggested = (rank[a] || 0) >= (rank[b] || 0) ? a : b;
  const value = MERGE_STATUS_CHOICES.includes(choice) ? choice : suggested;
  return {
    survivorStatus: a,
    otherStatus: b,
    suggested,
    value,
    differs: a !== b,
    // A status decision is shown-and-defaulted, never blocking: the suggestion
    // is right in every ordinary case and the operator can override it.
    needsChoice: a !== b,
    // The merge must not re-run WON effects for a deal that is already WON.
    triggersWonTransition: value === 'won' && a !== 'won',
  };
}

// ── Commercial (Builder) composition ────────────────────────────────────────

export const COMMERCIAL_CHOICES = Object.freeze(['survivor', 'other', 'combine']);

/**
 * A structural identity for "the same commercial line".
 *
 * Deliberately built from the line's STRUCTURE — which pricing card, which
 * ticket type, which product variant, what kind — and never from its label
 * text. Two lines that came from the same card and ticket ARE the same
 * commercial thing whatever an operator renamed them to; two lines that merely
 * share a label are not. Text guessing is what turns "never double-count" into
 * a coin flip.
 */
export function lineIdentity(line) {
  return [
    line.kind || 'manual',
    line.sourceKind || '',
    line.sourceCardGroupId || '',
    line.ticketTypeId || '',
    line.productVariantId || '',
    line.addonId || '',
  ].join('|');
}

/**
 * Does this deal carry MEANINGFUL commercial content?
 *
 * Both halves matter: a deal can hold a value with no Builder (a migrated
 * headline total) or a Builder with no value (priced but never saved). Either
 * is content worth preserving, and only a deal with NEITHER is safe to discard
 * without asking.
 */
export function hasCommercialContent({ valueMinor, lines }) {
  const value = Number(valueMinor || 0);
  const active = (lines || []).filter((l) => l.active !== false);
  return value > 0 || active.length > 0;
}

/**
 * Which commercial resolution applies, and whether the operator must choose.
 *
 *   only one side has content     → take it, no prompt (the spec's own rule)
 *   neither has content           → nothing to decide
 *   BOTH have content             → ask: survivor / other / combine
 */
export function commercialSituation(survivorSide, otherSide, choice = null) {
  const aHas = hasCommercialContent(survivorSide);
  const bHas = hasCommercialContent(otherSide);
  if (!aHas && !bHas) return { situation: 'both_empty', resolution: 'survivor', needsChoice: false };
  if (aHas && !bHas) return { situation: 'survivor_only', resolution: 'survivor', needsChoice: false };
  if (!aHas && bHas) return { situation: 'other_only', resolution: 'other', needsChoice: false };
  return {
    situation: 'both_meaningful',
    resolution: COMMERCIAL_CHOICES.includes(choice) ? choice : null,
    needsChoice: !COMMERCIAL_CHOICES.includes(choice),
  };
}

/**
 * The line set the merged working Builder will own.
 *
 * `keepLineIds` applies ONLY to 'combine' and is the operator's explicit
 * selection. Lines whose structural identity already appears in the selection
 * are flagged `duplicate` by buildCombineCandidates and arrive UNSELECTED, so
 * double-counting requires a deliberate tick rather than an oversight.
 *
 * ── Why copied product lines become 'manual' ──
 * builderCompose prices every non-overridden `kind:'product'` line from the
 * SURVIVOR's engine resolution, so a product line carried over from the other
 * deal would be re-priced against a context it was never quoted in — and two
 * product lines would each take the full engine base, double-counting it. The
 * route enforces at most one primary product line for exactly that reason.
 * A product line from the other deal is, honestly described, a commercial line
 * with a frozen price and a label — which is what `manual` means. Its money is
 * preserved to the agora; only its pricing BEHAVIOUR changes, and it must,
 * because the behaviour it had belonged to a different deal.
 */
export function composeMergedLines({ resolution, survivorLines = [], otherLines = [], keepLineIds = [] }) {
  const keep = new Set(keepLineIds || []);
  let chosen;
  if (resolution === 'survivor') chosen = survivorLines.map((l) => ({ line: l, from: 'survivor' }));
  else if (resolution === 'other') chosen = otherLines.map((l) => ({ line: l, from: 'other' }));
  else {
    chosen = [
      ...survivorLines.filter((l) => keep.has(l.id)).map((l) => ({ line: l, from: 'survivor' })),
      ...otherLines.filter((l) => keep.has(l.id)).map((l) => ({ line: l, from: 'other' })),
    ];
  }

  // Resolved discount rows (deal_discount / line_discount) are OUTPUT of
  // builderCompose, regenerated from their intents on the next save. Carrying
  // them across a merge would double the discount the moment the Builder is
  // reopened. The intents themselves travel with their own lines.
  chosen = chosen.filter(
    ({ line }) => line.sourceKind !== 'deal_discount' && line.sourceKind !== 'line_discount',
  );

  let seenPrimaryProduct = false;
  return chosen.map(({ line, from }, i) => {
    const isProduct = line.kind === 'product' && line.sourceKind !== 'agent_reservation';
    let kind = line.kind;
    let overridden = !!line.overridden;
    let demoted = false;
    if (isProduct) {
      if (seenPrimaryProduct || from === 'other') {
        kind = 'manual';
        overridden = true;
        demoted = true;
      } else {
        seenPrimaryProduct = true;
      }
    }
    return {
      kind,
      label: line.label || '',
      productVariantId: line.productVariantId || null,
      addonId: line.addonId || null,
      quantity: line.quantity ?? 1,
      unitPriceMinor: line.unitPriceMinor ?? 0,
      discountPercent: line.discountPercent ?? null,
      discountFixedMinor: line.discountFixedMinor ?? null,
      vatMode: line.vatMode || 'inherit',
      vatRate: line.vatRate ?? null,
      active: line.active !== false,
      note: line.note || '',
      overridden,
      sourceKind: line.sourceKind || null,
      sourceCardGroupId: line.sourceCardGroupId || null,
      pinnedCardGroupId: line.pinnedCardGroupId || null,
      ticketTypeId: line.ticketTypeId || null,
      sortOrder: i,
      // Audit only — reported in the merge outcome, not stored on the line.
      _from: from,
      _demoted: demoted,
      _sourceLineId: line.id,
    };
  });
}

/**
 * The selection UI's candidate list for 'combine': every line from both sides,
 * each marked with where it came from and whether it structurally duplicates a
 * line already offered by the survivor.
 *
 * Default selection: ALL survivor lines, plus the other deal's NON-duplicate
 * lines. That is the composition an operator almost always wants, and it can
 * never double-count on its own — every deviation is a deliberate tick.
 */
export function buildCombineCandidates(survivorLines = [], otherLines = []) {
  const survivorIdentities = new Set(survivorLines.map(lineIdentity));
  const seen = new Set();
  const toCandidate = (l, from) => {
    const identity = lineIdentity(l);
    const duplicate = from === 'other' && survivorIdentities.has(identity);
    const repeated = seen.has(identity);
    seen.add(identity);
    return {
      id: l.id,
      from,
      kind: l.kind,
      label: l.label || '',
      quantity: l.quantity ?? 1,
      unitPriceMinor: Number(l.unitPriceMinor ?? 0),
      amountMinor: lineSign(l.kind) * Number(l.unitPriceMinor ?? 0) * (Number(l.quantity) || 1),
      active: l.active !== false,
      sourceKind: l.sourceKind || null,
      duplicate: duplicate || repeated,
      // Discount rows are regenerated from intent — never selectable.
      selectable: l.sourceKind !== 'deal_discount' && l.sourceKind !== 'line_discount',
      defaultSelected:
        l.sourceKind !== 'deal_discount'
        && l.sourceKind !== 'line_discount'
        && (from === 'survivor' || !duplicate),
    };
  };
  return [
    ...survivorLines.map((l) => toCandidate(l, 'survivor')),
    ...otherLines.map((l) => toCandidate(l, 'other')),
  ];
}

// ── Open tasks ──────────────────────────────────────────────────────────────

export const TASK_CHOICES = Object.freeze(['move', 'close_duplicate', 'keep']);

/**
 * What should happen, by default, to each OPEN task on the retired deal?
 *
 * Moving is the right default for real work: an open task is something someone
 * still has to do, and dropping it would lose it.
 *
 * But an AUTOMATIC task is not work someone chose — it is the system's own
 * "every new lead gets one first call". tasks/autoTasks.js guarantees at most
 * ONE per deal, and blanket-moving breaks exactly that guarantee: merging two
 * fresh leads left the survivor with two identical "שיחה ראשונית" tasks, every
 * single time. That is not a duplicated RECORD (the row moved, it was not
 * copied) — it is a duplicated OBLIGATION, which is the same problem for the
 * person who has to work the list.
 *
 * So a task whose TYPE is already open on the survivor defaults to
 * close_duplicate. The operator can still override any of it; only the default
 * changed, and only where the system itself says one is enough.
 */
export function suggestTaskActions(survivorTasks = [], otherTasks = []) {
  const openTypes = new Set(survivorTasks.map((t) => t.taskTypeId).filter(Boolean));
  const openTitles = new Set(survivorTasks.map((t) => (t.title || '').trim()).filter(Boolean));
  return otherTasks.map((t) => {
    const sameType = !!t.taskTypeId && openTypes.has(t.taskTypeId);
    // Typeless tasks fall back to an exact title match — deliberately exact,
    // never fuzzy: guessing that two differently-worded tasks are "the same"
    // is how real work gets closed by accident.
    const sameTitle = !t.taskTypeId && openTitles.has((t.title || '').trim());
    const duplicate = sameType || sameTitle;
    return {
      id: t.id,
      title: t.title,
      dueDate: t.dueDate ?? null,
      taskTypeId: t.taskTypeId ?? null,
      duplicate,
      suggested: duplicate ? 'close_duplicate' : 'move',
      reasonHe: duplicate ? 'קיימת כבר משימה פתוחה מאותו סוג בדיל שנשאר' : null,
    };
  });
}

/** The action actually applied to one task: the operator's choice, else the suggestion. */
export function resolveTaskAction(suggestion, choice) {
  return TASK_CHOICES.includes(choice) ? choice : (suggestion?.suggested || 'move');
}

// ── Contacts ────────────────────────────────────────────────────────────────

/**
 * The merged contact set: the UNION by contactId, with exactly ONE primary.
 *
 * The survivor's primary stays primary by default — that is the decision the
 * operator already made when they chose which deal survives — and may be
 * overridden with `primaryContactId`. Contact RECORDS are never touched: this
 * merges deals, not people.
 *
 * Per-deal routing flags (receiveConfirmations / OperationalUpdates /
 * PaymentLinks / Quotes) are ORed across the two links for a contact present on
 * both, and roles are unioned. A flag is an instruction to include someone; if
 * either deal said "send this person the confirmation", the merged deal does.
 * Silently dropping it would quietly stop mail an operator had asked for.
 */
export function resolveContacts(survivorLinks = [], otherLinks = [], primaryContactId = null) {
  const byContact = new Map();
  const add = (link, from) => {
    const existing = byContact.get(link.contactId);
    if (!existing) {
      byContact.set(link.contactId, {
        contactId: link.contactId,
        from,
        existingLinkId: from === 'survivor' ? link.id : null,
        roles: [...(link.roles || [])],
        wasPrimaryOnSurvivor: from === 'survivor' && !!link.isPrimary,
        wasPrimaryOnOther: from === 'other' && !!link.isPrimary,
        receiveConfirmations: !!link.receiveConfirmations,
        receiveOperationalUpdates: !!link.receiveOperationalUpdates,
        receivePaymentLinks: !!link.receivePaymentLinks,
        receiveQuotes: !!link.receiveQuotes,
      });
      return;
    }
    existing.roles = [...new Set([...existing.roles, ...(link.roles || [])])];
    existing.wasPrimaryOnOther = existing.wasPrimaryOnOther || (from === 'other' && !!link.isPrimary);
    existing.wasPrimaryOnSurvivor = existing.wasPrimaryOnSurvivor || (from === 'survivor' && !!link.isPrimary);
    existing.receiveConfirmations ||= !!link.receiveConfirmations;
    existing.receiveOperationalUpdates ||= !!link.receiveOperationalUpdates;
    existing.receivePaymentLinks ||= !!link.receivePaymentLinks;
    existing.receiveQuotes ||= !!link.receiveQuotes;
    existing.alsoOnOther = true;
  };
  for (const l of survivorLinks) add(l, 'survivor');
  for (const l of otherLinks) add(l, 'other');

  const all = [...byContact.values()];
  const survivorPrimary = all.find((c) => c.wasPrimaryOnSurvivor) || null;
  const requested = primaryContactId ? all.find((c) => c.contactId === primaryContactId) : null;
  // Fall back through: explicit choice → survivor's primary → the other deal's
  // primary → the first link. A deal with contacts always ends with exactly one
  // primary; a deal with none ends with none, which is also a valid state.
  const primary =
    requested || survivorPrimary || all.find((c) => c.wasPrimaryOnOther) || all[0] || null;

  return {
    links: all.map((c) => ({ ...c, isPrimary: !!primary && c.contactId === primary.contactId })),
    primaryContactId: primary?.contactId || null,
    added: all.filter((c) => c.from === 'other'),
    // Both deals named a DIFFERENT person as primary — worth showing, never
    // worth blocking: the survivor's choice is a good default.
    primaryConflict: !!survivorPrimary
      && all.some((c) => c.wasPrimaryOnOther && c.contactId !== survivorPrimary.contactId),
  };
}
