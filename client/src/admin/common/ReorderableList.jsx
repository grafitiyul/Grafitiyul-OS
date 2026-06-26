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

// Generic drag-to-reorder list. Unlike catalogKit's SortableList (which hard-
// codes label/labelEn inline editing), this one is render-prop based: the caller
// draws each row and decides what edit UI to show. `onReorder(ids)` receives the
// full id list in the new order. A drag handle is provided to the render fn.
export default function ReorderableList({ items, onReorder, renderRow, emptyText }) {
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
    const nextIds = arrayMove(ids, from, to);
    setLocal(nextIds.map((id) => local.find((i) => i.id === id)));
    onReorder(nextIds);
  }

  if (!local.length) {
    return (
      <div className="px-3 py-12 text-center text-sm text-gray-400">{emptyText}</div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={local.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1">
          {local.map((item) => (
            <Row key={item.id} item={item} renderRow={renderRow} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function Row({ item, renderRow }) {
  const s = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(s.transform),
    transition: s.transition,
  };
  const handle = (
    <button
      {...s.attributes}
      {...s.listeners}
      aria-label="גרור לשינוי סדר"
      className="shrink-0 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing p-1 -m-1"
      style={{ touchAction: 'none' }}
      type="button"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <circle cx="5.5" cy="3.5" r="1.3" /><circle cx="10.5" cy="3.5" r="1.3" />
        <circle cx="5.5" cy="8" r="1.3" /><circle cx="10.5" cy="8" r="1.3" />
        <circle cx="5.5" cy="12.5" r="1.3" /><circle cx="10.5" cy="12.5" r="1.3" />
      </svg>
    </button>
  );
  return (
    <li ref={s.setNodeRef} style={style} className={s.isDragging ? 'relative z-10' : ''}>
      {renderRow(item, { handle, isDragging: s.isDragging })}
    </li>
  );
}
