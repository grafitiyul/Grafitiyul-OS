import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { api } from '../../../lib/api.js';

// CRM settings — Organization Types and Organization Subtypes catalogs.
//
// Types belong to the Organization and will drive pricing / quote wording /
// payment terms / templates, so their DISPLAY ORDER is explicit and editable
// (drag to reorder; persisted as sortOrder). Subtypes belong to the future
// Deal (e.g. School → Teachers / Students) and are prepared here as a catalog.
//
// Rows support inline EDIT of the business fields (Hebrew label, English label,
// and — for subtypes — the linked type). The internal `key` slug is NEVER
// shown or edited and stays stable across renames, so existing references hold.

export default function CrmSettingsPage() {
  const [types, setTypes] = useState([]);
  const [subtypes, setSubtypes] = useState([]);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [t, s, st] = await Promise.all([
        api.organizationTypes.list(),
        api.organizationSubtypes.list(),
        api.dealStages.list(),
      ]);
      setTypes(t);
      setSubtypes(s);
      setStages(st);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <Link
          to="/admin/settings/crm"
          className="text-[13px] text-blue-700 hover:underline"
        >
          ← הגדרות CRM
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">
          סוגי ארגון, תת-סוגים ושלבי דיל
        </h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          הקטלוגים שמזינים את תהליך העבודה. סוגי הארגון יקבעו בהמשך תמחור, נוסח
          הצעות מחיר ותבניות — לכן הסדר שלהם משמעותי.
        </p>
      </header>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">טוען…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          שגיאה בטעינה:{' '}
          <span dir="ltr" className="font-mono">
            {error}
          </span>
        </div>
      ) : (
        <div className="space-y-8">
          <TypesSection types={types} onChange={refresh} />
          <SubtypesSection subtypes={subtypes} types={types} onChange={refresh} />
          <DealStagesSection stages={stages} onChange={refresh} />
        </div>
      )}
    </div>
  );
}

// ── Sections ────────────────────────────────────────────────────────

function TypesSection({ types, onChange }) {
  async function reorder(ids) {
    try {
      await api.organizationTypes.reorder(ids);
    } catch (e) {
      alert('שגיאה בעדכון הסדר: ' + e.message);
    } finally {
      onChange();
    }
  }
  async function save(item, patch) {
    await api.organizationTypes.update(item.id, patch);
    await onChange();
  }
  async function remove(item) {
    if (!confirm(`למחוק את "${item.label}"? ארגונים מקושרים יישארו ללא סוג.`))
      return;
    try {
      await api.organizationTypes.remove(item.id);
      await onChange();
    } catch (e) {
      alert('שגיאה במחיקה: ' + e.message);
    }
  }

  return (
    <SettingsCard
      title="סוגי ארגון"
      description="לדוגמה: בתי ספר, חברות, רשויות מקומיות. ישפיע בהמשך על תמחור, נוסח הצעות מחיר ותבניות."
      footer={<AddTypeForm onChange={onChange} />}
    >
      <SortableList
        items={types}
        onReorder={reorder}
        onSave={save}
        onRemove={remove}
        emptyText="עדיין אין סוגי ארגון. הוסיפו את הראשון למטה."
        renderMeta={(t) => (
          <CountChip n={t._count?.organizations ?? 0} noun="ארגונים" />
        )}
      />
    </SettingsCard>
  );
}

