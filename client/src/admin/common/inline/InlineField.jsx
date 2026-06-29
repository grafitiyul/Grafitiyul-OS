import { useEffect, useRef, useState } from 'react';
import { useInlineScope } from './InlineEditScope.jsx';

// Platform inline-edit field. The standard GOS editing experience:
//   Read First → Click to Edit → Save Immediately → Back to Read.
// One field edits at a time (via InlineEditScope). Enter = save, Esc = cancel,
// ✓/✕ buttons mirror them. Saving persists ONLY this field (the caller's onSave).
//
// `editFirst` flips the resting presentation to an always-open input (form-like,
// for "Edit First" pipeline stages); it saves on blur + Enter and isn't governed by
// the one-at-a-time scope.
//
// Types: text | number | dropdown | date | time | textarea. (Rich text is handled
// by the collapsible note component, not here — for now.)

function flatten(options) {
  const out = [];
  (options || []).forEach((o) => (o.options ? out.push(...o.options) : out.push(o)));
  return out;
}
function fmtDate(v) {
  if (!v) return '';
  // v is "YYYY-MM-DD"
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
}
function defaultDisplay(type, value, options) {
  if (value === '' || value === null || value === undefined) return '';
  if (type === 'dropdown') return flatten(options).find((o) => o.value === value)?.label ?? String(value);
  if (type === 'date') return fmtDate(value);
  return String(value);
}
// Symmetric padding so the edit input occupies EXACTLY the read value's box (same
// width + text origin). The ✓/✕ never live inside the input — they float below as a
// mini-toolbar (see edit presentation), so the input is never reserved/cramped.
const INPUT = 'h-9 w-full rounded-md border border-blue-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200';
// Shared label + value treatment so read and edit modes line up pixel-for-pixel
// (px-2 matches the input's text inset → the value never shifts horizontally when
// the field flips between read and edit). Label is light + roomy; value is strong.
// This is the platform hierarchy: light label ↓ comfortable gap ↓ strong value.
const LABEL = 'block text-[11px] text-gray-400 mb-1.5 px-2';
const VALUE = 'truncate';
// Read and edit share this min-height so the row keeps its size across the flip.
const BODY = 'min-h-[38px]';

