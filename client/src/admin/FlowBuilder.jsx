import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../lib/api.js';

function uid() {
  return 'n_' + Math.random().toString(36).slice(2, 12);
}

export default function FlowBuilder() {
  const { id } = useParams();
  const [flow, setFlow] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [contentBank, setContentBank] = useState([]);
  const [questionBank, setQuestionBank] = useState([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      const [f, c, q] = await Promise.all([
        api.flows.get(id),
        api.contentItems.list(),
        api.questionItems.list(),
      ]);
      setFlow(f);
      setNodes(denormalize(f.nodes));
      setContentBank(c);
      setQuestionBank(q);
    })();
  }, [id]);

  function denormalize(dbNodes) {
    return dbNodes.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      order: n.order,
      kind: n.kind,
      contentItemId: n.contentItemId,
      questionItemId: n.questionItemId,
      groupTitle: n.groupTitle,
      checkpointAfter: n.checkpointAfter,
      displayTitle:
        n.contentItem?.title ||
        n.questionItem?.title ||
        n.groupTitle ||
        '(untitled)',
      questionMeta: n.questionItem
        ? n.questionItem.answerType === 'single_choice'
          ? 'choice'
          : 'open'
        : null,
    }));
  }

  function mutate(updater) {
    setNodes((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      setDirty(true);
      return next;
    });
  }

  function addContent(item) {
    const n = {
      id: uid(),
      parentId: null,
      order: nodes.filter((x) => !x.parentId).length,
      kind: 'content',
      contentItemId: item.id,
      checkpointAfter: false,
      displayTitle: item.title,
    };
    mutate([...nodes, n]);
  }
  function addQuestion(item) {
    const n = {
      id: uid(),
      parentId: null,
      order: nodes.filter((x) => !x.parentId).length,
      kind: 'question',
      questionItemId: item.id,
      checkpointAfter: false,
      displayTitle: item.title,
      questionMeta: item.answerType === 'single_choice' ? 'choice' : 'open',
    };
    mutate([...nodes, n]);
  }
  function addGroup() {
    const n = {
      id: uid(),
      parentId: null,
      order: nodes.filter((x) => !x.parentId).length,
      kind: 'group',
      groupTitle: 'New Group',
      checkpointAfter: false,
      displayTitle: 'New Group',
    };
    mutate([...nodes, n]);
  }

  function removeNode(nodeId) {
    const toRemove = new Set([nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of nodes) {
        if (n.parentId && toRemove.has(n.parentId) && !toRemove.has(n.id)) {
          toRemove.add(n.id);
          changed = true;
        }
      }
    }
    mutate(nodes.filter((n) => !toRemove.has(n.id)));
  }

  function setField(nodeId, field, value) {
    mutate(
      nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const upd = { ...n, [field]: value };
        if (field === 'groupTitle') upd.displayTitle = value || 'Group';
        return upd;
      })
    );
  }

  function setParent(nodeId, newParentId) {
    const siblings = nodes.filter(
      (n) => (n.parentId ?? null) === (newParentId ?? null) && n.id !== nodeId
    );
    mutate(
      nodes.map((n) =>
        n.id === nodeId
          ? { ...n, parentId: newParentId || null, order: siblings.length }
          : n
      )
    );
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeNode = nodes.find((n) => n.id === active.id);
    const overNode = nodes.find((n) => n.id === over.id);
    if (!activeNode || !overNode) return;
    if ((activeNode.parentId ?? null) !== (overNode.parentId ?? null)) return;

    const siblings = nodes
      .filter((n) => (n.parentId ?? null) === (activeNode.parentId ?? null))
      .sort((a, b) => a.order - b.order);
    const oldIdx = siblings.findIndex((n) => n.id === active.id);
    const newIdx = siblings.findIndex((n) => n.id === over.id);
    const reordered = arrayMove(siblings, oldIdx, newIdx).map((n, i) => ({
      ...n,
      order: i,
    }));
    const byId = new Map(reordered.map((n) => [n.id, n]));
    mutate(nodes.map((n) => byId.get(n.id) || n));
  }

  async function save() {
    setSaving(true);
    try {
      const payload = nodes.map((n) => ({
        id: n.id,
        parentId: n.parentId || null,
        order: n.order,
        kind: n.kind,
        contentItemId: n.contentItemId || null,
        questionItemId: n.questionItemId || null,
        groupTitle: n.groupTitle || null,
        checkpointAfter: !!n.checkpointAfter,
      }));
      const updated = await api.flows.saveNodes(id, payload);
      setNodes(denormalize(updated.nodes));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  async function openPreview() {
    if (dirty) await save();
    window.open(
      `/flow/${id}?preview=1`,
      'gos_preview',
      'width=460,height=800,noopener'
    );
  }

  async function togglePublish() {
    const newStatus = flow.status === 'published' ? 'draft' : 'published';
    const updated = await api.flows.update(id, { status: newStatus });
    setFlow({ ...flow, ...updated });
  }

  if (!flow) return <div className="p-6">Loading…</div>;

  const topLevel = nodes
    .filter((n) => !n.parentId)
    .sort((a, b) => a.order - b.order);
  const groups = nodes.filter((n) => n.kind === 'group');

  return (
    <div className="h-[calc(100vh-57px)] flex">
      {/* LEFT: Library */}
      <aside className="w-80 border-r bg-white overflow-y-auto p-4 shrink-0">
        <h3 className="font-semibold mb-3 text-sm uppercase tracking-wide text-gray-500">
          Build
        </h3>
        <button
          className="w-full border rounded px-3 py-2 text-sm hover:bg-gray-50 mb-4"
          onClick={addGroup}
        >
          + Add Group
        </button>

        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
            Content
          </div>
          {contentBank.map((c) => (
            <button
              key={c.id}
              onClick={() => addContent(c)}
              className="block w-full text-left border rounded px-3 py-2 mb-1 hover:bg-blue-50 hover:border-blue-300"
            >
              <div className="text-sm font-medium truncate">{c.title}</div>
            </button>
          ))}
          {!contentBank.length && (
            <div className="text-xs text-gray-400">
              No content items.{' '}
              <Link to="/admin/bank" className="text-blue-600 underline">
                Create
              </Link>
            </div>
          )}
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
            Questions
          </div>
          {questionBank.map((q) => (
            <button
              key={q.id}
              onClick={() => addQuestion(q)}
              className="block w-full text-left border rounded px-3 py-2 mb-1 hover:bg-blue-50 hover:border-blue-300"
            >
              <div className="text-sm font-medium truncate">{q.title}</div>
              <div className="text-xs text-gray-500">
                {q.answerType === 'single_choice' ? 'choice' : 'open'}
              </div>
            </button>
          ))}
          {!questionBank.length && (
            <div className="text-xs text-gray-400">
              No questions.{' '}
              <Link to="/admin/bank" className="text-blue-600 underline">
                Create
              </Link>
            </div>
          )}
        </div>
      </aside>

      {/* RIGHT: Work area */}
      <section className="flex-1 overflow-y-auto">
        <div className="p-3 border-b bg-white flex items-center gap-2 sticky top-0 z-10">
          <input
            className="flex-1 text-lg font-medium border rounded px-3 py-2"
            value={flow.title}
            onChange={(e) => setFlow({ ...flow, title: e.target.value })}
            onBlur={() => api.flows.update(id, { title: flow.title })}
          />
          <span
            className={`text-xs px-2 py-1 rounded ${
              flow.status === 'published'
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-100 text-gray-700'
            }`}
          >
            {flow.status}
          </span>
          <button className="border px-3 py-2 rounded text-sm" onClick={togglePublish}>
            {flow.status === 'published' ? 'Unpublish' : 'Publish'}
          </button>
          <button
            className="border px-3 py-2 rounded text-sm"
            onClick={openPreview}
          >
            Preview
          </button>
          <button
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm disabled:opacity-40"
            disabled={!dirty || saving}
            onClick={save}
          >
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
          <Link
            to={`/admin/flows/${id}/review`}
            className="border px-3 py-2 rounded text-sm"
          >
            Review
          </Link>
        </div>

        <div className="p-6 max-w-3xl mx-auto">
          {topLevel.length === 0 && (
            <div className="border-2 border-dashed rounded p-12 text-center text-gray-500">
              Add items from the library on the left.
            </div>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={topLevel.map((n) => n.id)}
              strategy={verticalListSortingStrategy}
            >
              {topLevel.map((n) => (
                <NodeCard
                  key={n.id}
                  node={n}
                  nodes={nodes}
                  groups={groups}
                  onField={setField}
                  onRemove={removeNode}
                  onSetParent={setParent}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </section>
    </div>
  );
}

function kindBadge(kind) {
  if (kind === 'group') return 'bg-purple-100 text-purple-800';
  if (kind === 'question') return 'bg-amber-100 text-amber-800';
  return 'bg-blue-100 text-blue-800';
}

function NodeCard({ node, nodes, groups, onField, onRemove, onSetParent }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const children = nodes
    .filter((n) => n.parentId === node.id)
    .sort((a, b) => a.order - b.order);

  return (
    <div ref={setNodeRef} style={style} className="bg-white border rounded mb-2">
      <div className="flex items-center gap-2 p-3">
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab text-gray-400 select-none font-mono"
        >
          ⋮⋮
        </span>
        <span className={`text-xs px-2 py-0.5 rounded ${kindBadge(node.kind)}`}>
          {node.kind}
        </span>
        {node.kind === 'group' ? (
          <input
            className="flex-1 border-0 bg-transparent font-medium focus:outline-none focus:bg-gray-50 rounded px-1"
            value={node.groupTitle || ''}
            onChange={(e) => onField(node.id, 'groupTitle', e.target.value)}
          />
        ) : (
          <span className="flex-1 truncate">
            {node.displayTitle}
            {node.questionMeta && (
              <span className="text-xs text-gray-500 ml-2">
                ({node.questionMeta})
              </span>
            )}
          </span>
        )}
        {node.kind !== 'group' && groups.length > 0 && (
          <select
            className="text-xs border rounded px-2 py-1"
            value={node.parentId || ''}
            onChange={(e) => onSetParent(node.id, e.target.value || null)}
          >
            <option value="">(top level)</option>
            {groups
              .filter((g) => g.id !== node.id)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  In: {g.groupTitle || 'Group'}
                </option>
              ))}
          </select>
        )}
        <label className="flex items-center gap-1 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={node.checkpointAfter}
            onChange={(e) => onField(node.id, 'checkpointAfter', e.target.checked)}
          />
          checkpoint
        </label>
        <button
          className="text-red-600 text-sm px-2"
          onClick={() => onRemove(node.id)}
          title="Remove"
        >
          ×
        </button>
      </div>
      {children.length > 0 && (
        <div className="pl-10 pb-3 pr-3 space-y-1">
          {children.map((c) => (
            <div
              key={c.id}
              className="text-sm flex items-center gap-2 bg-gray-50 border rounded px-2 py-1.5"
            >
              <span className="text-gray-400">└</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${kindBadge(c.kind)}`}>
                {c.kind}
              </span>
              <span className="flex-1 truncate">{c.displayTitle}</span>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={c.checkpointAfter}
                  onChange={(e) =>
                    onField(c.id, 'checkpointAfter', e.target.checked)
                  }
                />
                checkpoint
              </label>
              <button
                className="text-xs text-gray-600"
                title="Move out of group"
                onClick={() => onSetParent(c.id, null)}
              >
                ⬆
              </button>
              <button
                className="text-xs text-red-600"
                onClick={() => onRemove(c.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