function SubtypesSection({ subtypes, types, onChange }) {
  async function reorder(ids) {
    try {
      await api.organizationSubtypes.reorder(ids);
    } catch (e) {
      alert('שגיאה בעדכון הסדר: ' + e.message);
    } finally {
      onChange();
    }
  }
  async function save(item, patch) {
    await api.organizationSubtypes.update(item.id, patch);
    await onChange();
  }
  async function remove(item) {
    if (!confirm(`למחוק את תת-הסוג "${item.label}"?`)) return;
    try {
      await api.organizationSubtypes.remove(item.id);
      await onChange();
    } catch (e) {
      alert('שגיאה במחיקה: ' + e.message);
    }
  }

  return (
    <SettingsCard
      title="תת-סוגים"
      description="תת-סוג שייך לדיל, לא לארגון (לדוגמה: בית ספר → מורים / תלמידים). מוכן כקטלוג — ייכנס לשימוש כשייבנה מודול הדילים."
      footer={<AddSubtypeForm types={types} onChange={onChange} />}
    >
      <SortableList
        items={subtypes}
        onReorder={reorder}
        onSave={save}
        onRemove={remove}
        emptyText="עדיין אין תת-סוגים."
        renderMeta={(s) =>
          s.organizationType ? (
            <Pill>{s.organizationType.label}</Pill>
          ) : (
            <span className="shrink-0 text-[12px] text-gray-400">כללי</span>
          )
        }
        // Subtype-specific edit control: reassign the linked organization type.
        editExtra={(draft, setDraft) => (
          <select
            value={draft.organizationTypeId || ''}
            onChange={(e) =>
              setDraft((d) => ({ ...d, organizationTypeId: e.target.value }))
            }
            className="h-10 flex-1 min-w-[7rem] sm:max-w-[12rem] rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          >
            <option value="">כללי</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        )}
      />
    </SettingsCard>
  );
}

function DealStagesSection({ stages, onChange }) {
  async function reorder(ids) {
    try {
      await api.dealStages.reorder(ids);
    } catch (e) {
      alert('שגיאה בעדכון הסדר: ' + e.message);
    } finally {
      onChange();
    }
  }
  async function save(item, patch) {
    await api.dealStages.update(item.id, patch);
    await onChange();
  }
  async function remove(item) {
    if (!confirm(`למחוק את השלב "${item.label}"?`)) return;
    try {
      await api.dealStages.remove(item.id);
      await onChange();
    } catch (e) {
      if (e.payload?.error === 'stage_in_use') {
        alert('לא ניתן למחוק שלב שמשויכות אליו דילים. העבירו אותן לשלב אחר תחילה.');
      } else {
        alert('שגיאה במחיקה: ' + e.message);
      }
    }
  }

  return (
    <SettingsCard
      title="שלבי דיל"
      description="צינור המכירות (Pipeline). הסדר קובע את התקדמות הדיל. נסגר / אבוד הוא סטטוס של הדיל — נפרד מהשלב."
      footer={<AddStageForm onChange={onChange} />}
    >
      <SortableList
        items={stages}
        onReorder={reorder}
        onSave={save}
        onRemove={remove}
        emptyText="טוען שלבי ברירת מחדל…"
        renderMeta={(s) => <CountChip n={s._count?.deals ?? 0} noun="דילים" />}
      />
    </SettingsCard>
  );
}

function AddStageForm({ onChange }) {
  const [label, setLabel] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.dealStages.create({
        label: label.trim(),
        labelEn: labelEn.trim() || null,
      });
      setLabel('');
      setLabelEn('');
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
      <TextInput value={label} onChange={setLabel} placeholder="שם שלב" className="flex-1" />
      <TextInput value={labelEn} onChange={setLabelEn} placeholder="Label (EN) — אופציונלי" ltr className="sm:w-52" />
      <PrimaryButton disabled={busy || !label.trim()}>
        {busy ? 'מוסיף…' : 'הוסף שלב'}
      </PrimaryButton>
    </form>
  );
}

// ── Reusable card + sortable list ───────────────────────────────────

