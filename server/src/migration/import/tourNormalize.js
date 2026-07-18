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

  const masterTours = masterRaw.map((r) => {
    const f = r.fields || {};
    return {
      recId: r.id,
      tourId: num(f.Tour_ID),
      name: t(first(f['שם']) || first(f.Name) || ''),
      date: String(first(f.DATE) || '').slice(0, 10),
      startTime: hhmm(f['שעת התחלה']) || hhmm(f['תאריך עם שעת התחלה']),
      endTime: hhmm(f['שעת סיום']),
      status: t(first(f['סטטוס']) || ''),
      legacyCalendarId: null,
      cardExtras: [
        ...(f['סיכום סיור'] ? [{ label: 'סיכום סיור (מקור)', value: cut(t(first(f['סיכום סיור'])), 500) }] : []),
        ...(f['משתתפים בסיור'] != null ? [{ label: 'משתתפים בסיור (מקור)', value: String(f['משתתפים בסיור']) }] : []),
      ],
    };
  }).filter((m) => m.date);

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

  return { masterTours, coordRows, payrollRows };
}
