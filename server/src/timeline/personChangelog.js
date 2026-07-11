import { emitTimelineEvent } from './events.js';

// Person/guide profile changelog — same architecture as dealChangelog.js:
// ONE TimelineEntry (subjectType='person', kind='change') per save, carrying
// a `data.changes` array of { fieldKey, labelHe, oldValue, newValue,
// oldDisplay, newDisplay }. History is immutable; "restore" applies an old
// value as a NEW audited change (data.restoredFromEntryId) — the original
// record is never rewritten.
//
// Tracked logical fields (identity + profile + bank). Bank/branch are ONE
// logical field each (code + name snapshot move together) so a restore can
// never split a code from its display name.

export const PERSON_FIELD_LABELS = {
  displayName: 'שם מלא',
  email: 'אימייל',
  phone: 'טלפון',
  imageUrl: 'תמונת פרופיל',
  trainingStartDate: 'תחילת הדרכה',
  trainingCohort: 'מחזור הכשרה',
  vatStatus: 'מע״מ',
  senioritySupplement: 'תוספת ותק',
  beneficiary: 'שם המוטב',
  bank: 'בנק',
  branch: 'סניף',
  accountNumber: 'מספר חשבון',
};

function codeNameDisplay(v) {
  if (!v) return null;
  const parts = [v.code, v.name].filter(Boolean);
  return parts.length ? parts.join(' — ') : null;
}

function codeNameEq(a, b) {
  return (a?.code || null) === (b?.code || null) && (a?.name || null) === (b?.name || null);
}

// Human labels for the VAT scalar — history shows Hebrew, never raw enums.
export const VAT_STATUS_LABELS = {
  exempt: 'פטור ממע״מ',
  vat_18: '18% מע״מ',
};

const FIELDS = [
  { key: 'displayName' },
  { key: 'email' },
  { key: 'phone' },
  { key: 'imageUrl', display: (v) => (v ? 'תמונה' : 'ללא תמונה') },
  { key: 'trainingStartDate' },
  { key: 'trainingCohort' },
  { key: 'vatStatus', display: (v) => (v ? VAT_STATUS_LABELS[v] || v : null) },
  { key: 'senioritySupplement' },
  { key: 'beneficiary' },
  { key: 'bank', display: codeNameDisplay, eq: codeNameEq },
  { key: 'branch', display: codeNameDisplay, eq: codeNameEq },
  { key: 'accountNumber' },
];

// ---------- bank details normalization (the ONE structured shape) ----------
//
// PersonProfile.bankDetails stays a Json column (additive — no migration),
// but every write path funnels through this normalizer so the stored shape
// is always: { beneficiary, bankCode, bankName, branchCode, branchName,
// accountNumber } — normalized code + display-name snapshot, per spec.

function cleanStr(v, max = 120) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().slice(0, max);
  return s || null;
}

export function normalizeBankDetails(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    beneficiary: cleanStr(src.beneficiary),
    bankCode: cleanStr(src.bankCode, 4),
    bankName: cleanStr(src.bankName),
    branchCode: cleanStr(src.branchCode, 6),
    branchName: cleanStr(src.branchName),
    accountNumber: cleanStr(src.accountNumber, 20),
  };
}

// Flat logical snapshot used for diffing — from PersonRef + PersonProfile
// rows. Missing profile / legacy free-form bankDetails degrade to nulls.
export function personChangeSnapshot(person, profile) {
  const bank = normalizeBankDetails(profile?.bankDetails);
  return {
    displayName: person?.displayName ?? null,
    email: person?.email ?? null,
    phone: person?.phone ?? null,
    imageUrl: profile?.imageUrl ?? null,
    trainingStartDate: profile?.trainingStartDate ?? null,
    trainingCohort: profile?.trainingCohort ?? null,
    vatStatus: profile?.vatStatus ?? null,
    // Prisma Decimal → plain string so diff/restore round-trip cleanly.
    senioritySupplement:
      profile?.senioritySupplement == null ? null : String(profile.senioritySupplement),
    beneficiary: bank.beneficiary,
    bank: bank.bankCode || bank.bankName ? { code: bank.bankCode, name: bank.bankName } : null,
    branch:
      bank.branchCode || bank.branchName ? { code: bank.branchCode, name: bank.branchName } : null,
    accountNumber: bank.accountNumber,
  };
}

// Diff two snapshots. Only keys PRESENT in `after` are compared (undefined =
// untouched by this save), so partial updates never fabricate null-changes.
export function diffPersonFields(before, after) {
  const changes = [];
  for (const f of FIELDS) {
    if (after[f.key] === undefined) continue;
    const oldValue = before?.[f.key] ?? null;
    const newValue = after[f.key] ?? null;
    const same = f.eq ? f.eq(oldValue, newValue) : oldValue === newValue;
    if (same) continue;
    const display = f.display || ((v) => (v == null ? null : String(v)));
    changes.push({
      fieldKey: f.key,
      labelHe: PERSON_FIELD_LABELS[f.key] || f.key,
      oldValue,
      newValue,
      oldDisplay: display(oldValue),
      newDisplay: display(newValue),
    });
  }
  return changes;
}

// Write the grouped change entry. `source` distinguishes the surfaces the
// product cares about: 'admin' | 'guide_portal'. Never throws into the save
// path — history failure is logged, the profile write stands.
export async function recordPersonChanges(
  client,
  { personRefId, changes, origin, source, restoredFromEntryId = null },
) {
  if (!changes || changes.length === 0) return null;
  try {
    return await emitTimelineEvent(client, {
      subjectType: 'person',
      subjectId: personRefId,
      kind: 'change',
      data: {
        changes,
        source,
        ...(restoredFromEntryId ? { restoredFromEntryId } : {}),
      },
      origin,
    });
  } catch (err) {
    console.warn(`[personChangelog] failed to record changes for ${personRefId}`, err);
    return null;
  }
}
