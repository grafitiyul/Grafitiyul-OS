import { useEffect, useMemo, useRef, useState } from 'react';
import AnchoredMenu from '../AnchoredMenu.jsx';
import { useInlineScope } from './InlineEditScope.jsx';

// Fillout-style date & time pickers for the inline panel. Pure UI/UX: the data
// model is unchanged — date is a "YYYY-MM-DD" string, time is "HH:MM", and
// onSave persists exactly as before. No native datetime control.
//
// Date: a calendar popover with fast month/year navigation (click the title to
// pick a month; step years). Time: a combobox — type to filter/normalise, or
// pick from the 15-minute list; an off-grid current value is preserved.
//
// Reuses platform pieces: useInlineScope (one field open at a time) and
// AnchoredMenu (portaled popover with click-outside + Esc + viewport clamping).

const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const MONTHS_HE = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

function pad2(n) {
  return String(n).padStart(2, '0');
}
function ymd(y, m0, d) {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
}
function parseYmd(value) {
  return /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
}
function fmtDate(v) {
  const m = parseYmd(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v || '';
}
function fmtTime(v) {
  const m = /^(\d{1,2}):(\d{2})/.exec(v || '');
  return m ? `${pad2(Number(m[1]))}:${m[2]}` : v || '';
}
function firstOfMonth(value) {
  const m = parseYmd(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1);
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// Normalise free text into "HH:MM" or null. Accepts: "13" (→13:00), "930"
// (→09:30), "0930", "9:5" (→09:05), "13:07". Rejects out-of-range values.
function normalizeTime(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  let h;
  let m;
  if (s.includes(':')) {
    const parts = s.split(':');
    if (parts.length !== 2) return null;
    h = parseInt(parts[0], 10);
    m = parseInt(parts[1] === '' ? '0' : parts[1], 10);
  } else {
    const digits = s.replace(/\D/g, '');
    if (!digits || digits.length > 4) return null;
    if (digits.length <= 2) {
      h = parseInt(digits, 10);
      m = 0;
    } else if (digits.length === 3) {
      h = parseInt(digits.slice(0, 1), 10);
      m = parseInt(digits.slice(1), 10);
    } else {
      h = parseInt(digits.slice(0, 2), 10);
      m = parseInt(digits.slice(2), 10);
    }
  }
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${pad2(h)}:${pad2(m)}`;
}

// Suggestions for a typed query. A bare hour ("13") → its four quarter slots; an
// exact time ("13:07", "930") → that exact time plus the hour's quarters. Returns
// [] for invalid input, or null to mean "show the full list" (empty query).
function suggestionsFor(query) {
  const s = String(query || '').trim();
  if (!s) return null;
  if (/^\d{1,2}$/.test(s)) {
    const h = parseInt(s, 10);
    if (h < 0 || h > 23) return [];
    return ['00', '15', '30', '45'].map((mm) => `${pad2(h)}:${mm}`);
  }
  const exact = normalizeTime(s);
  if (!exact) return [];
  const h = parseInt(exact.slice(0, 2), 10);
  const quarters = ['00', '15', '30', '45'].map((mm) => `${pad2(h)}:${mm}`);
  return quarters.includes(exact) ? quarters : [exact, ...quarters];
}

// Non-mirrored chevron (SVG → never bidi-flipped, so RTL direction is exact).
function Chevron({ dir }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
const NAV_BTN = 'h-7 w-7 inline-flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100';

// Shared read trigger — visually identical to InlineField's icon-inline read mode
// (icon beside a clickable value), so the picker sits flush with its grid row.
function PickerTrigger({ label, icon, value, display, placeholder = '—', anchorRef, active, onOpen }) {
  const empty = value === '' || value === null || value === undefined;
  return (
    <div className="group flex items-center gap-1 w-full">
      <span title={label} className="shrink-0 inline-flex cursor-default">{icon}</span>
      <button
        type="button"
        ref={anchorRef}
        onClick={onOpen}
        className={`flex-1 min-w-0 text-right rounded-md px-1 min-h-[38px] flex items-center gap-1.5 transition-colors hover:bg-gray-50 ${active ? 'bg-gray-50' : ''}`}
      >
        <span className={`truncate text-[15px] ${empty ? 'text-gray-300' : 'font-medium text-gray-900'}`} dir="ltr">
          {empty ? placeholder : display(value)}
        </span>
        <span className="ms-auto shrink-0 text-[12px] text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">▾</span>
      </button>
    </div>
  );
}

// ── Date ── calendar popover; choosing a day saves + closes immediately.
export function InlineDatePicker({ id, label, icon, value, placeholder, onSave }) {
  const scope = useInlineScope();
  const open = scope.openId === id;
  const anchorRef = useRef(null);
  const [view, setView] = useState(() => firstOfMonth(value));
  const [mode, setMode] = useState('days'); // 'days' | 'months'

  // Re-anchor to the selected month and reset to the day grid on each open.
  useEffect(() => {
    if (open) {
      setView(firstOfMonth(value));
      setMode('days');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pick(dateStr) {
    scope.close();
    if ((dateStr || '') !== (value || '')) onSave(dateStr || '');
  }

  const y = view.getFullYear();
  const m = view.getMonth();
  const cells = useMemo(() => {
    const lead = new Date(y, m, 1).getDay(); // 0 = Sunday
    const days = new Date(y, m + 1, 0).getDate();
    const out = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= days; d++) out.push(d);
    return out;
  }, [y, m]);

  const todayStr = useMemo(() => {
    const t = new Date();
    return ymd(t.getFullYear(), t.getMonth(), t.getDate());
  }, []);
  const selMatch = parseYmd(value);
  const selYear = selMatch ? Number(selMatch[1]) : null;
  const selMonth0 = selMatch ? Number(selMatch[2]) - 1 : null;

  return (
    <>
      <PickerTrigger
        label={label}
        icon={icon}
        value={value}
        display={fmtDate}
        placeholder={placeholder}
        anchorRef={anchorRef}
        active={open}
        onOpen={() => scope.requestOpen(id)}
      />
      <AnchoredMenu anchorRef={anchorRef} open={open} onClose={scope.close} width={256} align="start">
        <div className="px-2 pb-1.5 pt-1.5">
          {/* Header. RTL: previous is on the RIGHT (chevron points right), next on
              the LEFT (points left). The title opens the month/year chooser. */}
          <div className="flex items-center justify-between px-1 pb-1.5">
            {mode === 'days' ? (
              <>
                <button type="button" onClick={() => setView(new Date(y, m - 1, 1))} aria-label="חודש קודם" className={NAV_BTN}>
                  <Chevron dir="right" />
                </button>
                <button
                  type="button"
                  onClick={() => setMode('months')}
                  className="text-[13px] font-semibold text-gray-800 rounded-md px-2 py-1 hover:bg-gray-100"
                >
                  {MONTHS_HE[m]} {y}
                </button>
                <button type="button" onClick={() => setView(new Date(y, m + 1, 1))} aria-label="חודש הבא" className={NAV_BTN}>
                  <Chevron dir="left" />
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setView(new Date(y - 1, m, 1))} aria-label="שנה קודמת" className={NAV_BTN}>
                  <Chevron dir="right" />
                </button>
                <button
                  type="button"
                  onClick={() => setMode('days')}
                  className="text-[13px] font-semibold text-gray-800 rounded-md px-2 py-1 hover:bg-gray-100"
                >
                  {y}
                </button>
                <button type="button" onClick={() => setView(new Date(y + 1, m, 1))} aria-label="שנה הבאה" className={NAV_BTN}>
                  <Chevron dir="left" />
                </button>
              </>
            )}
          </div>

          {mode === 'days' ? (
            <>
              <div className="grid grid-cols-7 gap-0.5 px-0.5 text-[11px] text-gray-400 text-center pb-0.5">
                {WEEKDAYS.map((w) => (<div key={w} className="h-6 flex items-center justify-center">{w}</div>))}
              </div>
              <div className="grid grid-cols-7 gap-0.5 px-0.5">
                {cells.map((d, i) => {
                  if (d === null) return <div key={`e${i}`} className="h-8" />;
                  const str = ymd(y, m, d);
                  const selected = str === (value || '');
                  const isToday = str === todayStr;
                  return (
                    <button
                      key={str}
                      type="button"
                      onClick={() => pick(str)}
                      className={`h-8 w-8 mx-auto rounded-md text-[13px] flex items-center justify-center transition-colors ${
                        selected
                          ? 'bg-blue-600 text-white font-semibold'
                          : isToday
                            ? 'text-blue-700 ring-1 ring-blue-300 hover:bg-blue-50'
                            : 'text-gray-700 hover:bg-blue-50'
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between px-1 pt-1.5 mt-1 border-t border-gray-100">
                <button type="button" onClick={() => pick('')} className="text-[12px] text-gray-400 hover:text-red-600">נקה</button>
                <button type="button" onClick={() => pick(todayStr)} className="text-[12px] font-medium text-blue-700 hover:text-blue-800">היום</button>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-3 gap-1 px-0.5 pb-1">
              {MONTHS_HE.map((name, idx) => {
                const isSel = selYear === y && selMonth0 === idx;
                const isView = idx === m;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => { setView(new Date(y, idx, 1)); setMode('days'); }}
                    className={`h-9 rounded-md text-[12px] transition-colors ${
                      isSel
                        ? 'bg-blue-600 text-white font-semibold'
                        : isView
                          ? 'text-blue-700 ring-1 ring-blue-300 hover:bg-blue-50'
                          : 'text-gray-700 hover:bg-blue-50'
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </AnchoredMenu>
    </>
  );
}

// ── Time ── combobox: type to filter/normalise, or pick a 15-minute slot. An
// off-grid current value (e.g. 14:20) is preserved and pinned at the top.
export function InlineTimePicker({ id, label, icon, value, placeholder, onSave, stepMinutes = 15 }) {
  const scope = useInlineScope();
  const open = scope.openId === id;
  const anchorRef = useRef(null);
  const inputRef = useRef(null);
  const selectedRef = useRef(null);
  const [query, setQuery] = useState('');

  const baseOptions = useMemo(() => {
    const out = [];
    for (let mins = 0; mins < 24 * 60; mins += stepMinutes) {
      out.push(`${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`);
    }
    return out;
  }, [stepMinutes]);

  const current = fmtTime(value); // "HH:MM" or ''
  const isOdd = !!current && !baseOptions.includes(current);

  // On open: clear the query, focus the input, scroll the selected slot into view.
  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
      selectedRef.current?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  function pick(t) {
    scope.close();
    if ((t || '') !== (value || '')) onSave(t || '');
  }
  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const exact = normalizeTime(query); // valid exact time saves, even off-grid
      if (exact) pick(exact);
    }
  }

  const trimmed = query.trim();
  const showFull = trimmed === '';
  const suggestions = useMemo(() => suggestionsFor(query), [query]);
  const list = showFull ? (isOdd ? [current, ...baseOptions] : baseOptions) : suggestions || [];

  return (
    <>
      <PickerTrigger
        label={label}
        icon={icon}
        value={value}
        display={fmtTime}
        placeholder={placeholder}
        anchorRef={anchorRef}
        active={open}
        onOpen={() => scope.requestOpen(id)}
      />
      <AnchoredMenu anchorRef={anchorRef} open={open} onClose={scope.close} width={150} align="start">
        <div className="p-1.5 border-b border-gray-100">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            dir="ltr"
            inputMode="numeric"
            placeholder={current || 'הקלד שעה…'}
            className="w-full h-8 rounded-md border border-blue-300 bg-white px-2 text-[13px] text-center focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
        <div className="max-h-56 overflow-auto">
          {list.length === 0 ? (
            <div className="px-3 py-3 text-center text-[12px] text-gray-400">
              {trimmed ? 'זמן לא תקין' : '—'}
            </div>
          ) : (
            list.map((t, i) => {
              const selected = t === current;
              const customTop = showFull && isOdd && i === 0;
              return (
                <button
                  key={`${t}-${i}`}
                  ref={selected ? selectedRef : null}
                  type="button"
                  onClick={() => pick(t)}
                  dir="ltr"
                  className={`flex w-full items-center justify-center gap-1.5 px-3 py-1.5 text-[13px] transition-colors ${
                    selected ? 'bg-blue-600 text-white font-semibold' : 'text-gray-700 hover:bg-blue-50'
                  }`}
                >
                  {t}
                  {customTop && <span className="text-[10px] opacity-70">(נוכחי)</span>}
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-gray-100">
          <button type="button" onClick={() => pick('')} className="block w-full text-center px-3 py-1.5 text-[12px] text-gray-400 hover:text-red-600">
            נקה
          </button>
        </div>
      </AnchoredMenu>
    </>
  );
}
