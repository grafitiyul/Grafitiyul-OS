import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api.js';
import {
  TOUR_STATUS_LABELS,
  normalizeStatusFilter,
  fmtTourDate,
} from '../config.js';
import {
  addDays,
  addMonths,
  endTimeOf,
  fmtDayShort,
  monthGrid,
  monthTitle,
  startOfMonth,
  startOfWeek,
  timeToMinutes,
  todayIL,
} from './dates.js';
import { calendarEventVisual, isUnassignedScheduled, eventCity } from './eventVisuals.js';
import { useTourChanged } from '../tourEvents.js';

// לוח שנה — the Admin Tours calendar. STRICTLY a second VIEW of the same
// TourEvent data as the table: same status filter vocabulary, same Tour modal
// on click, and READ-ONLY by product rule — no drag, no resize, no
// click-to-create, no date editing anywhere (dates change only through the
// Deal's Pending Tour Update flow). Data comes from the lean
// /api/tours/calendar range DTO — only the visible range is ever fetched.
//
// Event coloring lives in eventVisuals.js (calendar-specific FULL-color
// intensity of the one canonical guide-color rule + status layering).

const WEEKDAY_HEADERS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// Time-grid window (week/day views). Tours are daytime work; events outside
// the window are clamped into it rather than hidden.
const GRID_START_MIN = 6 * 60;
const GRID_END_MIN = 23 * 60;
const GRID_TOTAL_MIN = GRID_END_MIN - GRID_START_MIN;
const DEFAULT_DURATION_HOURS = 2;

