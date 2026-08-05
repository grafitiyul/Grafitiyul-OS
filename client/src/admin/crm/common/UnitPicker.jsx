import { useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import AnchoredMenu from '../../common/AnchoredMenu.jsx';

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

// Shared organization-unit picker — the same combobox philosophy as OrgPicker:
// ONE free-typed field, live filtering over the selected organization's units,
// and a "+ צור יחידה חדשה" last row that creates the unit through the ONE
// canonical unit API (POST /api/organizations/:id/units) and selects it in
// place. Almost every organization has no units yet, so the picker renders
// (and creates) even when the list is empty — never a locked dropdown.
//
// LEAVING the field COMMITS the typed value (modern-combobox behavior): an
// exact (case-insensitive) match selects the existing unit; anything else
// creates it — the same single create path as the explicit row, guarded so a
// blur can never create twice or create a duplicate of an existing name.
// Escape explicitly cancels the typed value (no commit).
//
// The suggestion list is portaled through AnchoredMenu because this picker
// lives inside Dialogs whose scrolling content clips in-flow absolute panels.
// A foreign unit is impossible by construction (options come from the selected
// org) and rejected server-side regardless (unit_not_in_organization).
export default function UnitPicker({
  orgId,
  units = [],
  value = '',
  onChange,
  // Fired with the freshly created unit so the owner can refresh its org copy.
  onCreated,
  allowCreate = true,
  label = 'יחידה (אופציונלי)',
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const fieldRef = useRef(null);

  const selected = units.find((u) => u.id === value) || null;
  const typed = query.trim();
  const q = typed.toLowerCase();
  const filtered = q ? units.filter((u) => (u.name || '').toLowerCase().includes(q)) : units;
  const exactMatch = typed
    ? units.find((u) => (u.name || '').trim().toLowerCase() === q)
    : null;
  const showCreateRow = allowCreate && !!typed && !exactMatch;
  const rowCount = filtered.length + (showCreateRow ? 1 : 0);
  const listOpen = open && (rowCount > 0 || !!typed || units.length === 0);

  function choose(u) {
    onChange?.(u ? u.id : '');
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  }

  async function createUnit() {
    if (!typed || creating || !orgId) return;
    setCreating(true);
    setError(null);
    try {
      const unit = await api.organizations.addUnit(orgId, { name: typed });
      onCreated?.(unit);
      choose(unit);
    } catch (e) {
      setError(e.payload?.error || e.message);
    } finally {
      setCreating(false);
    }
  }

  // Leaving the field = committing it. Runs from the blur timeout, so it works
  // off the values captured at blur time (choose/createUnit both clear the
  // query themselves; a failed create keeps it so the error reads in context).
  function commitTyped() {
    if (!typed || creating) return;
    if (exactMatch) {
      choose(exactMatch);
      return;
    }
    if (allowCreate && orgId) createUnit();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      // Explicit cancel — the typed value is discarded, never committed.
      setQuery('');
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!listOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % Math.max(1, rowCount));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? rowCount - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < filtered.length) choose(filtered[activeIndex]);
      else if (activeIndex >= 0 && showCreateRow) createUnit();
      // Enter with no highlighted row commits the typed value directly.
      else commitTyped();
    }
  }

  return (
    <div ref={fieldRef}>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-gray-500">{label}</span>
        <span className="relative block">
          <input
            value={open ? query : selected?.name || ''}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(-1); }}
            onFocus={() => { setOpen(true); setQuery(''); setActiveIndex(-1); }}
            onBlur={() => setTimeout(() => { setOpen(false); commitTyped(); }, 120)}
            onKeyDown={onKeyDown}
            placeholder={selected ? selected.name : 'חיפוש או יצירת יחידה…'}
            autoComplete="off"
            className={INPUT + (selected ? ' pe-8' : '')}
          />
          {selected && !open && (
            <button
              type="button"
              onClick={() => choose(null)}
              title="נקה יחידה"
              className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              ✕
            </button>
          )}
        </span>
      </label>
      <AnchoredMenu
        anchorRef={fieldRef}
        open={listOpen}
        onClose={() => setOpen(false)}
        matchAnchorWidth
        align="start"
        overlay={false}
        panelClassName="rounded-lg"
      >
        <ul className="max-h-44 overflow-y-auto">
          {filtered.map((u, i) => (
            <li key={u.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(u)}
                className={`block w-full text-right px-3 py-2 text-sm ${
                  i === activeIndex ? 'bg-blue-50' : 'hover:bg-blue-50'
                } ${u.id === value ? 'font-medium' : ''}`}
              >
                {u.name}
              </button>
            </li>
          ))}
          {filtered.length === 0 && !showCreateRow && (
            <li className="px-3 py-2 text-[12px] text-gray-400">
              {units.length === 0 ? 'לארגון אין יחידות עדיין — הקלידו שם ליצירה.' : 'לא נמצאו יחידות תואמות.'}
            </li>
          )}
          {showCreateRow && (
            <li className={filtered.length ? 'border-t border-gray-100' : ''}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={createUnit}
                disabled={creating}
                className={`block w-full text-right px-3 py-2 text-sm font-medium text-blue-700 disabled:opacity-50 ${
                  activeIndex === filtered.length ? 'bg-blue-50' : 'hover:bg-blue-50'
                }`}
              >
                {creating ? 'יוצר…' : `+ צור יחידה חדשה — "${typed}"`}
              </button>
            </li>
          )}
        </ul>
      </AnchoredMenu>
      {error && (
        <p className="mt-1 text-[12px] text-red-600">
          שגיאה ביצירת יחידה: <span dir="ltr" className="font-mono">{error}</span>
        </p>
      )}
    </div>
  );
}
