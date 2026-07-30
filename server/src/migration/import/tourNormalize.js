// ONE normalization of the Airtable tour layer, shared by the rehearsal and the
// production runner — Hash A is only meaningful if both read identically.
import * as r2 from '../r2.js';
import { createSnapshotReader } from '../review/snapshotReader.js';

const first = (v) => (Array.isArray(v) ? v[0] : v);
// Postgres/Prisma reject NUL and unpaired UTF-16 surrogates (e.g. an emoji
// cut in half by slicing) — strip both from every string we normalize.
const sanitize = (s) => String(s)
  .replace(new RegExp('\\u0000', 'g'), '')
  .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
  .replace(/(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, '$1');
const cut = (s, n) => sanitize(String(s).slice(0, n));
const t = (s) => sanitize(String(s ?? '')).trim();
const num = (v) => { const m = /(\d{2,})/.exec(String(first(v) ?? '')); return m ? Number(m[1]) : null; };
const hhmm = (s) => { const m = /(\d{1,2}):(\d{2})/.exec(String(first(s) || '')); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
const toMinor = (v) => (v == null || v === '' ? null : Math.round(Number(first(v)) * 100));

// ── date validation (added 2026-07-29 after a live planning gate) ────────────
// Airtable returns {"error":"#ERROR!"} for a formula field that failed. The old
// code did String(value).slice(0,10), turning that object into the literal
// "[object Ob" — a truthy string that PASSED the `.filter(m => m.date)` guard
// and, because "[" sorts above any digit, compared as LATER than every real
// date. 45 rows silently entered the operational future-tour population that
// way. Never coerce a structured value to a date: validate it.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The raw value, when it is a usable ISO date; otherwise null + a reason. */
export function readIsoDate(raw) {
  const v = first(raw);
  if (v == null || v === '') return { date: null, reason: 'empty' };
  if (typeof v === 'object') {
    // Airtable formula/lookup error objects, and anything else structured.
    const detail = v.error ? String(v.error) : 'object';
    return { date: null, reason: `source_error:${detail}` };
  }
  const s = String(v).slice(0, 10);
  if (!ISO_DATE.test(s)) return { date: null, reason: `not_iso:${String(v).slice(0, 24)}` };
  // Reject impossible calendar dates (2026-02-30) as well as malformed ones.
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    return { date: null, reason: `not_a_calendar_date:${s}` };
  }
  return { date: s, reason: null };
}

// ── the child-row field contract ─────────────────────────────────────────────
// THE canonical Airtable field names for the tour child tables, verified against
// the live base and proven by the Wave-1 import of 2,473 tours.
//
// The mirror's pollers read the SAME names through the SAME two mappers below.
// They previously carried their own hand-written guesses, and three of the four
// pollers died on Airtable UNKNOWN_FIELD_NAME the first time they ran (2026-07-30).
// The failure that mattered was quieter: the child fetcher read fields that do not
// exist, so a recompute would have derived an EMPTY child set and — with apply on —
// read as "every booking, assignment and payroll row vanished from the source".
// One mapping, one place, or the two drift and the drift is destructive.
export const COORD_FIELDS = Object.freeze({
  parentLink: 'שם סיור',
  legacyDealId: 'פייפ דיל ID',
  guideEmail: 'אימייל של המדריך',
  guideName: 'מדריך ששובץ (from שם סיור)',
  seats: 'כמות משתתפים בסיור',
  calendarId: 'מזהה ארוע ביומן (from שם סיור)',
});

export const PAYROLL_FIELDS = Object.freeze({
  // Payroll links to its tour through `סיורים`, NOT `שם סיור` — that name belongs
  // to the coordination table only.
  parentLink: 'סיורים',
  guideNameEn: 'Guide name',
  guideLink: 'מדריך',
  role: 'תפקיד',
  totalPreVat: 'סה"כ לתשלום לפני מע"מ',
  vat: 'תוספת מע"מ בש"ח',
  approved: 'מאושר',
  guideApproved: 'מאושר על ידי העובד',
  note: 'הערות משרד',
});

/** One coordination record → the shape planTourImport consumes. */
export function normalizeCoordRow(r) {
  const f = r.fields || {};
  const link = f[COORD_FIELDS.parentLink];
  return {
    recId: r.id,
    masterRecId: Array.isArray(link) ? link[0] : null,
    legacyDealId: num(f[COORD_FIELDS.legacyDealId]),
    guideEmail: t(first(f[COORD_FIELDS.guideEmail]) || ''),
    guideName: t(first(f[COORD_FIELDS.guideName]) || ''),
    seats: f[COORD_FIELDS.seats] != null ? Math.round(Number(first(f[COORD_FIELDS.seats]))) : null,
    legacyCalendarId: t(first(f[COORD_FIELDS.calendarId]) || '') || null,
  };
}

/**
 * One payroll record → the shape planTourImport consumes.
 *
 * `fallbackMasterRecId` is the master side's own `שכר` link, which the importer
 * treats as authoritative; the payroll-side link is the fallback. Kept as a
 * parameter because only the full-layer load can build that reverse index.
 */
export function normalizePayrollRow(r, fallbackMasterRecId = null) {
  const f = r.fields || {};
  const link = f[PAYROLL_FIELDS.parentLink];
  const own = Array.isArray(link) && String(link[0] || '').startsWith('rec') ? link[0] : null;
  return {
    recId: r.id,
    masterRecId: own || fallbackMasterRecId || null,
    // `מדריך` is a LINK field, so its first element is a record id, not a name —
    // the English lookup is tried first for exactly that reason.
    guideName: t(first(f[PAYROLL_FIELDS.guideNameEn]) || first(f[PAYROLL_FIELDS.guideLink]) || ''),
    role: t(first(f[PAYROLL_FIELDS.role]) || '') || null,
    totalPreVatMinor: toMinor(f[PAYROLL_FIELDS.totalPreVat]),
    vatMinor: toMinor(f[PAYROLL_FIELDS.vat]),
    approved: String(first(f[PAYROLL_FIELDS.approved]) || '') !== '',
    guideApproved: String(first(f[PAYROLL_FIELDS.guideApproved]) || '') !== '',
    note: t(first(f[PAYROLL_FIELDS.note]) || ''),
  };
}

export async function loadNormalizedTourLayer(snapshotId) {
  const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId });
  const all = async (key) => {
    const man = await reader.entityManifest(key);
    const out = [];
    for (const s of man.shards || []) { out.push(...await reader.readShard(s.key)); reader._shardCache.clear(); }
    return out;
  };
  const masterRaw = await all('airtable/main/tblTI7iaGm6qsQA4a');
  const coordRaw = await all('airtable/main/tbl1JaGS5oKRIkJ9z');
  const payrollRaw = await all('airtable/main/tbli0eBDJ6CgCj4iJ');

  const masterToursRaw = masterRaw.map((r) => {
    const f = r.fields || {};
    return {
      recId: r.id,
      tourId: num(f.Tour_ID),
      name: t(first(f['שם']) || first(f.Name) || ''),
      date: readIsoDate(f.DATE).date,
      dateReject: readIsoDate(f.DATE).reason,
      startTime: hhmm(f['שעת התחלה']) || hhmm(f['תאריך עם שעת התחלה']),
      endTime: hhmm(f['שעת סיום']),
      status: t(first(f['סטטוס']) || ''),
      legacyCalendarId: null,
      cardExtras: [
        ...(f['סיכום סיור'] ? [{ label: 'סיכום סיור (מקור)', value: cut(t(first(f['סיכום סיור'])), 500) }] : []),
        ...(f['משתתפים בסיור'] != null ? [{ label: 'משתתפים בסיור (מקור)', value: String(f['משתתפים בסיור']) }] : []),
      ],
    };
  });
  // NAMED PLANNING GATE. An operational record with an unusable date is never
  // silently dropped and never guessed at — it is surfaced as rejectedDates so
  // the runner can refuse to plan until each one is resolved.
  const rejectedDates = masterToursRaw
    .filter((m) => !m.date)
    .map((m) => ({ recId: m.recId, tourId: m.tourId, status: m.status, reason: m.dateReject, startTime: m.startTime }));
  const masterTours = masterToursRaw.filter((m) => m.date).map((m) => { const { dateReject, ...rest } = m; return rest; });

  const coordRows = coordRaw.map((r) => normalizeCoordRow(r));
  const calByMaster = new Map();
  for (const c of coordRows) if (c.masterRecId && c.legacyCalendarId && !calByMaster.has(c.masterRecId)) calByMaster.set(c.masterRecId, c.legacyCalendarId);
  for (const m of masterTours) m.legacyCalendarId = calByMaster.get(m.recId) || null;

  // Payroll link: the MASTER side ('שכר') is authoritative; a payroll-side tour
  // link is used only as fallback.
  const masterByPayrollRec = new Map();
  for (const r of masterRaw) {
    const link = r.fields?.['שכר'];
    if (Array.isArray(link)) for (const pr of link) masterByPayrollRec.set(pr, r.id);
  }
  const payrollRows = payrollRaw.map((r) => normalizePayrollRow(r, masterByPayrollRec.get(r.id) || null));

  return { masterTours, coordRows, payrollRows, rejectedDates };
}
