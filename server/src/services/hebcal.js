// Hebcal holiday import (https://www.hebcal.com). Free, no API key. Fetches the
// Jewish/Israeli holiday calendar for a date range and parses it into normalized
// rows the sabbath-hours route upserts. This module does NO DB work and hard-codes
// NO holiday dates — it only talks to the source. Fails safe: a network/parse
// error throws a clear code; the caller changes nothing.
//
// Times are read as the wall-clock string Hebcal returns (Israel local), so we
// never go through Date()/timezone math. geonameid = Tel Aviv (293397); this is a
// location config constant, adjustable later.

const GEONAMEID = 293397; // Tel Aviv-Yafo
const CANDLE_MIN_BEFORE_SUNSET = 18;

// Parse "YYYY-MM-DDThh:mm:ss+03:00" → minutes from midnight (wall-clock). Returns
// null when the date carries no time component.
function timeToMinute(iso) {
  if (typeof iso !== 'string' || iso.length < 16 || iso[10] !== 'T') return null;
  const hh = Number(iso.slice(11, 13));
  const mm = Number(iso.slice(14, 16));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}
const dateOnly = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : null);

// type from a holiday item: Erev → erev_chag; full yom tov → chag; else other.
function holidayType(item) {
  if (/^Erev\b/i.test(item.title || '')) return 'erev_chag';
  if (item.yomtov === true) return 'chag';
  return 'other';
}

// Should this item become a reviewable holiday row? Keep major + modern (Israeli
// national) + their Erev; skip minor/fasts/rosh-chodesh to reduce review noise.
function isWantedHoliday(item) {
  if (item.category !== 'holiday') return false;
  if (/^Erev\b/i.test(item.title || '')) return true;
  if (item.yomtov === true) return true;
  return item.subcat === 'major' || item.subcat === 'modern';
}

// Fetch + parse. Returns { rows, range }. Throws Error with .code on failure.
export async function fetchHolidayRows({ startISO, endISO, timeoutMs = 10000 }) {
  const url =
    `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&mod=on&i=on` +
    `&c=on&geonameid=${GEONAMEID}&b=${CANDLE_MIN_BEFORE_SUNSET}&M=on` +
    `&start=${startISO}&end=${endISO}`;

  let json;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) {
      const err = new Error(`hebcal_http_${res.status}`);
      err.code = 'hebcal_http_error';
      throw err;
    }
    json = await res.json();
  } catch (e) {
    if (e.code === 'hebcal_http_error') throw e;
    const err = new Error('hebcal_unreachable');
    err.code = 'hebcal_unreachable';
    err.cause = e;
    throw err;
  }

  const items = Array.isArray(json?.items) ? json.items : [];

  // Candle-lighting time per eve date; havdalah time per chag date.
  const candleByDate = {};
  const havdalahByDate = {};
  for (const it of items) {
    if (it.category === 'candles') candleByDate[dateOnly(it.date)] = timeToMinute(it.date);
    if (it.category === 'havdalah') havdalahByDate[dateOnly(it.date)] = timeToMinute(it.date);
  }

  const rows = [];
  for (const it of items) {
    if (!isWantedHoliday(it)) continue;
    const date = dateOnly(it.date);
    if (!date) continue;
    const title = String(it.title || '').trim();
    const type = holidayType(it);

    // Erev → starts at candle-lighting that evening (else all-day).
    // Chag → all-day; havdalah recorded as end if present (informational).
    let allDay = true;
    let startMinute = null;
    let endMinute = null;
    if (type === 'erev_chag' && candleByDate[date] != null) {
      allDay = false;
      startMinute = candleByDate[date];
    } else if (type === 'chag' && havdalahByDate[date] != null) {
      endMinute = havdalahByDate[date];
    }

    rows.push({
      externalId: `${date}|${title}`,
      nameHe: (it.hebrew && String(it.hebrew).trim()) || title,
      nameEn: title,
      date,
      type,
      allDay,
      startMinute,
      endMinute,
      sourceName: title,
    });
  }
  return { rows, range: { startISO, endISO } };
}