export default function ToursCalendar({ search, kind, statuses, status, onOpenTour, view, onViewState }) {
  // Canonical multi-select set; the legacy single `status` prop still
  // normalizes through the ONE shared helper (old callers/tests keep working).
  const statusList = useMemo(
    () => normalizeStatusFilter(statuses ?? status),
    [statuses, status],
  );
  const [mode, setMode] = useState(view?.mode || 'month'); // 'month' | 'week' | 'day'
  const [anchor, setAnchor] = useState(view?.anchor || todayIL());
  const [events, setEvents] = useState(null); // null = loading
  const [error, setError] = useState(null);
  // Bumped by a tour-changed signal to force a silent re-fetch of the visible
  // range (a date MOVE is self-correcting: the tour leaves the old range and
  // joins the new one because we re-query rather than patch a row).
  const [reloadKey, setReloadKey] = useState(0);
  useTourChanged(() => setReloadKey((k) => k + 1));

  // Visible range per mode (month includes leading/trailing grid days).
  const { from, to, weeks } = useMemo(() => {
    if (mode === 'month') {
      const grid = monthGrid(startOfMonth(anchor));
      return { from: grid[0][0], to: grid.at(-1).at(-1), weeks: grid };
    }
    if (mode === 'week') {
      const start = startOfWeek(anchor);
      return { from: start, to: addDays(start, 6), weeks: null };
    }
    return { from: anchor, to: anchor, weeks: null };
  }, [mode, anchor]);

  useEffect(() => {
    onViewState?.({ mode, anchor });
  }, [mode, anchor, onViewState]);

  const statusesParam = statusList.join(',');
  useEffect(() => {
    let alive = true;
    setError(null);
    api.tours
      .calendar({ from, to, statuses: statusesParam, ...(kind && kind !== 'all' ? { kind } : {}) })
      .then((res) => {
        if (alive) setEvents(res.events || []);
      })
      .catch((e) => {
        if (alive) {
          setEvents([]);
          setError(e.payload?.error || e.message);
        }
      });
    return () => {
      alive = false;
    };
  }, [from, to, statusesParam, kind, reloadKey]);

  // Same free-text semantics as the table (product / city / notes / date) and
  // a client-side re-check of the status filter so the two views can never
  // show different datasets under the same filter state.
  const visible = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    return (events || []).filter((ev) => {
      if (!statusList.includes(ev.status)) return false;
      if (!q) return true;
      return [ev.productName, ev.city, ev.notes, ev.date, ev.customerDisplayName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [events, search, statusList]);

  const byDate = useMemo(() => {
    const map = new Map();
    for (const ev of visible) {
      if (!map.has(ev.date)) map.set(ev.date, []);
      map.get(ev.date).push(ev);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    }
    return map;
  }, [visible]);

  const today = todayIL();

  function navigate(dir) {
    if (mode === 'month') setAnchor(addMonths(startOfMonth(anchor), dir));
    else setAnchor(addDays(anchor, dir * (mode === 'week' ? 7 : 1)));
  }

  const title =
    mode === 'month'
      ? monthTitle(startOfMonth(anchor))
      : mode === 'week'
        ? `${fmtDayShort(from)} – ${fmtDayShort(to)} · ${monthTitle(startOfMonth(to))}`
        : fmtTourDate(anchor);

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Navigation header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          {/* RTL semantics: the grid's days run right→left, so PREVIOUS points
              RIGHT and NEXT points LEFT (Hebrew calendar convention).
              BOTH chevron families (‹/› U+2039/A AND ❮/❯ U+276E/F) are
              Bidi_Mirrored=Yes per Unicode BidiMirroring.txt — inside a
              dir="rtl" context the browser flips the glyph, so the visible
              icon disagrees with the action (the "reversed arrows" production
              bug, twice). NavButton therefore bidi-ISOLATES its glyph in a
              dir="ltr" span: the character always renders exactly as written,
              independent of any codepoint's mirroring property. */}
          <NavButton onClick={() => navigate(-1)} label="הקודם">❯</NavButton>
          <button
            type="button"
            onClick={() => setAnchor(todayIL())}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50"
          >
            היום
          </button>
          <NavButton onClick={() => navigate(1)} label="הבא">❮</NavButton>
          <span className="ms-2 text-[15px] font-bold text-gray-900">{title}</span>
        </div>
        <div className="flex items-center rounded-lg border border-gray-300 p-0.5">
          {[
            ['month', 'חודש'],
            ['week', 'שבוע'],
            ['day', 'יום'],
          ].map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 text-[12.5px] font-semibold transition-colors ${
                mode === m ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="py-12 text-center text-sm text-red-600">
          שגיאה בטעינת הלוח: <span dir="ltr" className="font-mono">{error}</span>
        </div>
      ) : events === null ? (
        <div className="py-16 text-center text-sm text-gray-400">טוען לוח שנה…</div>
      ) : mode === 'month' ? (
        <MonthView
          weeks={weeks}
          monthStart={startOfMonth(anchor)}
          byDate={byDate}
          today={today}
          onOpenTour={onOpenTour}
          onOpenDay={(d) => {
            setAnchor(d);
            setMode('day');
          }}
        />
      ) : (
        <TimeGridView
          days={mode === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(from, i)) : [anchor]}
          byDate={byDate}
          today={today}
          onOpenTour={onOpenTour}
          detailed={mode === 'day'}
        />
      )}

      {events !== null && !error && visible.length === 0 && (
        <div className="border-t border-gray-100 py-3 text-center text-[12.5px] text-gray-400">
          אין סיורים בטווח המוצג לפי הסינון הנוכחי.
        </div>
      )}
    </div>
  );
}

function NavButton({ onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 bg-white text-lg text-gray-600 hover:bg-gray-50"
    >
      {/* dir="ltr" bidi-isolates the glyph: chevron characters are
          Bidi_Mirrored and would flip inside the page's RTL context —
          the icon must always point exactly as authored. */}
      <span dir="ltr" aria-hidden>{children}</span>
    </button>
  );
}

// ── month view ────────────────────────────────────────────────────────

const MONTH_CELL_MAX_EVENTS = 3;

