import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { api } from '../../../lib/api.js';
import { ITEM_KINDS, ITEM_KIND_LABELS } from '../bank/config.js';
import ItemPicker from './ItemPicker.jsx';
import ItemPreview from './ItemPreview.jsx';
import ResizeHandle from '../../../shell/ResizeHandle.jsx';
import DeleteFlowDialog from '../../common/DeleteFlowDialog.jsx';
import MoveToDialog from './MoveToDialog.jsx';
import FlowTreeRow from './FlowTreeRow.jsx';
import {
  buildTree,
  flattenVisible,
  applyMove,
  insertAfter,
  moveToParent,
  removeSubtree,
  countItems,
  uid,
} from './treeOps.js';

const HISTORY_LIMIT = 50;
const COALESCE_WINDOW_MS = 1200;

const ITEMS_WIDTH_KEY = 'gos.procedures.flowItemsPaneWidth';
const ITEMS_DEFAULT = 360;
const ITEMS_MIN = 260;
const ITEMS_MAX = 560;

function readStoredItemsWidth() {
  try {
    const raw = localStorage.getItem(ITEMS_WIDTH_KEY);
    if (!raw) return ITEMS_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return ITEMS_DEFAULT;
    return Math.max(ITEMS_MIN, Math.min(ITEMS_MAX, n));
  } catch {
    return ITEMS_DEFAULT;
  }
}

// Strip fields the server doesn't need before save. The joined contentItem /
// questionItem objects are server-only reads.
function toServerShape(node) {
  return {
    id: node.id,
    parentId: node.parentId || null,
    order: node.order,
    kind: node.kind,
    contentItemId: node.contentItemId || null,
    questionItemId: node.questionItemId || null,
    groupTitle: node.groupTitle || null,
    checkpointAfter: !!node.checkpointAfter,
  };
}

