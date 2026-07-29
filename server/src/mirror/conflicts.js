// Mirror conflict surfacing.
//
// A conflict is raised through the EXISTING בקרה (Operations Control) module as
// an OperationalIssue — one canonical detector family, `legacy_sync_conflict`.
// Deliberately not a new screen and not a new notification channel: operators
// already have one place where operational problems appear, and a second one
// would simply be ignored.
//
// The lifecycle is what makes conflicts trustworthy:
//   * raised when the 3-way merge refuses to write (both sides changed)
//   * the baseline does NOT advance, so the SAME conflict re-raises on every
//     sync until a human resolves it — a conflict that quietly disappears is
//     worse than one that nags
//   * resolving it (accept legacy / keep GOS / edit manually) advances the
//     baseline, which is what actually stops it recurring

import { raiseIssue, resolveIssue } from '../control/issueService.js';

export const CONFLICT_TYPE = 'legacy_sync_conflict';

/** One active issue per (entity, record) — not per field. */
export function conflictDedupeKey({ entity, entityId }) {
  return `${CONFLICT_TYPE}:${entity}:${entityId}`;
}

const SYSTEM_LABEL = { pipedrive: 'Pipedrive', airtable: 'Airtable' };

const ENTITY_LABEL = {
  deal: 'דיל',
  contact: 'איש קשר',
  organization: 'ארגון',
  task: 'משימה',
  tourEvent: 'סיור',
  dealMarketing: 'שיווק',
};

// Business language, never field names. An operator reading this must not have
// to know that `valueMinor` is money or that `dealStageId` is the pipeline.
const FIELD_LABEL = {
  title: 'כותרת',
  status: 'סטטוס',
  dealStageId: 'שלב',
  valueMinor: 'סכום',
  currency: 'מטבע',
  wonAt: 'תאריך סגירה',
  lostAt: 'תאריך אובדן',
  lostReason: 'סיבת אובדן',
  expectedCloseDate: 'תאריך סגירה צפוי',
  tourDate: 'תאריך הסיור',
  tourTime: 'שעת הסיור',
  participants: 'משתתפים',
  source: 'מקור',
  dealSourceId: 'מקור הליד',
  ownerUserId: 'אחראי',
  firstNameHe: 'שם פרטי',
  lastNameHe: 'שם משפחה',
  taxId: 'ח.פ / ת.ז',
  name: 'שם',
  address: 'כתובת',
  date: 'תאריך',
  startTime: 'שעת התחלה',
  capacity: 'מקומות',
  tourLanguage: 'שפה',
  notes: 'הערות',
  dueAt: 'תאריך יעד',
};

export const fieldLabel = (f) => FIELD_LABEL[f] || f;

// Values are rendered for humans. Money is shown in shekels, not minor units;
// dates as dates. An operator comparing "53100000" with "531000" cannot make a
// decision, which would make the whole conflict surface useless.
export function displayValue(field, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'valueMinor') return `${(Number(value) / 100).toLocaleString('he-IL')} ₪`;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}T/.test(String(value))) return String(value).slice(0, 10);
  return String(value);
}

/**
 * Raise (or refresh) the conflict issue for one record.
 * `conflicts` is the array produced by mergeRecord.
 */
export async function raiseSyncConflict(db, { system, entity, entityId, entityLabel, orderNo, conflicts }) {
  if (!conflicts?.length) return null;
  const sys = SYSTEM_LABEL[system] || system;
  const what = ENTITY_LABEL[entity] || entity;

  const rows = conflicts.map((c) => ({
    field: c.field,
    label: fieldLabel(c.field),
    legacy: displayValue(c.field, c.source),
    gos: displayValue(c.field, c.gos),
    since: displayValue(c.field, c.base),
  }));

  return raiseIssue(db, {
    type: CONFLICT_TYPE,
    severity: 'warning',
    sourceModule: 'mirror',
    dedupeKey: conflictDedupeKey({ entity, entityId }),
    title: `${what} ${entityLabel || orderNo || ''} — שינוי סותר בין GOS ל${sys}`.trim(),
    explanation:
      `השדות הבאים שונו גם ב-${sys} וגם ב-GOS מאז הסנכרון האחרון. ` +
      `לא בוצע שום עדכון אוטומטי — הערכים בשתי המערכות נשארו כפי שהיו. ` +
      `יש לבחור איזה ערך נכון.`,
    entityRefs: [{ type: entity === 'tourEvent' ? 'tour_event' : entity, id: entityId, orderNo: orderNo ?? null, label: entityLabel ?? null }],
    data: { system, entity, entityId, fields: rows },
  });
}

/**
 * Resolve a conflict. The CALLER must advance the baseline for the resolved
 * fields — resolving the issue without advancing would simply re-raise it on
 * the next sync, and advancing without resolving would hide a decision nobody
 * made. Both halves belong to the same operator action.
 */
export async function resolveSyncConflict(db, { id, dedupeKey, choice, resolvedBy = null, resolvedByName = null }) {
  return resolveIssue(db, {
    id,
    dedupeKey,
    resolution: `mirror_${choice}`, // mirror_accept_legacy | mirror_keep_gos | mirror_manual
    resolvedBy,
    resolvedByName,
  });
}

/**
 * The registry definition for the בקרה dashboard. Registered by the module
 * index so a new issue type is one registry entry, exactly like every other
 * detector family in the control module.
 */
export const conflictIssueDef = {
  buildActions(issue) {
    const d = issue.data || {};
    const target = d.entity === 'deal'
      ? { type: 'deal', id: d.entityId, orderNo: issue.entityRefs?.[0]?.orderNo ?? null }
      : d.entity === 'tourEvent'
        ? { type: 'tour_event', id: d.entityId }
        : null;
    return [
      ...(target ? [{ key: 'open', label: 'פתח את הרשומה', kind: 'link', target }] : []),
      {
        key: 'accept_legacy',
        label: 'קבל את הערך מהמערכת הקודמת',
        kind: 'server',
        style: 'primary',
        confirm: 'הערך ב-GOS יוחלף בערך מהמערכת הקודמת. להמשיך?',
      },
      {
        key: 'keep_gos',
        label: 'השאר את הערך של GOS',
        kind: 'server',
        confirm: 'הערך ב-GOS יישאר, והסנכרון יפסיק להתריע על השדות האלה. להמשיך?',
      },
    ];
  },
};