function SettingsCard({ title, description, children, footer }) {
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

function SortableList({
  items,
  onReorder,
  onSave,
  onRemove,
  renderMeta,
  editExtra,
  emptyText,
}) {
  // Optimistic copy so reorder feels instant; resync when props change.
  const [local, setLocal] = useState(items);
  useEffect(() => setLocal(items), [items]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
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
      <div className="px-3 py-12 text-center text-sm text-gray-400">
        {emptyText}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={local.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="space-y-0.5">
          {local.map((item) => (
            <CatalogRow
              key={item.id}
              item={item}
              meta={renderMeta(item)}
              onSave={onSave}
              onRemove={onRemove}
              editExtra={editExtra}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function CatalogRow({ item, meta, onSave, onRemove, editExtra }) {
  const s = useSortable({ id: item.id });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const style = {
    transform: CSS.Transform.toString(s.transform),
    transition: s.transition,
  };

  function startEdit() {
    setDraft({
      label: item.label || '',
      labelEn: item.labelEn || '',
      organizationTypeId: item.organizationTypeId || '',
    });
    setEditing(true);
  }

  async function submit(e) {
    e?.preventDefault();
    if (!draft.label.trim()) return;
    setBusy(true);
    try {
      const patch = {
        label: draft.label.trim(),
        labelEn: draft.labelEn.trim() || null,
      };
      // Only sections that expose the extra control (subtypes) edit the link.
      // The internal `key` is never sent, so it stays stable on rename.
      if (editExtra) patch.organizationTypeId = draft.organizationTypeId || null;
      await onSave(item, patch);
      setEditing(false);
    } catch (err) {
      alert('שגיאה בשמירה: ' + (err.payload?.error || err.message));
    } finally {
      setBusy(false);
    }
  }

  // ── Edit mode ──
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
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
            }}
            placeholder="שם"
            className="flex-1 min-w-[9rem] h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
          <input
            value={draft.labelEn}
            onChange={(e) => setDraft((d) => ({ ...d, labelEn: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
            }}
            placeholder="Label (EN)"
            dir="ltr"
            className="flex-1 min-w-[7rem] sm:max-w-[12rem] h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
          {editExtra && editExtra(draft, setDraft)}
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

  // ── Display mode ──
  return (
    <li
      ref={s.setNodeRef}
      style={style}
      className={s.isDragging ? 'relative z-10' : ''}
    >
      <div
        className={`group flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors ${
          s.isDragging
            ? 'bg-white shadow-md ring-1 ring-gray-200'
            : 'hover:bg-gray-50'
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
          <span className="font-medium text-gray-900 text-[15px] truncate">
            {item.label}
          </span>
          {item.labelEn && (
            <span className="text-[12px] text-gray-400 truncate" dir="ltr">
              {item.labelEn}
            </span>
          )}
        </div>
        {meta}
        <div className="flex items-center gap-1 shrink-0">
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

// ── Add forms (one clear primary action each) ───────────────────────

function AddTypeForm({ onChange }) {
  const [label, setLabel] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.organizationTypes.create({
        label: label.trim(),
        labelEn: labelEn.trim() || null,
      });
      setLabel('');
      setLabelEn('');
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
      <TextInput
        value={label}
        onChange={setLabel}
        placeholder="שם סוג ארגון"
        className="flex-1"
      />
      <TextInput
        value={labelEn}
        onChange={setLabelEn}
        placeholder="Label (EN) — אופציונלי"
        ltr
        className="sm:w-52"
      />
      <PrimaryButton disabled={busy || !label.trim()}>
        {busy ? 'מוסיף…' : 'הוסף סוג'}
      </PrimaryButton>
    </form>
  );
}

function AddSubtypeForm({ types, onChange }) {
  const [label, setLabel] = useState('');
  const [typeId, setTypeId] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.organizationSubtypes.create({
        label: label.trim(),
        organizationTypeId: typeId || null,
      });
      setLabel('');
      setTypeId('');
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
      <TextInput
        value={label}
        onChange={setLabel}
        placeholder="שם תת-סוג"
        className="flex-1"
      />
      <select
        value={typeId}
        onChange={(e) => setTypeId(e.target.value)}
        className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 sm:w-52"
      >
        <option value="">שייך לסוג ארגון — כללי</option>
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      <PrimaryButton disabled={busy || !label.trim()}>
        {busy ? 'מוסיף…' : 'הוסף תת-סוג'}
      </PrimaryButton>
    </form>
  );
}

// ── Small UI atoms ──────────────────────────────────────────────────

function TextInput({ value, onChange, placeholder, ltr, className = '' }) {
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

function PrimaryButton({ children, disabled }) {
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

function CountChip({ n, noun }) {
  return (
    <span className="shrink-0 inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600">
      {n} {noun}
    </span>
  );
}

function Pill({ children }) {
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
      <path
        d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M13.5 6.5l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
