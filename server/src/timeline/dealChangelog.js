import { emitTimelineEvent } from './events.js';

// Structured Deal changelog — one place that knows WHICH Deal fields are
// meaningful history and HOW each renders in Hebrew. Route handlers snapshot
// the deal before the update (select DEAL_DIFF_SELECT), then call
// recordDealChanges(before, after) — a single grouped TimelineEntry
// (kind='change') is emitted per save with data.changes = [{ fieldKey,
// labelHe, oldValue, newValue, oldDisplay, newDisplay }]. Values are stored
// STRUCTURALLY (raw + pre-formatted display) so the feed renders instantly and
// future analytics can still read the raw values.
//
// Intentionally NOT tracked (noisy free-content, not operational facts):
// notes, customerInfo, quoteEmailIntro, basePriceOverridden, productVariantId
// (a variant is just product+city — both tracked separately), deprecated
// legacy columns, and wonAt/lostAt (implied by the status change itself).

const STATUS_LABELS = { open: 'פתוח', won: 'WON', lost: 'LOST' };
const ACTIVITY_LABELS = { group: 'קבוצתי', private: 'פרטי', business: 'עסקי' };
const COMM_LANG_LABELS = { he: 'עברית', en: 'אנגלית' };
const TOUR_LANG_LABELS = { he: 'עברית', en: 'אנגלית', es: 'ספרדית', fr: 'צרפתית', ru: 'רוסית' };
const CURRENCY_SYMBOLS = { ILS: '₪', USD: '$', EUR: '€' };