export default function InlineField({
  id, label, type = 'text', value, options, display, placeholder = '—',
  editFirst = false, onSave, dir, numeric, icon, valueClassName, iconInline = false,
  readOnly = false, readOnlyHint,
}) {
  const scope = useInlineScope();
  const coordinated = !editFirst;
  const open = coordinated ? scope.openId === id : true;
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);

  // Keep the draft in sync with the stored value while not actively editing.
  useEffect(() => {
    if (!open) { setDraft(value ?? ''); setError(null); }
  }, [value, open]);
  // On open (coordinated): seed + focus.
  useEffect(() => {
    if (open && coordinated) { setDraft(value ?? ''); setError(null); }
    if (open) { const t = setTimeout(() => ref.current?.focus?.(), 0); return () => clearTimeout(t); }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function commit() {
    const v = draft === '' ? '' : draft;
    if ((v ?? '') === (value ?? '')) { if (coordinated) scope.close(); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave?.(v);
      if (coordinated) scope.close();
    } catch (e) {
      setError(e.payload?.error || e.message || 'שמירה נכשלה');
    } finally {
      setSaving(false);
    }
  }
  function cancel() {
    setDraft(value ?? '');
    setError(null);
    if (coordinated) scope.close();
  }
  function onKeyDown(e) {
    if (e.key === 'Enter' && type !== 'textarea') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  }

  // Label with an optional leading icon. The icon inherits the label's muted color
  // via currentColor unless the caller passes its own colored icon (e.g. red alert).
  const labelNode = (label || icon) ? (
    <span className={LABEL}>
      <span className="inline-flex items-center gap-1.5">{icon}{label}</span>
    </span>
  ) : null;

  // Icon-inline mode: NO label text. The icon sits beside the value as the field's
  // visual identifier, NOT clickable, and carries the field name as a hover tooltip.
  // Only the value is clickable (opens edit), exactly as in label mode.
  const inlineIcon = iconInline && icon ? (
    <span title={label} className="shrink-0 inline-flex cursor-default">{icon}</span>
  ) : null;

  // ── READ-ONLY presentation ──
  // A locked field: the value is shown but NOT editable (no click-to-edit, no
  // scope). A small lock marks it; the hover hint says why. Used e.g. for a Group
  // deal's participants, which are derived from the Group Ticket Builder.
  if (readOnly) {
    const empty = value === '' || value === null || value === undefined;
    const valueSpan = (
      <span
        className={`${VALUE} ${valueClassName || `text-[15px] ${empty ? 'text-gray-300' : 'font-medium text-gray-700'}`}`}
        dir={dir}
      >
        {empty ? placeholder : display ? display(value) : defaultDisplay(type, value, options)}
      </span>
    );
    const lock = (
      <span className="ms-auto shrink-0 text-[11px] text-gray-300" aria-hidden title={readOnlyHint}>🔒</span>
    );
    if (iconInline) {
      return (
        <div className="flex items-center gap-1 w-full" title={readOnlyHint || label}>
          {inlineIcon}
          <div className={`flex-1 min-w-0 px-1 ${BODY} flex items-center gap-1.5`}>
            {valueSpan}
            {lock}
          </div>
        </div>
      );
    }
    return (
      <div title={readOnlyHint}>
        {labelNode}
        <div className={`px-2 ${BODY} flex items-center gap-2`}>
          {valueSpan}
          {lock}
        </div>
      </div>
    );
  }

  // ── READ presentation (coordinated, closed) ──
  // No negative margins: the read value sits at the SAME x as the edit input's text
  // (both px-2), so opening the field transforms it in place — nothing shifts.
  if (coordinated && !open) {
    const empty = value === '' || value === null || value === undefined;
    const valueSpan = (
      <span
        className={`${VALUE} ${valueClassName || `text-[15px] ${empty ? 'text-gray-300' : 'font-medium text-gray-900'}`}`}
        dir={dir}
      >
        {empty ? placeholder : (display ? display(value) : defaultDisplay(type, value, options))}
      </span>
    );
    if (iconInline) {
      // Tight icon→value gap: the icon feels attached to its value (one unit).
      return (
        <div className="group flex items-center gap-1 w-full">
          {inlineIcon}
          <button
            type="button"
            onClick={() => scope.requestOpen(id)}
            className={`flex-1 min-w-0 text-right rounded-md px-1 ${BODY} flex items-center gap-1.5 transition-colors hover:bg-gray-50`}
          >
            {valueSpan}
            <span className="ms-auto shrink-0 text-[12px] text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
          </button>
        </div>
      );
    }
    return (
      <div className="group">
        {labelNode}
        <button
          type="button"
          onClick={() => scope.requestOpen(id)}
          className={`w-full text-right rounded-md px-2 ${BODY} flex items-center gap-2 transition-colors hover:bg-gray-50`}
        >
          {valueSpan}
          <span className="ms-auto shrink-0 text-[12px] text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
        </button>
      </div>
    );
  }

  // ── EDIT presentation ──
  // The input occupies EXACTLY the read value's box (full width, symmetric padding)
  // — the same information field simply became editable. The ✓/✕ are a small,
  // Notion-style FLOATING mini-toolbar pinned just below the field's inline-end
  // (absolute → consumes ZERO row/grid space). So nothing is cramped, no neighbour
  // moves, and there is no layout jump. A 1px fade-in only; never a slide.
  return (
    <div>
      {!iconInline && labelNode}
      <div className={`relative ${BODY} flex items-center ${iconInline ? 'gap-1' : ''} animate-[inlineIn_120ms_ease-out]`}>
        {inlineIcon}
        <div className="flex-1 min-w-0">{renderInput()}</div>
        {coordinated && (
          <div className="absolute top-full end-0 z-30 mt-1 inline-flex items-center rounded-lg border border-gray-200 bg-white shadow-md overflow-hidden">
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={commit} disabled={saving}
              title="שמור (Enter)" aria-label="שמור"
              className="h-7 w-7 inline-flex items-center justify-center text-[13px] text-emerald-600 hover:bg-emerald-50 disabled:opacity-50">
              ✓
            </button>
            <span className="w-px h-4 bg-gray-200" aria-hidden />
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={cancel} disabled={saving}
              title="ביטול (Esc)" aria-label="ביטול"
              className="h-7 w-7 inline-flex items-center justify-center text-[12px] text-gray-400 hover:bg-gray-50 hover:text-gray-600 disabled:opacity-50">
              ✕
            </button>
          </div>
        )}
      </div>
      {error && <div className="text-[11px] text-red-600 mt-1 px-2">{error}</div>}
    </div>
  );

  function renderInput() {
    const common = {
      ref,
      value: draft ?? '',
      onKeyDown,
      disabled: saving,
      className: INPUT,
      ...(editFirst ? { onBlur: commit } : {}),
    };
    if (type === 'dropdown') {
      return (
        <select {...common} className={`${INPUT} bg-white`} onChange={(e) => setDraft(e.target.value)}>
          <option value="">— ללא —</option>
          {(options || []).map((o) =>
            o.options ? (
              <optgroup key={o.label} label={o.label}>
                {o.options.map((x) => (<option key={x.value} value={x.value}>{x.label}</option>))}
              </optgroup>
            ) : (
              <option key={o.value} value={o.value}>{o.label}</option>
            ),
          )}
        </select>
      );
    }
    if (type === 'textarea') {
      return <textarea {...common} rows={3} dir={dir} onChange={(e) => setDraft(e.target.value)} className={`${INPUT} h-auto py-1.5 leading-relaxed`} />;
    }
    const htmlType = type === 'date' ? 'date' : type === 'time' ? 'time' : 'text';
    return (
      <input
        {...common}
        type={htmlType}
        dir={dir || (type === 'number' || type === 'date' || type === 'time' ? 'ltr' : undefined)}
        inputMode={numeric || type === 'number' ? 'numeric' : undefined}
        onChange={(e) => setDraft(numeric ? e.target.value.replace(/[^0-9]/g, '') : e.target.value)}
      />
    );
  }
}
