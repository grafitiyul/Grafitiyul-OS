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

  const coordRows = coordRaw.map((r) => {
    const f = r.fields || {};
    return {
      recId: r.id,
      masterRecId: Array.isArray(f['שם סיור']) ? f['שם סיור'][0] : null,
      legacyDealId: num(f['פייפ דיל ID']),
      guideEmail: t(first(f['אימייל של המדריך']) || ''),
      guideName: t(first(f['מדריך ששובץ (from שם סיור)']) || ''),
      seats: f['כמות משתתפים בסיור'] != null ? Math.round(Number(first(f['כמות משתתפים בסיור']))) : null,
      legacyCalendarId: t(first(f['מזהה ארוע ביומן (from שם סיור)']) || '') || null,
    };
  });
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
  const payrollRows = payrollRaw.map((r) => {
    const f = r.fields || {};
    const tourLink = Object.entries(f).find(([k, v]) => Array.isArray(v) && String(v[0] || '').startsWith('rec') && /סיור|tour/i.test(k));
    return {
      recId: r.id,
      masterRecId: (tourLink ? tourLink[1][0] : null) || masterByPayrollRec.get(r.id) || null,
      guideName: t(first(f['Guide name']) || first(f['מדריך']) || ''),
      role: t(first(f['תפקיד']) || '') || null,
      totalPreVatMinor: toMinor(f['סה"כ לתשלום לפני מע"מ']),
      vatMinor: toMinor(f['תוספת מע"מ בש"ח']),
      approved: String(first(f['מאושר']) || '') !== '',
      guideApproved: String(first(f['מאושר על ידי העובד']) || '') !== '',
      note: t(first(f['הערות משרד']) || ''),
    };
  });

  return { masterTours, coordRows, payrollRows, rejectedDates };
}
