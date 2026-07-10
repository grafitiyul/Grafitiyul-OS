import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import ReorderableList from '../common/ReorderableList.jsx';
import { componentToneStyle } from '../tours/config.js';

// Product editing → default Activity Components. Declares the ORDERED set of
// components a Product is composed of by default; these are copied onto a
// TourEvent at creation (Slice C) — this is defaults only, never a live link.
// Each change persists immediately (replace-all, ordered) and reflects the
// server's sanitized result. Reuses ReorderableList + the shared tone chips so a
// component looks identical here, in the tour modal, and in the deal popover.
export default function ProductDefaultComponents({ productId, initial }) {
  // Local ordered selection = [{ componentId, component }]. Seeded from the
  // product payload; kept in sync with the server's response on every write.
  const [selected, setSelected] = useState(() => fromLinks(initial));
  const [catalog, setCatalog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.activityComponents
      .list(true)
      .then(setCatalog)
      .catch(() => {});
  }, []);

  const selectedIds = useMemo(() => selected.map((s) => s.componentId), [selected]);
  const available = catalog.filter((c) => !selectedIds.includes(c.id));

  async function persist(ids) {
    setBusy(true);
    try {
      const links = await api.products.setActivityComponents(productId, ids);
      setSelected(fromLinks(links));
    } catch (e) {
      alert('שגיאה בשמירת מרכיבי הפעילות: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  const add = (id) => {
    setAdding(false);
    persist([...selectedIds, id]);
  };
  const remove = (id) => persist(selectedIds.filter((x) => x !== id));
  const reorder = (ids) => persist(ids);

  return (
    <div>
      {selected.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-[13px] text-gray-400">
          אין מרכיבי ברירת מחדל. הוסיפו מרכיבים שיוזרעו לכל סיור של המוצר הזה.
        </div>
      ) : (
        <ReorderableList
          items={selected.map((s) => ({ id: s.componentId, ...s }))}
          onReorder={reorder}
          renderRow={(item, { handle }) => (
            <div className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-gray-50">
              {handle}
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold ${componentToneStyle(
                  item.component?.color,
                )}`}
              >
                {item.component?.icon && <span aria-hidden>{item.component.icon}</span>}
                {item.component?.nameHe || '—'}
              </span>
              {item.component?.isWorkshop && (
                <span className="text-[11px] rounded-full bg-indigo-50 text-indigo-600 px-2 py-0.5">
                  סדנה
                </span>
              )}
              {!item.component?.isActive && (
                <span className="text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">
                  לא פעיל
                </span>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => remove(item.componentId)}
                disabled={busy}
                title="הסרה"
                className="shrink-0 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md px-2 py-1 text-[13px] disabled:opacity-40"
              >
                ✕
              </button>
            </div>
          )}
        />
      )}

      {/* Add control */}
      <div className="mt-2">
        {adding ? (
          <select
            autoFocus
            defaultValue=""
            disabled={busy}
            onChange={(e) => e.target.value && add(e.target.value)}
            onBlur={() => setAdding(false)}
            className="h-9 w-full rounded-lg border border-gray-300 bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
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
            {available.length === 0 ? 'כל המרכיבים הפעילים נבחרו' : '+ הוספת מרכיב'}
          </button>
        )}
      </div>
    </div>
  );
}

function fromLinks(links) {
  return (links || []).map((l) => ({ componentId: l.activityComponentId, component: l.activityComponent }));
}
