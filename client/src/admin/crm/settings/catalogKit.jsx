import { useEffect, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDirtyWhen } from '../../../lib/dirtyForms.js';

// Shared building blocks for the CRM catalog settings screens (Organization
// Types & Subtypes, Deal Stages). Each row supports inline EDIT of the business
// fields. The Hebrew name is the only required field; the English label is
// OPTIONAL. The internal `key`/slug is never shown or sent, so it stays stable
// across renames.

export function SettingsCard({ title, description, children, footer }) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-gray-100">
        <h2 className="text-[17px] font-semibold text-gray-900">{title}</h2>
        {description && (
          <p className="text-[13px] text-gray-500 mt-1 leading-relaxed max-w-2xl">
            {description}
          </p>
        )}
      </div>
      <div className="p-2 sm:p-3">{children}</div>
      {footer && (
        <div className="px-4 sm:px-5 py-4 border-t border-gray-100 bg-gray-50/60">
          {footer}
        </div>
      )}
    </section>
  );
}

export function SortableList({
  items,
  onReorder,
  onSave,
  onRemove,
  renderMeta,
  editExtra,
  emptyText,
  // Optional, additive: a consumer can seed extra draft fields (editSeed),
  // render a full-width panel inside the edit form (editPanel), and contribute
  // extra keys to the saved patch (editToPatch). When omitted (e.g. Deal
  // Stages) the edit form is byte-for-byte unchanged.
  editSeed,
  editPanel,
  editToPatch,
  // Optional, additive: render extra action button(s) for a row, shown before
  // the edit/delete actions. Omitted everywhere except Organization Types.
  rowActions,
}) {
  const [local, setLocal] = useState(items);
  useEffect(() => setLocal(items), [items]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );

  function onDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = local.map((i) => i.id);
    const from = ids.indexOf(active.id);
    const to = ids.indexOf(over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    setLocal(next.map((id) => local.find((i) => i.id === id)));
    onReorder(next);
  }

  if (!local.length) {
    return (
      <div className="px-3 py-12 text-center text-sm text-gray-400">{emptyText}</div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={local.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-0.5">
          {local.map((item) => (
            <CatalogRow
              key={item.id}
              item={item}
              meta={renderMeta(item)}
              onSave={onSave}
              onRemove={onRemove}
              editExtra={editExtra}
              editSeed={editSeed}
              editPanel={editPanel}
              editToPatch={editToPatch}
              rowActions={rowActions}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function CatalogRow({ item, meta, onSave, onRemove, editExtra, editSeed, editPanel, editToPatch, rowActions }) {
  const s = useSortable({ id: item.id });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const style = {
    transform: CSS.Transform.toString(s.transform),
    transition: s.transition,
  };

  // Unsaved-work guard (auto-update): while a row is being edited, dirty when the
  // draft diverges from the row's stored values (same shape startEdit seeds from);
  // clears on revert, save, or cancel. Covers every CRM settings catalog.
  const baseline = editing
    ? {
        label: item.label || '',
        labelEn: item.labelEn || '',
        organizationTypeId: item.organizationTypeId || '',
        ...(editSeed ? editSeed(item) : {}),
      }
    : null;
  useDirtyWhen(draft, baseline, { active: editing && !!draft });

  function startEdit() {
    setDraft({
      label: item.label || '',
      labelEn: item.labelEn || '',
      organizationTypeId: item.organizationTypeId || '',
      ...(editSeed ? editSeed(item) : {}),
    });
    setEditing(true);
  }

  async function submit(e) {
    e?.preventDefault();
    if (!draft.label.trim()) return; // Hebrew name required; English optional.
    setBusy(true);
    try {
      const patch = {
        label: draft.label.trim(),
        labelEn: draft.labelEn.trim() || null,
      };
      // Only subtypes expose the extra control (the linked type). `key` is never
      // sent, so it stays stable on rename.
      if (editExtra) patch.organizationTypeId = draft.organizationTypeId || null;
      if (editToPatch) Object.assign(patch, editToPatch(draft));
      await onSave(item, patch);
      setEditing(false);
    } catch (err) {
      alert('שגיאה בשמירה: ' + (err.payload?.error || err.message));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <li ref={s.setNodeRef} style={style}>
        <form
          onSubmit={submit}
          className="rounded-lg bg-blue-50/50 ring-1 ring-blue-100 px-2.5 py-2.5 flex flex-wrap items-center gap-2"
        >
          <input
            autoFocus
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
            placeholder="שם"
            className="flex-1 min-w-[9rem] h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
          <input
            value={draft.labelEn}
            onChange={(e) => setDraft((d) => ({ ...d, labelEn: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
            placeholder="Label (EN) — אופציונלי"
            dir="ltr"
            className="flex-1 min-w-[7rem] sm:max-w-[12rem] h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
          {editExtra && editExtra(draft, setDraft)}
          {editPanel && (
            <div className="basis-full w-full">{editPanel(draft, setDraft)}</div>
          )}
          <div className="flex gap-1.5 shrink-0 ms-auto">
            <button
              type="submit"
              disabled={busy || !draft.label.trim()}
              className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'שומר…' : 'שמור'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50"
            >
              ביטול
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li ref={s.setNodeRef} style={style} className={s.isDragging ? 'relative z-10' : ''}>
      <div
        className={`group flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors ${
          s.isDragging ? 'bg-white shadow-md ring-1 ring-gray-200' : 'hover:bg-gray-50'
        }`}
      >
        <button
          {...s.attributes}
          {...s.listeners}
          aria-label="גרור לשינוי סדר"
          className="shrink-0 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing p-1 -m-1"
          style={{ touchAction: 'none' }}
        >
          <DragIcon />
        </button>
        <div className="flex-1 min-w-0 flex items-baseline gap-2.5">
          <span className="font-medium text-gray-900 text-[15px] truncate">{item.label}</span>
          {item.labelEn && (
            <span className="text-[12px] text-gray-400 truncate" dir="ltr">{item.labelEn}</span>
          )}
        </div>
        {meta}
        <div className="flex items-center gap-1 shrink-0">
          {rowActions && rowActions(item)}
          <button
            onClick={startEdit}
            aria-label="עריכה"
            title="עריכה"
            className="text-amber-500 hover:text-amber-600 hover:bg-amber-50 rounded-md p-1.5 transition"
          >
            <EditIcon />
          </button>
          <button
            onClick={() => onRemove(item)}
            aria-label="מחק"
            title="מחק"
            className="text-red-500 hover:text-red-600 hover:bg-red-50 rounded-md p-1.5 transition"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </li>
  );
}

export function TextInput({ value, onChange, placeholder, ltr, className = '' }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      dir={ltr ? 'ltr' : 'rtl'}
      className={`h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 ${className}`}
    />
  );
}

export function PrimaryButton({ children, disabled }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="h-10 shrink-0 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600"
    >
      {children}
    </button>
  );
}

export function CountChip({ n, noun }) {
  return (
    <span className="shrink-0 inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600">
      {n} {noun}
    </span>
  );
}

export function Pill({ children }) {
  return (
    <span className="shrink-0 inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-100">
      {children}
    </span>
  );
}

function DragIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="5.5" cy="3.5" r="1.3" />
      <circle cx="10.5" cy="3.5" r="1.3" />
      <circle cx="5.5" cy="8" r="1.3" />
      <circle cx="10.5" cy="8" r="1.3" />
      <circle cx="5.5" cy="12.5" r="1.3" />
      <circle cx="10.5" cy="12.5" r="1.3" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 6.5l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