export default function FlowEditor() {
  const { id: flowId } = useParams();
  const navigate = useNavigate();
  const { refresh: refreshFlowsList } = useOutletContext() || {};

  const [flow, setFlow] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Collapse state — persisted per flow in localStorage.
  const collapseKey = `gos.flow.collapsed.${flowId}`;
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const raw = localStorage.getItem(`gos.flow.collapsed.${flowId}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(collapseKey, JSON.stringify(collapsed));
    } catch {
      /* storage unavailable */
    }
  }, [collapseKey, collapsed]);

  // Undo / Redo history of the flat nodes array.
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const coalesceRef = useRef({ at: 0, key: null });
  // `true` once the initial fetch has populated nodes. Used to gate the
  // collapse-state prune so it doesn't wipe the persisted state before the
  // real nodes arrive.
  const loadedRef = useRef(false);

  // Picker context: how to insert the picked item(s).
  //   { mode: 'into', parentId }   — append as last child of parent (null = root)
  //   { mode: 'after', afterId }    — insert immediately after a given node
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerContext, setPickerContext] = useState({
    mode: 'into',
    parentId: null,
  });

  const [deleteOpen, setDeleteOpen] = useState(false);

  // Move-to dialog (mobile-critical fallback).
  const [moveTargetId, setMoveTargetId] = useState(null);

  const [itemsWidth, setItemsWidth] = useState(readStoredItemsWidth);

  // DnD transient state
  const [activeId, setActiveId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [overPos, setOverPos] = useState(null);

  function persistItemsWidth(w) {
    setItemsWidth(w);
    try {
      localStorage.setItem(ITEMS_WIDTH_KEY, String(w));
    } catch {
      /* ignore */
    }
  }

  const load = useCallback(async () => {
    setLoadError(null);
    setFlow(null);
    setNodes([]);
    setSelectedId(null);
    setDirty(false);
    setPast([]);
    setFuture([]);
    coalesceRef.current = { at: 0, key: null };
    loadedRef.current = false;
    try {
      const f = await api.flows.get(flowId);
      setFlow({
        id: f.id,
        title: f.title || '',
        status: f.status || 'draft',
      });
      setNodes(f.nodes || []);
      loadedRef.current = true;
    } catch (e) {
      setLoadError(e.message);
    }
  }, [flowId]);

  useEffect(() => {
    load();
  }, [load]);

  const tree = useMemo(() => buildTree(nodes), [nodes]);
  const visible = useMemo(
    () => flattenVisible(tree, collapsed),
    [tree, collapsed],
  );
  const visibleIds = useMemo(() => visible.map((v) => v.node.id), [visible]);
  const selectedNode = useMemo(
    () => (selectedId ? nodes.find((n) => n.id === selectedId) : null),
    [nodes, selectedId],
  );

  // --- Commit / history ----------------------------------------------

  // Single entry point for structural changes. Pushes the pre-change state
  // into `past` so the user can undo. Same coalesceKey within
  // COALESCE_WINDOW_MS collapses into a single history step (used for
  // rapid group-title typing).
  function commit(next, opts = {}) {
    if (next === nodes) return;
    const now = Date.now();
    const k = opts.coalesceKey || null;
    const canCoalesce =
      k &&
      coalesceRef.current.key === k &&
      now - coalesceRef.current.at < COALESCE_WINDOW_MS;
    coalesceRef.current = { at: now, key: k };
    if (!canCoalesce) {
      setPast((p) => {
        const np = [...p, nodes];
        while (np.length > HISTORY_LIMIT) np.shift();
        return np;
      });
      setFuture([]);
    }
    setNodes(next);
    setDirty(true);
  }

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  function undo() {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setFuture((f) => [...f, nodes]);
    setPast((p) => p.slice(0, -1));
    setNodes(prev);
    setDirty(true);
    coalesceRef.current = { at: 0, key: null };
    if (selectedId && !prev.find((n) => n.id === selectedId)) {
      setSelectedId(null);
    }
  }

  function redo() {
    if (future.length === 0) return;
    const next = future[future.length - 1];
    setPast((p) => [...p, nodes]);
    setFuture((f) => f.slice(0, -1));
    setNodes(next);
    setDirty(true);
    coalesceRef.current = { at: 0, key: null };
    if (selectedId && !next.find((n) => n.id === selectedId)) {
      setSelectedId(null);
    }
  }

  // Keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y). Respect native
  // undo behaviour inside text inputs.
  useEffect(() => {
    function onKey(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target;
      const inInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (inInput) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [past, future, nodes, selectedId]);

  // Prune collapse state after nodes change — drop entries for groups that
  // no longer exist so storage doesn't accumulate cruft. Gated on
  // `loadedRef` so we don't wipe the persisted state before the real nodes
  // arrive from the server on first mount.
  useEffect(() => {
    if (!loadedRef.current) return;
    const groupIds = new Set(
      nodes.filter((n) => n.kind === 'group').map((n) => n.id),
    );
    setCollapsed((cur) => {
      let changed = false;
      const pruned = {};
      for (const k of Object.keys(cur)) {
        if (groupIds.has(k)) pruned[k] = cur[k];
        else changed = true;
      }
      return changed ? pruned : cur;
    });
  }, [nodes]);

  // --- Mutations ------------------------------------------------------

  function updateNode(id, updates) {
    // Coalesce rapid typing into the same history entry for group titles.
    const coalesceKey =
      updates.groupTitle !== undefined ? `title:${id}` : null;
    commit(
      nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
      { coalesceKey },
    );
  }

  function removeNode(id) {
    commit(removeSubtree(nodes, id));
    if (id === selectedId) setSelectedId(null);
  }

  function makeItemNode(kind, itemId, itemData) {
    return {
      id: uid(),
      kind,
      contentItemId: kind === ITEM_KINDS.CONTENT ? itemId : null,
      questionItemId: kind === ITEM_KINDS.QUESTION ? itemId : null,
      contentItem: kind === ITEM_KINDS.CONTENT ? itemData : null,
      questionItem: kind === ITEM_KINDS.QUESTION ? itemData : null,
      groupTitle: null,
      parentId: null,
      order: 0,
      checkpointAfter: false,
    };
  }

  function makeGroupNode() {
    return {
      id: uid(),
      kind: 'group',
      contentItemId: null,
      questionItemId: null,
      contentItem: null,
      questionItem: null,
      groupTitle: 'קבוצה חדשה',
      parentId: null,
      order: 0,
      checkpointAfter: false,
    };
  }

  function addItem(kind, itemId, itemData) {
    const newNode = makeItemNode(kind, itemId, itemData);
    let next;
    if (pickerContext.mode === 'after' && pickerContext.afterId) {
      next = insertAfter(nodes, pickerContext.afterId, newNode);
    } else {
      const parentId = pickerContext.parentId || null;
      const siblings = nodes.filter((n) => (n.parentId ?? null) === parentId);
      next = [
        ...nodes,
        { ...newNode, parentId, order: siblings.length },
      ];
    }
    commit(next);
    setSelectedId(newNode.id);
    // Picker stays open (multi-pick).
  }

  function addGroup(parentId = null) {
    const group = makeGroupNode();
    const siblings = nodes.filter((n) => (n.parentId ?? null) === parentId);
    commit([
      ...nodes,
      { ...group, parentId: parentId || null, order: siblings.length },
    ]);
    setSelectedId(group.id);
  }

  function addItemBelow(afterId) {
    setPickerContext({ mode: 'after', afterId });
    setPickerOpen(true);
  }

  function addGroupBelow(afterId) {
    const group = makeGroupNode();
    commit(insertAfter(nodes, afterId, group));
    setSelectedId(group.id);
  }

  function openPicker(parentId) {
    setPickerContext({ mode: 'into', parentId: parentId || null });
    setPickerOpen(true);
  }

  function toggleCollapse(id) {
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  }

  function openMoveTo(id) {
    setMoveTargetId(id);
  }
  function confirmMoveTo(targetParentId) {
    if (!moveTargetId) return;
    commit(moveToParent(nodes, moveTargetId, targetParentId));
  }

  // --- DnD handlers ---------------------------------------------------

  // Desktop: start drag after 5px pointer movement.
  // Touch: require a 180ms hold + 6px tolerance so scroll gestures don't
  // accidentally start a drag.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
  );

  function onDragStart(event) {
    setActiveId(event.active.id);
    setOverId(null);
    setOverPos(null);
  }

  function onDragOver(event) {
    const { active, over } = event;
    if (!over || over.id === active.id) {
      setOverId(null);
      setOverPos(null);
      return;
    }
    const overNode = nodes.find((n) => n.id === over.id);
    if (!overNode) {
      setOverId(null);
      setOverPos(null);
      return;
    }
    const overRect = over.rect;
    const activeTransl = active.rect.current?.translated;
    const pointerY =
      activeTransl != null
        ? activeTransl.top + activeTransl.height / 2
        : overRect.top + overRect.height / 2;
    const relY = pointerY - overRect.top;

    let position = 'after';
    if (overNode.kind === 'group') {
      // Widened tolerance: the middle 60% of a group row registers as
      // "inside". Easier to hit on touch.
      const edge = overRect.height * 0.2;
      if (relY < edge) position = 'before';
      else if (relY > overRect.height - edge) position = 'after';
      else position = 'inside';
    } else {
      position = relY < overRect.height / 2 ? 'before' : 'after';
    }
    setOverId(over.id);
    setOverPos(position);
  }

  function onDragEnd(event) {
    const active = event.active.id;
    const target = overId;
    const pos = overPos;
    setActiveId(null);
    setOverId(null);
    setOverPos(null);
    if (target && pos && target !== active) {
      const next = applyMove(nodes, active, target, pos);
      if (next !== nodes) commit(next);
    }
  }

  function onDragCancel() {
    setActiveId(null);
    setOverId(null);
    setOverPos(null);
  }

  // --- Save / delete / title ------------------------------------------

  async function saveTitleOnBlur() {
    if (!flow) return;
    try {
      await api.flows.update(flowId, { title: flow.title });
      await refreshFlowsList?.();
    } catch (e) {
      alert('שמירת כותרת נכשלה: ' + e.message);
    }
  }

  async function save() {
    if (!dirty) return;
    setSaving(true);
    try {
      const payload = nodes.map(toServerShape);
      await api.flows.saveNodes(flowId, payload);
      await load();
      await refreshFlowsList?.();
    } catch (e) {
      alert('שמירה נכשלה: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function performDelete() {
    await api.flows.remove(flowId);
    await refreshFlowsList?.();
    navigate('/admin/procedures/flows', { replace: true });
  }

  // --- Render ---------------------------------------------------------

  if (loadError) {
    return (
      <div className="w-full p-6 text-center">
        <div className="text-sm text-red-600 mb-2">שגיאה בטעינת הזרימה</div>
        <div className="text-xs text-gray-500 font-mono" dir="ltr">
          {loadError}
        </div>
      </div>
    );
  }
  if (!flow) {
    return <div className="w-full p-6 text-sm text-gray-500">טוען…</div>;
  }

  const hasSelection = !!selectedId;

  return (
    <div className="h-full w-full flex flex-col">
      <EditorHeader
        flow={flow}
        setFlow={setFlow}
        dirty={dirty}
        saving={saving}
        onSave={save}
        onBlurTitle={saveTitleOnBlur}
        onDelete={() => setDeleteOpen(true)}
        showBack={hasSelection}
        onBack={() => setSelectedId(null)}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />

      <div
        className="flex-1 flex min-h-0"
        style={{ '--flow-items-width': `${itemsWidth}px` }}
      >
        <ItemsPane
          nodes={nodes}
          visible={visible}
          visibleIds={visibleIds}
          selectedId={selectedId}
          collapsed={collapsed}
          activeId={activeId}
          overId={overId}
          overPos={overPos}
          onSelect={setSelectedId}
          onToggleCollapse={toggleCollapse}
          onUpdate={updateNode}
          onRemove={removeNode}
          onAddItemRoot={() => openPicker(null)}
          onAddGroupRoot={() => addGroup(null)}
          onAddItemInto={openPicker}
          onAddGroupInto={addGroup}
          onAddItemBelow={addItemBelow}
          onAddGroupBelow={addGroupBelow}
          onMoveTo={openMoveTo}
          sensors={sensors}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
          hidden={hasSelection}
        />
        <ResizeHandle
          currentWidth={itemsWidth}
          onResize={persistItemsWidth}
          minWidth={ITEMS_MIN}
          maxWidth={ITEMS_MAX}
          ariaLabel="שינוי רוחב רשימת הפריטים בזרימה"
        />
        <PreviewPane
          node={selectedNode}
          allNodes={nodes}
          onUpdate={updateNode}
          hidden={!hasSelection}
        />
      </div>

      <ItemPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={addItem}
      />
      <DeleteFlowDialog
        open={deleteOpen}
        flowTitle={flow.title}
        onClose={() => setDeleteOpen(false)}
        onConfirm={performDelete}
      />
      <MoveToDialog
        open={!!moveTargetId}
        nodes={nodes}
        nodeId={moveTargetId}
        currentParentId={
          moveTargetId
            ? nodes.find((n) => n.id === moveTargetId)?.parentId || null
            : null
        }
        onClose={() => setMoveTargetId(null)}
        onConfirm={confirmMoveTo}
      />
    </div>
  );
}

function EditorHeader({
  flow,
  setFlow,
  dirty,
  saving,
  onSave,
  onBlurTitle,
  onDelete,
  showBack,
  onBack,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}) {
  return (
    <div className="flex items-center gap-2 p-3 border-b border-gray-200 bg-white shrink-0">
      {showBack && (
        <button
          onClick={onBack}
          className="lg:hidden text-sm text-blue-600 px-1"
          aria-label="חזרה לרשימה"
        >
          חזרה
        </button>
      )}
      <HeaderIconBtn
        label="בטל (Ctrl+Z)"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <UndoSVG />
      </HeaderIconBtn>
      <HeaderIconBtn
        label="חזור (Ctrl+Shift+Z)"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <RedoSVG />
      </HeaderIconBtn>
      <input
        value={flow.title}
        onChange={(e) => setFlow({ ...flow, title: e.target.value })}
        onBlur={onBlurTitle}
        placeholder="שם הזרימה"
        className="flex-1 min-w-0 text-lg font-medium text-gray-900 bg-transparent border-0 focus:outline-none focus:bg-gray-50 rounded px-2 py-1"
      />
      <button
        onClick={onDelete}
        className="text-sm text-red-600 hover:bg-red-50 rounded px-3 py-1.5"
      >
        מחק
      </button>
      <button
        onClick={onSave}
        disabled={!dirty || saving}
        className="bg-blue-600 text-white rounded px-4 py-1.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? 'שומר…' : dirty ? 'שמור' : 'נשמר'}
      </button>
    </div>
  );
}

function HeaderIconBtn({ children, onClick, disabled, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-8 h-8 shrink-0 rounded-md text-gray-700 hover:bg-gray-200 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed flex items-center justify-center"
    >
      {children}
    </button>
  );
}

function UndoSVG() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
    </svg>
  );
}
function RedoSVG() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 15-6.7L21 13" />
    </svg>
  );
}

function ItemsPane({
  nodes,
  visible,
  visibleIds,
  selectedId,
  collapsed,
  activeId,
  overId,
  overPos,
  onSelect,
  onToggleCollapse,
  onUpdate,
  onRemove,
  onAddItemRoot,
  onAddGroupRoot,
  onAddItemInto,
  onAddGroupInto,
  onAddItemBelow,
  onAddGroupBelow,
  onMoveTo,
  sensors,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragCancel,
  hidden,
}) {
  const cls = hidden
    ? 'hidden lg:flex w-full lg:w-[var(--flow-items-width)] lg:shrink-0 flex-col bg-white min-h-0'
    : 'flex w-full lg:w-[var(--flow-items-width)] lg:shrink-0 flex-col bg-white min-h-0';

  return (
    <aside className={cls}>
      <div className="p-3 border-b border-gray-200 shrink-0 flex gap-2">
        <button
          onClick={onAddItemRoot}
          className="flex-1 border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md px-3 py-2 text-sm font-medium"
        >
          + הוסף פריט
        </button>
        <button
          onClick={onAddGroupRoot}
          className="flex-1 border border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-md px-3 py-2 text-sm font-medium"
        >
          + קבוצה
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {nodes.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">
            אין פריטים. הוסיפו פריט או קבוצה כדי להתחיל.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
          >
            <SortableContext
              items={visibleIds}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-0.5">
                {visible.map(({ node, depth }) => {
                  const hint = overId === node.id ? overPos : null;
                  return (
                    <li key={node.id}>
                      <FlowTreeRow
                        node={node}
                        depth={depth}
                        isSelected={selectedId === node.id}
                        isCollapsed={!!collapsed[node.id]}
                        isDraggingThis={activeId === node.id}
                        dropHint={hint}
                        onSelect={() => onSelect(node.id)}
                        onToggleCollapse={() => onToggleCollapse(node.id)}
                        onUpdate={(upd) => onUpdate(node.id, upd)}
                        onRemove={() => onRemove(node.id)}
                        onAddItem={() => onAddItemInto(node.id)}
                        onAddGroup={() => onAddGroupInto(node.id)}
                        onAddItemBelow={() => onAddItemBelow(node.id)}
                        onAddGroupBelow={() => onAddGroupBelow(node.id)}
                        onMoveTo={() => onMoveTo(node.id)}
                      />
                    </li>
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </aside>
  );
}

function PreviewPane({ node, allNodes, onUpdate, hidden }) {
  const cls = hidden
    ? 'hidden lg:flex flex-1 bg-gray-50 min-h-0 overflow-y-auto'
    : 'flex flex-1 bg-gray-50 min-h-0 overflow-y-auto';

  if (!node) {
    return (
      <section className={cls}>
        <div className="w-full flex items-center justify-center p-10">
          <div className="text-center max-w-sm">
            <div className="text-5xl mb-4 opacity-40">◎</div>
            <div className="text-lg font-semibold text-gray-800 mb-1">
              בחרו פריט או קבוצה
            </div>
            <div className="text-sm text-gray-500">
              גררו כדי לסדר מחדש, לקנן בתוך קבוצות או להוציא מהן.
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (node.kind === 'group') {
    const tree = buildTree(allNodes);
    const inTree = tree.find((x) => x.id === node.id) || findInTree(tree, node.id);
    const count = inTree ? countItems(inTree) : 0;
    return (
      <section className={cls}>
        <div className="w-full p-4 lg:p-8">
          <article className="max-w-3xl mx-auto">
            <div className="flex items-center gap-2 mb-3 text-[11px]">
              <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800">
                קבוצה
              </span>
            </div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-4">
              {node.groupTitle || '(ללא שם)'}
            </h1>
            <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
              <Field label="שם הקבוצה">
                <input
                  value={node.groupTitle || ''}
                  onChange={(e) => onUpdate(node.id, { groupTitle: e.target.value })}
                  placeholder="שם הקבוצה"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                />
              </Field>
              <Field label="נקודת ביקורת בסיום">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={!!node.checkpointAfter}
                    onChange={(e) =>
                      onUpdate(node.id, { checkpointAfter: e.target.checked })
                    }
                  />
                  סמן את סיום הקבוצה כנקודת ביקורת
                </label>
              </Field>
              <div className="pt-2 border-t border-gray-100 text-sm text-gray-600">
                מספר פריטים (כולל בתוך תתי-קבוצות): <b>{count}</b>
              </div>
            </div>
          </article>
        </div>
      </section>
    );
  }

  const item =
    node.kind === ITEM_KINDS.CONTENT ? node.contentItem : node.questionItem;

  return (
    <section className={cls}>
      <div className="w-full p-4 lg:p-8">
        <ItemPreview kind={node.kind} item={item} />
        <div className="max-w-3xl mx-auto mt-4 bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={!!node.checkpointAfter}
              onChange={(e) =>
                onUpdate(node.id, { checkpointAfter: e.target.checked })
              }
            />
            <span>נקודת ביקורת אחרי פריט זה</span>
          </label>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[11px] text-gray-500 font-medium mb-1">{label}</div>
      {children}
    </div>
  );
}

function findInTree(tree, id) {
  for (const n of tree) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const found = findInTree(n.children, id);
      if (found) return found;
    }
  }
  return null;
}
