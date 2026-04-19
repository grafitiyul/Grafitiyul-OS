import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { relativeHebrew } from '../../../lib/relativeTime.js';

export default function FlowsListPane({ flows, loading, error, onRetry, onCreated }) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { id: selectedId } = useParams();

  // Optimistic copy so drag reorder feels instant; sync whenever props change.
  const [local, setLocal] = useState(flows);
  useEffect(() => setLocal(flows), [flows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return local;
    return local.filter((f) => (f.title || '').toLowerCase().includes(q));
  }, [local, search]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
  );

  async function onDragEnd(event) {
    // Drag reorder only applies when no search is active — otherwise the
    // visible order ≠ storage order and the user's intent is ambiguous.
    if (search.trim()) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = local.map((f) => f.id);
    const from = ids.indexOf(active.id);
    const to = ids.indexOf(over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    setLocal(next.map((id) => local.find((f) => f.id === id)));
    try {
      await api.flows.reorder(next);
    } finally {
      onCreated?.();
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-gray-200 space-y-2 bg-white">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש זרימה..."
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
        />
        {creating ? (
          <CreateForm
            onCancel={() => setCreating(false)}
            onCreated={async (flow) => {
              setCreating(false);
              await onCreated?.();
              navigate(`/admin/procedures/flows/${flow.id}`);
            }}
          />
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md px-3 py-2 text-sm font-medium"
          >
            + זרימה חדשה
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-6 text-center text-sm text-gray-500">טוען…</div>
        )}
        {error && !loading && (
          <div className="p-6 text-center">
            <div className="text-sm text-red-600 mb-2">שגיאה בטעינה</div>
            <div className="text-xs text-gray-500 mb-3 font-mono" dir="ltr">
              {error}
            </div>
            <button
              onClick={onRetry}
              className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50"
            >
              נסו שוב
            </button>
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <EmptyState hasAny={local.length > 0} search={search} />
        )}
        {!loading && !error && filtered.length > 0 && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={filtered.map((f) => f.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="divide-y divide-gray-100">
                {filtered.map((f) => (
                  <FlowRow
                    key={f.id}
                    flow={f}
                    selected={selectedId === f.id}
                    onOpen={() => navigate(`/admin/procedures/flows/${f.id}`)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

function FlowRow({ flow, selected, onOpen }) {
  const sortable = useSortable({ id: flow.id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.4 : 1,
  };
  return (
    <li ref={sortable.setNodeRef} style={style}>
      <div
        className={`group flex items-center gap-1 px-2 py-2 hover:bg-gray-50 transition ${
          selected ? 'bg-blue-50' : ''
        }`}
      >
        <button
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label="גרור"
          className="shrink-0 w-5 h-6 flex items-center justify-center text-gray-400 hover:text-gray-700 cursor-grab active:cursor-grabbing"
          style={{ touchAction: 'none' }}
        >
          <span className="font-mono text-[11px] leading-none">⋮⋮</span>
        </button>
        <button
          onClick={onOpen}
          className="flex-1 min-w-0 text-right block py-1"
        >
          <div className="font-medium text-gray-900 truncate">
            {flow.title || '(ללא שם)'}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
            <span>{relativeHebrew(flow.updatedAt)}</span>
            <span className="text-gray-300">·</span>
            <span>{flow._count?.nodes ?? 0} פריטים</span>
          </div>
        </button>
        <a
          href={`/flow/${flow.id}?preview=1`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 text-gray-500 hover:text-blue-700 hover:bg-blue-50 rounded p-1"
          title="תצוגה מקדימה"
          aria-label="תצוגה מקדימה"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </a>
      </div>
    </li>
  );
}

function EmptyState({ hasAny, search }) {
  if (hasAny && search) {
    return (
      <div className="p-6 text-center">
        <div className="text-sm text-gray-500">לא נמצאו זרימות תואמות</div>
      </div>
    );
  }
  return (
    <div className="p-6 text-center max-w-xs mx-auto">
      <div className="text-4xl mb-3 opacity-50">◫</div>
      <div className="font-semibold text-gray-800 mb-1">עדיין אין זרימות</div>
      <div className="text-sm text-gray-500">
        השתמשו בכפתור "+ זרימה חדשה" כדי ליצור את הראשונה.
      </div>
    </div>
  );
}

function CreateForm({ onCancel, onCreated }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  async function submit(e) {
    e?.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    setBusy(true);
    try {
      const flow = await api.flows.create({ title: clean });
      onCreated(flow);
    } catch (err) {
      alert('יצירה נכשלה: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="border border-blue-200 bg-blue-50 rounded-md p-2 flex gap-1"
    >
      <input
        ref={inputRef}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="שם הזרימה"
        className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
      />
      <button
        type="submit"
        disabled={!title.trim() || busy}
        className="bg-blue-600 text-white rounded px-3 text-sm font-medium disabled:opacity-40"
      >
        {busy ? '...' : 'צור'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="border border-gray-300 rounded px-2 text-sm text-gray-600 hover:bg-white"
        aria-label="ביטול"
      >
        ×
      </button>
    </form>
  );
}
