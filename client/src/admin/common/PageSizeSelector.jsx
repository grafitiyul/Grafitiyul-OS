import { useCallback, useState } from 'react';
import {
  PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  loadPageSize,
  savePageSize,
} from './pageSizePref.js';

// Shared "rows per page" control for the CRM list screens. The server accepts
// exactly 20/50/100/200 (default 50); the selector never offers anything else,
// and the pure helpers in pageSizePref.js clamp any stored value to that set.

// usePageSizePref(storageKey, default) — state + localStorage persistence for
// the chosen page size, mirroring the localStorage patterns used elsewhere
// (Deals filters, tours viewPrefs). The initial value is read once from
// storage (clamped); setting it persists synchronously.
export function usePageSizePref(storageKey, initialDefault = DEFAULT_PAGE_SIZE) {
  const store = typeof window !== 'undefined' ? window.localStorage : null;
  const [pageSize, setPageSizeState] = useState(() =>
    loadPageSize(store, storageKey, initialDefault),
  );
  const setPageSize = useCallback(
    (value) => {
      const stored = savePageSize(store, storageKey, value);
      setPageSizeState(stored);
    },
    [store, storageKey],
  );
  return [pageSize, setPageSize];
}

export default function PageSizeSelector({ value, onChange, className = '' }) {
  return (
    <label className={`flex items-center gap-1.5 text-[13px] text-gray-500 ${className}`}>
      <span>שורות בעמוד</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
      >
        {PAGE_SIZES.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
    </label>
  );
}
