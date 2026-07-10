import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import ReorderableList from '../common/ReorderableList.jsx';
import { componentToneStyle } from './config.js';

// Tour modal → "מרכיבי הפעילות". The tour's DELIVERED components: add / remove /
// reorder, and — for WORKSHOP components only — pick a Workshop Location (a tour
// can hold several workshop components, each in a different place). Non-workshop
// components never show a location control. Reads rows from the tour payload and
// calls onChanged() after each write so the modal reflects server truth; reorder
// is optimistic (ReorderableList) then persisted.
const LOC_SELECT =
  'h-7 rounded-md border px-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-200';

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
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center text-[13px] text-gray-400">
          עדיין לא הוגדרו מרכיבים לסיור.
        </p>
      ) : (
        <ReorderableList
          items={rows}
          onReorder={reorder}
          renderRow={(row, { handle }) => {
            const c = row.activityComponent;
            const isWorkshop = c?.isWorkshop;
            const missingLoc = isWorkshop && !row.workshopLocationId;
            // Include a deactivated-but-selected location so it still displays.
            const locOptions = [...locations];
            if (
              row.workshopLocation &&
              !locations.some((l) => l.id === row.workshopLocation.id)
            ) {
              locOptions.push(row.workshopLocation);
            }
            return (
              <div className="group flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-gray-50">
                {handle}
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold ${componentToneStyle(
                    c?.color,
                  )}`}
                >
                  {c?.icon && <span aria-hidden>{c.icon}</span>}
                  {c?.nameHe || '—'}
                </span>

                {isWorkshop && (
                  <select
                    value={row.workshopLocationId || ''}
                    disabled={busy}
                    onChange={(e) => setLocation(row.id, e.target.value)}
                    className={`${LOC_SELECT} ${
                      missingLoc
                        ? 'border-red-300 bg-red-50 text-red-700'
                        : 'border-gray-300 bg-white text-gray-700'
                    }`}
                    title="מיקום סדנה"
                  >
                    <option value="">📍 חסר מיקום סדנה</option>
                    {locOptions.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nameHe}
                      </option>
                    ))}
                  </select>
                )}

                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => remove(row.id)}
                  disabled={busy}
                  title="הסרת המרכיב"
                  className="shrink-0 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md px-2 py-1 text-[13px] disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            );
          }}
        />
      )}

      {/* Add control */}
      <div className="mt-2">
        {adding ? (
          <select
            autoFocus
            defaultValue=""
            disabled={busy}
            onChange={(e) => add(e.target.value)}
            onBlur={() => setAdding(false)}
            className="h-8 w-full rounded-lg border border-gray-300 bg-white px-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            <option value="" disabled>
              בחרו מרכיב להוספה…
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
            className="rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-600 hover:border-blue-400 hover:text-blue-600 disabled:opacity-50"
          >
            {available.length === 0 ? 'כל המרכיבים הפעילים כבר בסיור' : '+ הוספת מרכיב'}
          </button>
        )}
      </div>
    </div>
  );
}
