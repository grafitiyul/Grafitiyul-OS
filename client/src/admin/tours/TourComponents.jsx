import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import ReorderableList from '../common/ReorderableList.jsx';

// Tour modal → "מרכיבי הפעילות". The tour's DELIVERED components as a HORIZONTAL
// row of NEUTRAL chips — the icon carries the identity, not a background color
// (strong role colors belong to the Team section). Each chip carries its own ✕;
// the whole chip drags to reorder. Workshop locations live in a separate block
// BELOW the chips — one selector per workshop component, rendered only when at
// least one workshop component exists. A location is OPTIONAL: the empty state
// is a plain placeholder, never a warning.
export default function TourComponents({ tourId, rows = [], onChanged }) {
  const [catalog, setCatalog] = useState([]); // active components (for add)
  const [locations, setLocations] = useState([]); // active workshop locations
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.activityComponents.list(true).then(setCatalog).catch(() => {});
    api.workshopLocations.list(true).then(setLocations).catch(() => {});
  }, []);

  const presentIds = new Set(rows.map((r) => r.activityComponentId));
  const available = catalog.filter((c) => !presentIds.has(c.id));
  const workshopRows = rows.filter((r) => r.activityComponent?.isWorkshop);

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
      await onChanged?.();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  const add = (componentId) => {
    setAdding(false);
    if (componentId) run(() => api.tours.addComponent(tourId, { activityComponentId: componentId }));
  };
  const remove = (rowId) => run(() => api.tours.removeComponent(rowId));
  const setLocation = (rowId, locId) =>
    run(() => api.tours.setComponentLocation(rowId, locId || null));

  async function reorder(ids) {
    try {
      await api.tours.reorderComponents(tourId, ids);
      await onChanged?.();
    } catch (e) {
      alert('שגיאה בשינוי הסדר: ' + (e.payload?.error || e.message));
      onChanged?.();
    }
  }

  return (
    <div>
      {/* Component chips + add — one horizontal, wrapping row. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <ReorderableList
          horizontal
          items={rows}
          onReorder={reorder}
          renderRow={(row) => {
            const c = row.activityComponent;
            return (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white py-1 ps-2.5 pe-1 text-[12.5px] font-medium text-gray-700 shadow-sm">
                {c?.icon && <span aria-hidden>{c.icon}</span>}
                {c?.nameHe || '—'}
                <button
                  type="button"
                  onClick={() => remove(row.id)}
                  disabled={busy}
                  title="הסרת המרכיב"
                  className="flex h-4 w-4 items-center justify-center rounded-full text-gray-300 hover:bg-gray-100 hover:text-red-600 disabled:opacity-40"
                >
                  ✕
                </button>
              </span>
            );
          }}
        />

        {adding ? (
          <select
            autoFocus
            defaultValue=""
            disabled={busy}
            onChange={(e) => add(e.target.value)}
            onBlur={() => setAdding(false)}
            className="h-7 rounded-full border border-gray-300 bg-white px-2 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            <option value="" disabled>
              בחרו מרכיב…
            </option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon ? `${c.icon} ` : ''}
                {c.nameHe}
                {c.isWorkshop ? ' · סדנה' : ''}
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={busy || available.length === 0}
            title={available.length === 0 ? 'כל המרכיבים הפעילים כבר בסיור' : 'הוספת מרכיב'}
            className="inline-flex items-center rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-[12.5px] font-medium text-gray-500 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40"
          >
            + מרכיב
          </button>
        )}

        {rows.length === 0 && (
          <span className="text-[12.5px] text-gray-400">עדיין לא הוגדרו מרכיבים לסיור.</span>
        )}
      </div>

      {/* Workshop locations — ONLY when a workshop component exists. One
          selector per workshop component; empty = plain placeholder (optional). */}
      {workshopRows.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-2.5">
          <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-gray-400">
            מיקומי סדנה
          </h3>
          <div className="grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
            {workshopRows.map((row) => {
              const c = row.activityComponent;
              // Include a deactivated-but-selected location so it still displays.
              const locOptions = [...locations];
              if (row.workshopLocation && !locations.some((l) => l.id === row.workshopLocation.id)) {
                locOptions.push(row.workshopLocation);
              }
              return (
                <label key={row.id} className="flex items-center gap-2 text-[12.5px]">
                  <span className="shrink-0 whitespace-nowrap text-gray-600">
                    {c?.icon && <span aria-hidden>{c.icon} </span>}
                    {c?.nameHe || '—'}
                  </span>
                  <select
                    value={row.workshopLocationId || ''}
                    disabled={busy}
                    onChange={(e) => setLocation(row.id, e.target.value)}
                    className="h-7 min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 text-[12px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    title="מיקום סדנה"
                  >
                    <option value="">בחירת מיקום סדנה…</option>
                    {locOptions.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nameHe}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
