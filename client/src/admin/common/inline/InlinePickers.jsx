import { useRef } from 'react';
import AnchoredMenu from '../AnchoredMenu.jsx';
import { useInlineScope } from './InlineEditScope.jsx';
import { DatePanel, TimePanel, fmtDate, fmtTime } from '../pickers/DateTimeFields.jsx';

// Inline-panel wrappers around the platform date/time pickers. The popover
// content (calendar / time combobox) lives in common/pickers/DateTimeFields.jsx
// and is shared with the form-style DateField/TimeField — this file only adds
// the inline-edit trigger (icon beside a clickable value, InlineField-style)
// and the useInlineScope "one field open at a time" coordination.
//
// Data model unchanged: date is a "YYYY-MM-DD" string, time is "HH:MM", and
// onSave persists exactly as before. No native datetime control.

// Shared read trigger — visually identical to InlineField's icon-inline read mode
// (icon beside a clickable value), so the picker sits flush with its grid row.
// readOnly renders the same value with a 🔒 (InlineField convention) and a
// hover hint instead of opening the panel — used e.g. for slot-owned fields on
// a deal joined to a group tour.
function PickerTrigger({ label, icon, value, display, placeholder = '—', anchorRef, active, onOpen, readOnly, readOnlyHint }) {
  const empty = value === '' || value === null || value === undefined;
  if (readOnly) {
    return (
      <div className="flex items-center gap-1 w-full min-w-0" title={readOnlyHint || label}>
        <span className="shrink-0 inline-flex cursor-default">{icon}</span>
        <span className={`flex-1 min-w-0 truncate text-right px-1 min-h-[38px] flex items-center text-[15px] ${empty ? 'text-gray-300' : 'font-medium text-gray-900'}`} dir="ltr">
          {empty ? placeholder : display(value)}
        </span>
        <span className="ms-auto shrink-0 text-[11px] text-gray-300" aria-hidden title={readOnlyHint}>🔒</span>
      </div>
    );
  }
  return (
    <div className="group flex items-center gap-1 w-full min-w-0">
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
export function InlineDatePicker({ id, label, icon, value, placeholder, onSave, readOnly = false, readOnlyHint }) {
  const scope = useInlineScope();
  const open = scope.openId === id;
  const anchorRef = useRef(null);

  function pick(dateStr) {
    scope.close();
    if ((dateStr || '') !== (value || '')) onSave(dateStr || '');
  }

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
        readOnly={readOnly}
        readOnlyHint={readOnlyHint}
      />
      {!readOnly && (
        <AnchoredMenu anchorRef={anchorRef} open={open} onClose={scope.close} width={256} align="start">
          <DatePanel value={value} onPick={pick} />
        </AnchoredMenu>
      )}
    </>
  );
}

// ── Time ── combobox: type to filter/normalise, or pick a 15-minute slot. An
// off-grid current value (e.g. 14:20) is preserved and pinned at the top.
export function InlineTimePicker({ id, label, icon, value, placeholder, onSave, stepMinutes = 15, readOnly = false, readOnlyHint }) {
  const scope = useInlineScope();
  const open = scope.openId === id;
  const anchorRef = useRef(null);

  function pick(t) {
    scope.close();
    if ((t || '') !== (value || '')) onSave(t || '');
  }

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
        readOnly={readOnly}
        readOnlyHint={readOnlyHint}
      />
      {!readOnly && (
        <AnchoredMenu anchorRef={anchorRef} open={open} onClose={scope.close} width={150} align="start">
          <TimePanel value={value} onPick={pick} stepMinutes={stepMinutes} />
        </AnchoredMenu>
      )}
    </>
  );
}
