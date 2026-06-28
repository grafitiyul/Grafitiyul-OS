import { useState } from 'react';
import ReorderableList from '../../common/ReorderableList.jsx';

// Shared multi-value channel editor (phones / emails). One source of truth for
// the contact "channels" UI — used by the full Contact page AND the Deal-header
// contact dialog. Each item supports: set-primary, edit value, remove, and
// (when onReorder is provided) drag-to-reorder. New values are added via the
// inline form. All mutations are explicit per-item actions.
//
// Props: onAdd(value) / onSetPrimary(id) / onEditValue(id, value) / onRemove(id)
// / onReorder(ids) each return a promise; onChange() refreshes the parent after
// any successful mutation. onEditValue and onReorder are optional (a caller that
// omits them simply doesn't expose those affordances).
export default function ChannelSection({
  title,
  items,
  placeholder,
  ltr,
  onAdd,
  onSetPrimary,
  onEditValue,
  onRemove,
  onReorder,
  onChange,
  formatValue = (v) => v, // optional display formatter (e.g. phone formatting)
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    const clean = value.trim();
    if (!clean) return;
    setBusy(true);
    try {
      await onAdd(clean);
      setValue('');
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function act(fn) {
    try {
      await fn();
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  const rowProps = { ltr, formatValue, onSetPrimary, onEditValue, onRemove, act };

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <h2 className="text-[14px] font-semibold text-gray-900 mb-3">{title}</h2>
      {items?.length ? (
        onReorder ? (
          <div className="mb-3">
            <ReorderableList
              items={items}
              onReorder={(ids) => act(() => onReorder(ids))}
              renderRow={(item, { handle }) => <ChannelRow item={item} handle={handle} {...rowProps} />}
            />
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 mb-3">
            {items.map((it) => (
              <li key={it.id}>
                <ChannelRow item={it} {...rowProps} />
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="text-sm text-gray-400 mb-3">אין עדיין.</div>
      )}
      <form onSubmit={add} className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          dir={ltr ? 'ltr' : 'rtl'}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-64"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="bg-gray-800 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50"
        >
          הוסף
        </button>
      </form>
    </section>
  );
}

function ChannelRow({ item, ltr, formatValue, onSetPrimary, onEditValue, onRemove, act, handle }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.value);
  const [busy, setBusy] = useState(false);

  async function saveEdit() {
    const v = draft.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      await act(() => onEditValue(item.id, v));
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="py-2 flex items-center gap-2 text-sm">
      {handle}
      {editing ? (
        <>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            dir={ltr ? 'ltr' : 'rtl'}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
              else if (e.key === 'Escape') { setEditing(false); setDraft(item.value); }
            }}
            className="flex-1 min-w-0 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          <button onClick={saveEdit} disabled={busy || !draft.trim()} className="text-[12px] text-blue-700 shrink-0 disabled:opacity-50">שמור</button>
          <button onClick={() => { setEditing(false); setDraft(item.value); }} className="text-[12px] text-gray-500 shrink-0">ביטול</button>
        </>
      ) : (
        <>
          <span dir={ltr ? 'ltr' : 'rtl'}>{formatValue(item.value)}</span>
          {item.isPrimary ? (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
              ראשי
            </span>
          ) : (
            <button
              onClick={() => act(() => onSetPrimary(item.id))}
              className="text-[11px] text-gray-500 hover:text-gray-800 underline"
            >
              הפוך לראשי
            </button>
          )}
          <div className="flex-1" />
          {onEditValue && (
            <button
              onClick={() => { setDraft(item.value); setEditing(true); }}
              className="text-[12px] text-blue-700 hover:bg-blue-50 rounded px-2 py-1"
            >
              ערוך
            </button>
          )}
          <button
            onClick={() => act(() => onRemove(item.id))}
            className="text-[12px] text-red-600 hover:bg-red-50 rounded px-2 py-1"
          >
            מחק
          </button>
        </>
      )}
    </div>
  );
}
