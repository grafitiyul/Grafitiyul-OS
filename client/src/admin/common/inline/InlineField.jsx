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
const INPUT_BASE = 'h-9 w-full rounded-md border border-blue-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-200';
// Inline-end space reserved for the floating ✓/✕ overlay (coordinated edit only) so
// the value never slides under the controls. Without the overlay (editFirst) the
// input keeps symmetric padding.
const INPUT_PAD_OVERLAY = 'ps-2 pe-16';
// Shared label + value treatment so read and edit modes line up pixel-for-pixel
// (px-2 matches the input's text inset → the value never shifts horizontally when
// the field flips between read and edit). Label is light + roomy; value is strong.
// This is the platform hierarchy: light label ↓ comfortable gap ↓ strong value.
const LABEL = 'block text-[11px] text-gray-400 mb-1.5 px-2';
const VALUE = 'text-[15px] truncate';
// Read and edit share this min-height so the row keeps its size across the flip.
const BODY = 'min-h-[38px]';

export default function InlineField({
  id, label, type = 'text', value, options, display, placeholder = '—',
  editFirst = false, onSave, dir, numeric,
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

  // ── READ presentation (coordinated, closed) ──
  // No negative margins: the read value sits at the SAME x as the edit input's text
  // (both px-2), so opening the field transforms it in place — nothing shifts.
  if (coordinated && !open) {
    const empty = value === '' || value === null || value === undefined;
    return (
      <div className="group">
        {label && <span className={LABEL}>{label}</span>}
        <button
          type="button"
          onClick={() => scope.requestOpen(id)}
          className={`w-full text-right rounded-md px-2 ${BODY} flex items-center gap-2 transition-colors hover:bg-gray-50`}
        >
          <span className={`${VALUE} ${empty ? 'text-gray-300' : 'font-medium text-gray-900'}`} dir={dir}>
            {empty ? placeholder : (display ? display(value) : defaultDisplay(type, value, options))}
          </span>
          <span className="ms-auto shrink-0 text-[12px] text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
        </button>
      </div>
    );
  }

  // ── EDIT presentation ──
  // The input spans the FULL field width; the ✓/✕ are a small FLOATING overlay
  // pinned to the inline-end (absolute → zero layout width). So small fields stay
  // usable, the value stays readable (reserved inline-end padding), and no
  // neighbour moves. A 1px fade-in only; never a slide.
  return (
    <div>
      {label && <span className={LABEL}>{label}</span>}
      <div className={`relative flex items-center ${BODY} animate-[inlineIn_120ms_ease-out]`}>
        <div className="flex-1 min-w-0">{renderInput()}</div>
        {coordinated && (
          <div className="absolute inset-y-0 end-1 flex items-center gap-0.5 pointer-events-none">
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={commit} disabled={saving}
              title="שמור (Enter)"
              className="pointer-events-auto h-7 w-7 inline-flex items-center justify-center rounded-md bg-emerald-600 text-white text-[13px] shadow-sm hover:bg-emerald-700 disabled:opacity-50">
              ✓
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={cancel} disabled={saving}
              title="ביטול (Esc)"
              className="pointer-events-auto h-7 w-7 inline-flex items-center justify-center rounded-md border border-gray-300 bg-white text-gray-500 text-[12px] shadow-sm hover:bg-gray-50 disabled:opacity-50">
              ✕
            </button>
          </div>
        )}
      </div>
      {error && <div className="text-[11px] text-red-600 mt-1 px-2">{error}</div>}
    </div>
  );

  function renderInput() {
    // Reserve inline-end room ONLY when the floating ✓/✕ overlay is shown
    // (coordinated). editFirst has no overlay → symmetric padding.
    const inputCls = `${INPUT_BASE} ${coordinated ? INPUT_PAD_OVERLAY : 'px-2'}`;
    const common = {
      ref,
      value: draft ?? '',
      onKeyDown,
      disabled: saving,
      className: inputCls,
      ...(editFirst ? { onBlur: commit } : {}),
    };
    if (type === 'dropdown') {
      return (
        <select {...common} className={`${inputCls} bg-white`} onChange={(e) => setDraft(e.target.value)}>
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
      return <textarea {...common} rows={3} dir={dir} onChange={(e) => setDraft(e.target.value)} className={`${inputCls} h-auto py-1.5 leading-relaxed`} />;
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
