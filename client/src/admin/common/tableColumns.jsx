import { useEffect, useMemo, useRef, useState } from 'react';
import AnchoredMenu from './AnchoredMenu.jsx';

// Reusable table-column visibility infrastructure, shared by list screens
// (Deals, Contacts, …). A `column` is { key, label, def?, disabled?, … } — list
// screens keep their own render functions; this only owns which columns show and
// the picker UI. Selection persists per `storageKey` in localStorage.

function loadColumns(storageKey, columnKeys, defaults) {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(raw)) {
      const valid = raw.filter((k) => columnKeys.has(k)); // drop unknown keys
      if (valid.length) return valid;
    }
  } catch {
    /* fall through to defaults */
  }
  return defaults;
}
function saveColumns(storageKey, keys) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(keys));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function useTableColumns(storageKey, columns) {
  const columnKeys = useMemo(() => new Set(columns.map((c) => c.key)), [columns]);
  const defaults = useMemo(() => columns.filter((c) => c.def).map((c) => c.key), [columns]);
  const [colKeys, setColKeys] = useState(() => loadColumns(storageKey, columnKeys, defaults));
  useEffect(() => {
    saveColumns(storageKey, colKeys);
  }, [storageKey, colKeys]);
  // Render in canonical column order regardless of toggle order.
  const visibleCols = useMemo(
    () => columns.filter((c) => colKeys.includes(c.key)),
    [columns, colKeys],
  );
  function toggleCol(key) {
    setColKeys((keys) => {
      const has = keys.includes(key);
      if (has && keys.length === 1) return keys; // never allow zero columns
      return has ? keys.filter((k) => k !== key) : [...keys, key];
    });
  }
  return { colKeys, toggleCol, visibleCols };
}

// "עמודות" picker — toggles which columns the table shows. Portal-anchored menu
// so a long list is never clipped.
export function ColumnPicker({ columns, colKeys, onToggle, label = 'עמודות' }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span aria-hidden>⚙️</span>
        {label}
      </button>
      <AnchoredMenu anchorRef={btnRef} open={open} onClose={() => setOpen(false)} width={236} align="end">
        <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-400">בחירת עמודות</div>
        <div className="max-h-[60vh] overflow-y-auto py-0.5">
          {columns.map((c) => {
            const checked = colKeys.includes(c.key);
            return (
              <label
                key={c.key}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm ${
                  c.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={c.disabled}
                  onChange={() => onToggle(c.key)}
                  className="accent-blue-600"
                />
                <span className="text-gray-700">{c.label}</span>
                {c.disabled && <span className="text-[10px] text-gray-400">(בקרוב)</span>}
              </label>
            );
          })}
        </div>
      </AnchoredMenu>
    </div>
  );
}
