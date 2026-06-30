import { useEffect, useMemo, useRef, useState } from 'react';
import AnchoredMenu from '../AnchoredMenu.jsx';
import { useInlineScope } from './InlineEditScope.jsx';

// Fillout-style date & time pickers for the inline panel. Pure UI/UX: the data
// model is unchanged — date is a "YYYY-MM-DD" string, time is "HH:MM", and
// onSave persists exactly as before. No typing, no native datetime control; a
// clean calendar popover and a 15-minute time list, both one-click to choose.
//
// Both reuse the platform pieces: useInlineScope (one field open at a time) and
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

// ── Date ── clean calendar popover; choosing a day saves + closes immediately.
export function InlineDatePicker({ id, label, icon, value, placeholder, onSave }) {
  const scope = useInlineScope();
  const open = scope.openId === id;
  const anchorRef = useRef(null);
  const [view, setView] = useState(() => firstOfMonth(value));

  // Re-anchor the visible month to the selected date each time the popover opens.
  useEffect(() => {
    if (open) setView(firstOfMonth(value));
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
      <AnchoredMenu anchorRef={anchorRef} open={open} onClose={scope.close} width={252} align="start">
        <div className="px-2 pb-1.5 pt-1" dir="rtl">
          {/* Month nav. In RTL the right chevron steps BACK a month, left steps forward. */}
          <div className="flex items-center justify-between px-1 py-1">
            <button type="button" onClick={() => setView(new Date(y, m - 1, 1))}
              aria-label="חודש קודם"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100">›</button>
            <span className="text-[13px] font-semibold text-gray-800">{MONTHS_HE[m]} {y}</span>
            <button type="button" onClick={() => setView(new Date(y, m + 1, 1))}
              aria-label="חודש הבא"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100">‹</button>
          </div>
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
        </div>
      </AnchoredMenu>
    </>
  );
}

// ── Time ── simple 15-minute list; one click saves + closes.
export function InlineTimePicker({ id, label, icon, value, placeholder, onSave, stepMinutes = 15 }) {
  const scope = useInlineScope();
  const open = scope.openId === id;
  const anchorRef = useRef(null);
  const selectedRef = useRef(null);

  const options = useMemo(() => {
    const out = [];
    for (let mins = 0; mins < 24 * 60; mins += stepMinutes) {
      out.push(`${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`);
    }
    return out;
  }, [stepMinutes]);

  // Scroll the selected time into view when the list opens.
  useEffect(() => {
    if (!open) return undefined;
    const raf = requestAnimationFrame(() => {
      selectedRef.current?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  function pick(t) {
    scope.close();
    if ((t || '') !== (value || '')) onSave(t || '');
  }

  const current = fmtTime(value);

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
      <AnchoredMenu anchorRef={anchorRef} open={open} onClose={scope.close} width={132} align="start">
        <div className="max-h-64 overflow-auto">
          {options.map((t) => {
            const selected = t === current;
            return (
              <button
                key={t}
                ref={selected ? selectedRef : null}
                type="button"
                onClick={() => pick(t)}
                dir="ltr"
                className={`block w-full text-center px-3 py-1.5 text-[13px] transition-colors ${
                  selected ? 'bg-blue-600 text-white font-semibold' : 'text-gray-700 hover:bg-blue-50'
                }`}
              >
                {t}
              </button>
            );
          })}
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
