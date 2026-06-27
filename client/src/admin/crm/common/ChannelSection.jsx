import { useState } from 'react';

// Shared multi-value channel editor (phones / emails). One source of truth for
// the contact "channels" UI — used by the full Contact page AND the Deal-header
// contact dialog. Each item supports set-primary + remove; new values are added
// via the inline form. Ordering is stored (sortOrder) but a drag-reorder UI is
// not exposed here yet — items render primary-first, then by sortOrder.
//
// Props mirror the original ContactDetail implementation so callers are
// unchanged: onAdd(value) / onSetPrimary(id) / onRemove(id) each return a
// promise; onChange() refreshes the parent after any successful mutation.
export default function ChannelSection({
  title,
  items,
  placeholder,
  ltr,
  onAdd,
  onSetPrimary,
  onRemove,
  onChange,
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

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <h2 className="text-[14px] font-semibold text-gray-900 mb-3">{title}</h2>
      {items?.length ? (
        <ul className="divide-y divide-gray-100 mb-3">
          {items.map((it) => (
            <li key={it.id} className="py-2 flex items-center gap-2 text-sm">
              <span dir={ltr ? 'ltr' : 'rtl'}>{it.value}</span>
              {it.isPrimary ? (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                  ראשי
                </span>
              ) : (
                <button
                  onClick={() => act(() => onSetPrimary(it.id))}
                  className="text-[11px] text-gray-500 hover:text-gray-800 underline"
                >
                  הפוך לראשי
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={() => act(() => onRemove(it.id))}
                className="text-[12px] text-red-600 hover:bg-red-50 rounded px-2 py-1"
              >
                מחק
              </button>
            </li>
          ))}
        </ul>
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
