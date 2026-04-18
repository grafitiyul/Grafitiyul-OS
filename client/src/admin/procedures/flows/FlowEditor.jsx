import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { ITEM_KINDS, ITEM_KIND_LABELS } from '../bank/config.js';
import ItemPicker from './ItemPicker.jsx';
import ItemPreview from './ItemPreview.jsx';

function uid() {
  return 'n_' + Math.random().toString(36).slice(2, 12);
}

// Shape the server returns for each node includes the joined item:
//   { id, order, kind, contentItemId, questionItemId, contentItem, questionItem, ... }
// We keep the same shape in local state so the preview doesn't need extra fetches.
function toPayload(nodes) {
  return nodes.map((n, idx) => ({
    id: n.id,
    parentId: null,
    order: idx,
    kind: n.kind,
    contentItemId: n.contentItemId || null,
    questionItemId: n.questionItemId || null,
    groupTitle: null,
    checkpointAfter: false,
  }));
}

export default function FlowEditor() {
  const { id: flowId } = useParams();
  const navigate = useNavigate();
  const { refresh: refreshFlowsList } = useOutletContext() || {};

  const [flow, setFlow] = useState(null); // meta only
  const [nodes, setNodes] = useState([]); // in-order
  const [loadError, setLoadError] = useState(null);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    setFlow(null);
    setNodes([]);
    setSelectedIdx(null);
    try {
      const f = await api.flows.get(flowId);
      // Keep only the flat, non-group nodes (slice 5 scope). Sort by order.
      const flat = (f.nodes || [])
        .filter((n) => n.parentId == null && n.kind !== 'group')
        .sort((a, b) => a.order - b.order);
      setFlow({
        id: f.id,
        title: f.title || '',
        status: f.status || 'draft',
      });
      setNodes(flat);
      setDirty(false);
    } catch (e) {
      setLoadError(e.message);
    }
  }, [flowId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveTitleOnBlur() {
    if (!flow) return;
    try {
      await api.flows.update(flowId, { title: flow.title });
      await refreshFlowsList?.();
    } catch (e) {
      alert('שמירת כותרת נכשלה: ' + e.message);
    }
  }

  function addItem(kind, itemId, itemData) {
    const newNode = {
      id: uid(),
      kind,
      contentItemId: kind === ITEM_KINDS.CONTENT ? itemId : null,
      questionItemId: kind === ITEM_KINDS.QUESTION ? itemId : null,
      contentItem: kind === ITEM_KINDS.CONTENT ? itemData : null,
      questionItem: kind === ITEM_KINDS.QUESTION ? itemData : null,
      order: nodes.length,
    };
    const next = [...nodes, newNode];
    setNodes(next);
    setSelectedIdx(next.length - 1);
    setDirty(true);
    setPickerOpen(false);
  }

  function removeAt(idx) {
    const next = nodes.filter((_, i) => i !== idx);
    setNodes(next);
    setDirty(true);
    if (selectedIdx === idx) {
      setSelectedIdx(next.length === 0 ? null : Math.min(idx, next.length - 1));
    } else if (selectedIdx != null && selectedIdx > idx) {
      setSelectedIdx(selectedIdx - 1);
    }
  }

  function moveUp(idx) {
    if (idx <= 0) return;
    const next = [...nodes];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setNodes(next);
    setDirty(true);
    if (selectedIdx === idx) setSelectedIdx(idx - 1);
    else if (selectedIdx === idx - 1) setSelectedIdx(idx);
  }

  function moveDown(idx) {
    if (idx >= nodes.length - 1) return;
    const next = [...nodes];
    [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
    setNodes(next);
    setDirty(true);
    if (selectedIdx === idx) setSelectedIdx(idx + 1);
    else if (selectedIdx === idx + 1) setSelectedIdx(idx);
  }

  async function save() {
    if (!dirty) return;
    setSaving(true);
    try {
      const payload = toPayload(nodes);
      await api.flows.saveNodes(flowId, payload);
      // Re-fetch to get fresh server ids + joined items.
      await load();
      await refreshFlowsList?.();
    } catch (e) {
      alert('שמירה נכשלה: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteFlow() {
    if (!confirm('למחוק את הזרימה? פעולה זו בלתי הפיכה.')) return;
    try {
      await api.flows.remove(flowId);
      await refreshFlowsList?.();
      navigate('/admin/procedures/flows', { replace: true });
    } catch (e) {
      alert('מחיקה נכשלה: ' + e.message);
    }
  }

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

  const hasSelection = selectedIdx != null;
  const selectedNode = hasSelection ? nodes[selectedIdx] : null;

  return (
    <div className="h-full w-full flex flex-col">
      <EditorHeader
        flow={flow}
        setFlow={setFlow}
        dirty={dirty}
        saving={saving}
        canSave={dirty}
        onSave={save}
        onBlurTitle={saveTitleOnBlur}
        onDelete={deleteFlow}
        showBack={hasSelection}
        onBack={() => setSelectedIdx(null)}
      />

      <div className="flex-1 flex min-h-0">
        <ItemsPane
          nodes={nodes}
          selectedIdx={selectedIdx}
          onSelect={setSelectedIdx}
          onRemove={removeAt}
          onMoveUp={moveUp}
          onMoveDown={moveDown}
          onAdd={() => setPickerOpen(true)}
          hidden={hasSelection /* mobile: hide when preview is up */}
        />
        <PreviewPane
          node={selectedNode}
          hidden={!hasSelection /* mobile: hide when list is up */}
        />
      </div>

      <ItemPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={addItem}
      />
    </div>
  );
}

function EditorHeader({
  flow,
  setFlow,
  dirty,
  saving,
  canSave,
  onSave,
  onBlurTitle,
  onDelete,
  showBack,
  onBack,
}) {
  return (
    <div className="flex items-center gap-2 p-3 border-b border-gray-200 bg-white shrink-0">
      {showBack && (
        <button
          onClick={onBack}
          className="lg:hidden text-sm text-blue-600 px-1"
          aria-label="חזרה לרשימת הפריטים"
        >
          חזרה
        </button>
      )}
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
        disabled={!canSave || saving}
        className="bg-blue-600 text-white rounded px-4 py-1.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? 'שומר…' : dirty ? 'שמור' : 'נשמר'}
      </button>
    </div>
  );
}

function ItemsPane({
  nodes,
  selectedIdx,
  onSelect,
  onRemove,
  onMoveUp,
  onMoveDown,
  onAdd,
  hidden,
}) {
  const cls = hidden
    ? 'hidden lg:flex w-full lg:w-[300px] lg:shrink-0 flex-col bg-white min-h-0 lg:border-l lg:border-gray-200'
    : 'flex w-full lg:w-[300px] lg:shrink-0 flex-col bg-white min-h-0 lg:border-l lg:border-gray-200';
  return (
    <aside className={cls}>
      <div className="p-3 border-b border-gray-200 shrink-0">
        <button
          onClick={onAdd}
          className="w-full border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md px-3 py-2 text-sm font-medium"
        >
          + הוסף פריט
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {nodes.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">
            אין פריטים. השתמשו בכפתור "הוסף פריט" כדי להתחיל.
          </div>
        ) : (
          <ol className="divide-y divide-gray-100">
            {nodes.map((n, idx) => (
              <FlowItemRow
                key={n.id}
                node={n}
                idx={idx}
                isSelected={selectedIdx === idx}
                canMoveUp={idx > 0}
                canMoveDown={idx < nodes.length - 1}
                onSelect={() => onSelect(idx)}
                onMoveUp={() => onMoveUp(idx)}
                onMoveDown={() => onMoveDown(idx)}
                onRemove={() => onRemove(idx)}
              />
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}

function FlowItemRow({
  node,
  idx,
  isSelected,
  canMoveUp,
  canMoveDown,
  onSelect,
  onMoveUp,
  onMoveDown,
  onRemove,
}) {
  const kind = node.kind;
  const item = kind === ITEM_KINDS.CONTENT ? node.contentItem : node.questionItem;
  const title = item?.title || '(פריט נמחק)';
  const badgeCls =
    kind === ITEM_KINDS.QUESTION
      ? 'bg-amber-100 text-amber-800'
      : 'bg-blue-100 text-blue-800';
  return (
    <li
      onClick={onSelect}
      className={`group px-3 py-2 cursor-pointer transition ${
        isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-400 font-mono w-5 text-center" dir="ltr">
          {idx + 1}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${badgeCls}`}>
          {ITEM_KIND_LABELS[kind]}
        </span>
        <span className="flex-1 text-sm truncate text-gray-900">{title}</span>
        <RowBtn
          onClick={(e) => {
            e.stopPropagation();
            onMoveUp();
          }}
          disabled={!canMoveUp}
          label="העבר למעלה"
        >
          ▲
        </RowBtn>
        <RowBtn
          onClick={(e) => {
            e.stopPropagation();
            onMoveDown();
          }}
          disabled={!canMoveDown}
          label="העבר למטה"
        >
          ▼
        </RowBtn>
        <RowBtn
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          label="הסר מהזרימה"
          variant="danger"
        >
          ×
        </RowBtn>
      </div>
    </li>
  );
}

function RowBtn({ children, onClick, disabled, label, variant }) {
  const color =
    variant === 'danger'
      ? 'text-red-600 hover:bg-red-50'
      : 'text-gray-500 hover:bg-gray-200';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`w-6 h-6 rounded text-[10px] flex items-center justify-center transition ${color} disabled:opacity-25 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function PreviewPane({ node, hidden }) {
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
              בחרו פריט כדי לצפות בו
            </div>
            <div className="text-sm text-gray-500">
              כל פריט נשמר בבנק הפריטים; שינוי שם בבנק ישפיע גם כאן.
            </div>
          </div>
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
      </div>
    </section>
  );
}