function MonthView({ weeks, monthStart, byDate, today, onOpenTour, onOpenDay }) {
  const nextMonth = addMonths(monthStart, 1);
  return (
    // Wide grid scrolls inside its own container on narrow screens — the page
    // body never scrolls horizontally.
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50/70 text-center text-[11.5px] font-semibold text-gray-500">
        {WEEKDAY_HEADERS.map((d) => (
          <div key={d} className="py-1.5">{d}</div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b border-gray-100 last:border-b-0">
          {week.map((day) => {
            const inMonth = day >= monthStart && day < nextMonth;
            const list = byDate.get(day) || [];
            const isToday = day === today;
            return (
              <div
                key={day}
                className={`min-h-[104px] border-s border-gray-100 p-1 first:border-s-0 ${
                  inMonth ? 'bg-white' : 'bg-gray-50/60'
                }`}
              >
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <span
                    className={`text-[11.5px] tabular-nums ${
                      isToday
                        ? 'flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 font-bold text-white'
                        : inMonth
                          ? 'font-semibold text-gray-700'
                          : 'text-gray-400'
                    }`}
                  >
                    {Number(day.slice(8, 10))}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {list.slice(0, MONTH_CELL_MAX_EVENTS).map((ev) => (
                    <MonthEvent key={ev.id} ev={ev} onOpen={() => onOpenTour(ev.id)} />
                  ))}
                  {list.length > MONTH_CELL_MAX_EVENTS && (
                    <button
                      type="button"
                      onClick={() => onOpenDay(day)}
                      className="w-full rounded px-1 py-0.5 text-right text-[11px] font-semibold text-blue-700 hover:bg-blue-50"
                    >
                      +{list.length - MONTH_CELL_MAX_EVENTS} עוד
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      </div>
    </div>
  );
}

function MonthEvent({ ev, onOpen }) {
  const visual = calendarEventVisual(ev);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={eventTooltip(ev)}
      style={visual.style}
      // Full-color pill (solid) or the shared status style (start-edge
      // border). Dense on purpose: minimal padding, nearly full cell width,
      // truncation instead of wrapping — the tooltip carries the full text.
      className={`block w-full truncate rounded-md px-1.5 py-0.5 text-right text-[11px] leading-[1.4] ${
        visual.fg ? '' : 'border-s-2'
      } ${visual.cls}`}
    >
      {/* Status must never rely on color alone: ✓ = completed, ✕ = cancelled. */}
      {ev.status === 'completed' && <span aria-hidden>✓ </span>}
      {ev.status === 'cancelled' && <span aria-hidden>✕ </span>}
      <span className="tabular-nums font-semibold" dir="ltr">{ev.startTime}</span>{' '}
      {/* PRODUCT always first · city only outside the Home Location · customer. */}
      <span className={`font-semibold ${ev.status === 'cancelled' ? 'line-through' : ''}`}>
        {ev.productName || 'סיור'}
      </span>
      {eventCity(ev) && <span> · {eventCity(ev)}</span>}
      {ev.customerDisplayName && <span className="opacity-90"> · {ev.customerDisplayName}</span>}
      {ev.participants > 0 && <span className="text-[10px] opacity-80"> · {ev.participants}</span>}
    </button>
  );
}

// ── week/day time grid ────────────────────────────────────────────────

function TimeGridView({ days, byDate, today, onOpenTour, detailed }) {
  const hours = [];
  for (let m = GRID_START_MIN; m < GRID_END_MIN; m += 60) hours.push(m);
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        {/* Day headers */}
        <div className="grid border-b border-gray-200 bg-gray-50/70" style={{ gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(0,1fr))` }}>
          <div />
          {days.map((day) => (
            <div key={day} className="border-s border-gray-100 py-1.5 text-center">
              <div className="text-[11.5px] font-semibold text-gray-500">
                {WEEKDAY_HEADERS[new Date(`${day}T00:00:00Z`).getUTCDay()]}
              </div>
              <div
                className={`mx-auto mt-0.5 w-fit rounded-full px-1.5 text-[12.5px] tabular-nums ${
                  day === today ? 'bg-blue-600 font-bold text-white' : 'font-semibold text-gray-800'
                }`}
              >
                {fmtDayShort(day)}
              </div>
            </div>
          ))}
        </div>
        {/* Grid body */}
        <div className="relative grid" style={{ gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(0,1fr))` }}>
          {/* Hour gutter */}
          <div>
            {hours.map((m) => (
              <div key={m} className="h-14 border-b border-gray-100 pe-1.5 pt-0.5 text-left text-[10.5px] tabular-nums text-gray-400" dir="ltr">
                {String(m / 60).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {days.map((day) => (
            <DayColumn
              key={day}
              day={day}
              hours={hours}
              events={byDate.get(day) || []}
              isToday={day === today}
              onOpenTour={onOpenTour}
              detailed={detailed}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Greedy lane assignment so overlapping events sit side-by-side instead of
// stacking. Small N per day — simplicity over cleverness.
function assignLanes(events) {
  const placed = [];
  for (const ev of events) {
    const start = clampMin(timeToMinutes(ev.startTime));
    const end = Math.min(start + (ev.durationHours || DEFAULT_DURATION_HOURS) * 60, GRID_END_MIN);
    let lane = 0;
    while (placed.some((p) => p.lane === lane && p.start < end && start < p.end)) lane += 1;
    placed.push({ ev, start, end, lane });
  }
  const lanes = Math.max(1, ...placed.map((p) => p.lane + 1));
  return { placed, lanes };
}

function clampMin(m) {
  if (Number.isNaN(m)) return GRID_START_MIN;
  return Math.min(Math.max(m, GRID_START_MIN), GRID_END_MIN - 30);
}

function DayColumn({ day, hours, events, isToday, onOpenTour, detailed }) {
  const { placed, lanes } = assignLanes(events);
  return (
    <div className={`relative border-s border-gray-100 ${isToday ? 'bg-blue-50/30' : ''}`}>
      {hours.map((m) => (
        <div key={m} className="h-14 border-b border-gray-100" />
      ))}
      {placed.map(({ ev, start, end, lane }) => {
        const top = ((start - GRID_START_MIN) / GRID_TOTAL_MIN) * 100;
        const height = Math.max(((end - start) / GRID_TOTAL_MIN) * 100, 3.5);
        const width = 100 / lanes;
        const visual = calendarEventVisual(ev);
        return (
          <button
            key={ev.id}
            type="button"
            onClick={() => onOpenTour(ev.id)}
            title={eventTooltip(ev)}
            className={`absolute overflow-hidden rounded-md p-1 text-right text-[11px] leading-tight shadow-sm ${
              visual.fg ? '' : 'border-s-[3px]'
            } ${visual.cls}`}
            style={{
              ...visual.style,
              top: `${top}%`,
              height: `${height}%`,
              right: `${lane * width}%`,
              width: `calc(${width}% - 3px)`,
            }}
          >
            <div className="font-semibold tabular-nums" dir="ltr">
              {ev.startTime}
              {endTimeOf(ev.startTime, ev.durationHours) ? `–${endTimeOf(ev.startTime, ev.durationHours)}` : ''}
            </div>
            {/* PRODUCT first; city only outside the Home Location; customer next. */}
            <div className={`truncate font-bold ${ev.status === 'cancelled' ? 'line-through' : ''}`}>
              {ev.productName || 'סיור'}
            </div>
            {eventCity(ev) && <div className="truncate">{eventCity(ev)}</div>}
            {ev.customerDisplayName && <div className="truncate">{ev.customerDisplayName}</div>}
            <div className="truncate opacity-85">
              {ev.participants > 0 && <>👥 {ev.participants}{ev.capacity != null ? `/${ev.capacity}` : ''} </>}
              {ev.leadGuideName || (ev.teamCount > 0 ? `${ev.teamCount} מדריכים` : '')}
            </div>
            {detailed && ev.components?.length > 0 && (
              <div className="truncate opacity-75">{ev.components.join(' · ')}</div>
            )}
            {/* Black ≠ cancelled: an unassigned scheduled tour says so in text. */}
            {isUnassignedScheduled(ev) && (
              <div className="mt-0.5 text-[10px] font-bold opacity-90">לא משובץ</div>
            )}
            {ev.status !== 'scheduled' && (
              <div className="mt-0.5 text-[10px] font-bold">{TOUR_STATUS_LABELS[ev.status]}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function eventTooltip(ev) {
  // The tooltip is the UN-truncated truth: city always appears here (even at
  // the Home Location), so the compact pill never hides information for good.
  return [
    `${ev.productName || 'סיור'}${ev.city ? ` · ${ev.city}` : ''}`,
    `${fmtTourDate(ev.date)} · ${ev.startTime || ''}`,
    ev.customerDisplayName ? `לקוח: ${ev.customerDisplayName}` : null,
    `סטטוס: ${TOUR_STATUS_LABELS[ev.status] || ev.status}`,
    ev.participants > 0 ? `משתתפים: ${ev.participants}${ev.capacity != null ? ` / ${ev.capacity}` : ''}` : null,
    ev.leadGuideName ? `מדריך ראשי: ${ev.leadGuideName}` : null,
    isUnassignedScheduled(ev) ? 'לא משובץ מדריך' : null,
    ev.components?.length ? `פעילויות: ${ev.components.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}