function fmtMoney(minor, currency) {
  if (minor === null || minor === undefined) return null;
  const n = Number(minor) / 100;
  const sym = CURRENCY_SYMBOLS[currency] || `${currency || ''} `;
  return `${sym}${n.toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

// "YYYY-MM-DD" (Deal.tourDate storage format) → "DD.MM.YYYY"
function fmtDateStr(v) {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(v);
}

function fmtDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// key → how to diff/display. type: text | number | money | dateStr | date |
// enum (labels map) | fk (model+labelField, resolved in ONE batched query per model).
const TRACKED_FIELDS = [
  { key: 'title', labelHe: 'כותרת', type: 'text' },
  { key: 'dealStageId', labelHe: 'שלב', type: 'fk', model: 'dealStage', labelField: 'label' },
  { key: 'status', labelHe: 'סטטוס', type: 'enum', labels: STATUS_LABELS },
  { key: 'valueMinor', labelHe: 'מחיר', type: 'money' },
  { key: 'discountMinor', labelHe: 'הנחה', type: 'money' },
  { key: 'currency', labelHe: 'מטבע', type: 'text' },
  { key: 'participants', labelHe: 'כמות משתתפים', type: 'number' },
  { key: 'tourDate', labelHe: 'תאריך הסיור', type: 'dateStr' },
  { key: 'tourTime', labelHe: 'שעת הסיור', type: 'text' },
  { key: 'productId', labelHe: 'מוצר', type: 'fk', model: 'product', labelField: 'nameHe' },
  { key: 'locationId', labelHe: 'עיר', type: 'fk', model: 'location', labelField: 'nameHe' },
  { key: 'organizationId', labelHe: 'ארגון', type: 'fk', model: 'organization', labelField: 'name' },
  { key: 'organizationUnitId', labelHe: 'יחידה ארגונית', type: 'fk', model: 'organizationUnit', labelField: 'name' },
  { key: 'organizationTypeId', labelHe: 'סוג ארגון', type: 'fk', model: 'organizationType', labelField: 'label' },
  { key: 'organizationSubtypeId', labelHe: 'תת־סוג ארגון', type: 'fk', model: 'organizationSubtype', labelField: 'label' },
  { key: 'dealSourceId', labelHe: 'מקור', type: 'fk', model: 'dealSource', labelField: 'label' },
  { key: 'source', labelHe: 'פירוט מקור', type: 'text' },
  { key: 'activityType', labelHe: 'סוג פעילות', type: 'enum', labels: ACTIVITY_LABELS },
  { key: 'paymentTermId', labelHe: 'תנאי תשלום', type: 'fk', model: 'paymentTerm', labelField: 'nameHe' },
  { key: 'paymentMethodId', labelHe: 'אמצעי תשלום', type: 'fk', model: 'paymentMethod', labelField: 'nameHe' },
  { key: 'expectedCloseDate', labelHe: 'תאריך סגירה צפוי', type: 'date' },
  { key: 'communicationLanguage', labelHe: 'שפת תקשורת', type: 'enum', labels: COMM_LANG_LABELS },
  { key: 'tourLanguage', labelHe: 'שפת הסיור', type: 'enum', labels: TOUR_LANG_LABELS },
  { key: 'lostReasonId', labelHe: 'סיבת הפסד', type: 'fk', model: 'lostReason', labelField: 'nameHe' },
  { key: 'lostNotes', labelHe: 'הערות הפסד', type: 'text' },
];

// Snapshot select for the "before" read — every tracked scalar (id/currency are
// always needed: currency formats money even when itself unchanged).
export const DEAL_DIFF_SELECT = Object.fromEntries(
  ['id', ...TRACKED_FIELDS.map((f) => f.key)].map((k) => [k, true]),
);

// Normalize for equality: BigInt/Date have no ===-stable representation.
function norm(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  return v;
}

// Raw value as stored in the Json payload (BigInt → number, Date → ISO).
function raw(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) return v.toISOString();
  return v;
}

// Diff before/after over the tracked fields (only keys present in BOTH — so a
// partial snapshot, e.g. the price-builder's, diffs just its own fields) and
// emit ONE grouped kind='change' entry. Never throws into the caller's save:
// the update must not fail because history writing hiccuped.
export async function recordDealChanges(client, { dealId, before, after, origin }) {
  try {
    const changed = TRACKED_FIELDS.filter(
      (f) => f.key in before && f.key in after && norm(before[f.key]) !== norm(after[f.key]),
    );
    if (!changed.length) return null;

    // Batch-resolve FK labels: one findMany per referenced model.
    const idsByModel = new Map();
    for (const f of changed) {
      if (f.type !== 'fk') continue;
      const set = idsByModel.get(f.model) || new Set();
      if (before[f.key]) set.add(before[f.key]);
      if (after[f.key]) set.add(after[f.key]);
      idsByModel.set(f.model, set);
    }
    const labelByModelId = new Map(); // `${model}:${id}` → label
    for (const [model, set] of idsByModel) {
      const spec = TRACKED_FIELDS.find((f) => f.type === 'fk' && f.model === model);
      const rows = await client[model].findMany({
        where: { id: { in: [...set] } },
        select: { id: true, [spec.labelField]: true },
      });
      for (const r of rows) labelByModelId.set(`${model}:${r.id}`, r[spec.labelField]);
    }

    const currency = after.currency ?? before.currency ?? 'ILS';
    const display = (f, v) => {
      if (v === null || v === undefined || v === '') return null;
      switch (f.type) {
        case 'money': return fmtMoney(v, currency);
        case 'dateStr': return fmtDateStr(v);
        case 'date': return fmtDate(v);
        case 'enum': return f.labels[v] || String(v);
        case 'fk': return labelByModelId.get(`${f.model}:${v}`) || String(v);
        default: return String(v);
      }
    };

    const changes = changed.map((f) => ({
      fieldKey: f.key,
      labelHe: f.labelHe,
      oldValue: raw(before[f.key]),
      newValue: raw(after[f.key]),
      oldDisplay: display(f, before[f.key]),
      newDisplay: display(f, after[f.key]),
    }));

    return await emitTimelineEvent(client, {
      subjectId: dealId,
      kind: 'change',
      data: { changes },
      origin,
    });
  } catch (e) {
    console.error('[dealChangelog] failed to record changes for deal', dealId, e);
    return null;
  }
}

// Contact-link history ("איש קשר" is a Deal relation, not a column — same feed,
// dedicated fieldKeys the renderer verbalizes: נוסף / הוסר / ראשי השתנה).
export async function recordDealContactChange(client, { dealId, event, contactName, oldName = null, origin }) {
  const change =
    event === 'linked'
      ? { fieldKey: 'contactLinked', labelHe: 'איש קשר', oldValue: null, newValue: contactName, oldDisplay: null, newDisplay: contactName }
      : event === 'unlinked'
        ? { fieldKey: 'contactUnlinked', labelHe: 'איש קשר', oldValue: contactName, newValue: null, oldDisplay: contactName, newDisplay: null }
        : { fieldKey: 'primaryContact', labelHe: 'איש קשר ראשי', oldValue: oldName, newValue: contactName, oldDisplay: oldName, newDisplay: contactName };
  try {
    return await emitTimelineEvent(client, {
      subjectId: dealId,
      kind: 'change',
      data: { changes: [change] },
      origin,
    });
  } catch (e) {
    console.error('[dealChangelog] failed to record contact change for deal', dealId, e);
    return null;
  }
}
