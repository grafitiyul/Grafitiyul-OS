import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ITEM_KINDS, ITEM_KIND_LABELS } from '../bank/config.js';

// A single row in the flow tree. Renders either an item or a group header.
// Drag-handle comes from useSortable; depth drives the indentation;
// `dropHint` shows the before/after/inside visual indicator when this row
// is the current drag target.
export default function FlowTreeRow({
  node,
  depth,
  isSelected,
  isCollapsed,
  isDraggingThis,
  dropHint, // 'before' | 'after' | 'inside' | null
  onSelect,
  onToggleCollapse,
  onUpdate,
  onRemove,
  onAddItem, // (groups only)
  onAddGroup, // (groups only)
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.25 : 1,
  };

  const isGroup = node.kind === 'group';
  const item =
    node.kind === ITEM_KINDS.CONTENT
      ? node.contentItem
      : node.kind === ITEM_KINDS.QUESTION
      ? node.questionItem
      : null;
  const title = isGroup
    ? node.groupTitle || '(ללא שם)'
    : item?.title || '(פריט נמחק)';

  const kindBadgeCls = isGroup
    ? 'bg-purple-100 text-purple-800'
    : node.kind === ITEM_KINDS.QUESTION
    ? 'bg-amber-100 text-amber-800'
    : 'bg-blue-100 text-blue-800';

  const kindLabel = isGroup ? 'קבוצה' : ITEM_KIND_LABELS[node.kind];

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {/* Drop indicator — before */}
      {dropHint === 'before' && (
        <div
          aria-hidden
          className="absolute inset-x-0 -top-[1px] h-0.5 bg-blue-500 z-10 pointer-events-none"
          style={{ marginInlineStart: depth * 20 }}
        />
      )}

      <div
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        className={`group flex items-start gap-1.5 px-2 py-1.5 rounded-md transition cursor-pointer ${
          isSelected
            ? 'bg-blue-50 ring-1 ring-blue-300'
            : isGroup
            ? 'hover:bg-purple-50'
            : 'hover:bg-gray-50'
        } ${dropHint === 'inside' ? 'ring-2 ring-blue-400 bg-blue-50' : ''}`}
        style={{
          marginInlineStart: depth * 20,
          // Group rows get a soft border treatment so the hierarchy reads.
          ...(isGroup
            ? {
                background: isSelected ? undefined : 'rgba(243,232,255,0.35)',
              }
            : {}),
        }}
      >
        {/* Drag handle */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          aria-label="גרור להזזה"
          title="גרור להזזה"
          className="shrink-0 w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-700 cursor-grab active:cursor-grabbing mt-0.5"
          style={{ touchAction: 'none' }}
        >
          <span className="font-mono text-[11px] leading-none">⋮⋮</span>
        </button>

        {/* Collapse chevron for groups */}
        {isGroup ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            aria-label={isCollapsed ? 'הצג תוכן קבוצה' : 'קפל קבוצה'}
            className="shrink-0 w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-900 mt-0.5"
          >
            <span className="text-[10px]" style={{ display: 'inline-block', transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.12s' }}>
              ▼
            </span>
          </button>
        ) : (
          <span className="shrink-0 w-5" />
        )}

        {/* Type badge */}
        <span
          className={`shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded ${kindBadgeCls}`}
        >
          {kindLabel}
        </span>

        {/* Title (editable for groups, static for items) */}
        {isGroup ? (
          <input
            value={node.groupTitle || ''}
            onChange={(e) => onUpdate({ groupTitle: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            placeholder="שם הקבוצה"
            className="flex-1 min-w-0 text-sm font-medium bg-transparent border-0 focus:outline-none focus:bg-white focus:ring-1 focus:ring-blue-300 rounded px-1"
          />
        ) : (
          <span
            className="flex-1 min-w-0 text-sm text-gray-900 leading-relaxed"
            style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
          >
            {title}
          </span>
        )}

        {/* Actions row */}
        <div className="shrink-0 flex items-center gap-0.5 mt-0.5">
          <CheckpointToggle
            on={!!node.checkpointAfter}
            onToggle={() =>
              onUpdate({ checkpointAfter: !node.checkpointAfter })
            }
          />
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
            label={isGroup ? 'הסר קבוצה' : 'הסר מהזרימה'}
            variant="danger"
          >
            ×
          </RowBtn>
        </div>
      </div>

      {/* Empty-group hint + contextual add buttons when expanded */}
      {isGroup && !isCollapsed && (
        <div
          style={{ marginInlineStart: (depth + 1) * 20 }}
          className="flex items-center gap-1 py-1 px-2"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddItem();
            }}
            className="text-[11px] text-blue-700 hover:bg-blue-50 border border-blue-200 rounded px-2 py-0.5"
          >
            + פריט
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddGroup();
            }}
            className="text-[11px] text-purple-700 hover:bg-purple-50 border border-purple-200 rounded px-2 py-0.5"
          >
            + קבוצה
          </button>
          {(!node.children || node.children.length === 0) && (
            <span className="text-[11px] text-gray-400 italic">
              קבוצה ריקה
            </span>
          )}
        </div>
      )}

      {/* Drop indicator — after */}
      {dropHint === 'after' && (
        <div
          aria-hidden
          className="absolute inset-x-0 -bottom-[1px] h-0.5 bg-blue-500 z-10 pointer-events-none"
          style={{ marginInlineStart: depth * 20 }}
        />
      )}
    </div>
  );
}

function CheckpointToggle({ on, onToggle }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={on}
      aria-label={on ? 'בטל נקודת ביקורת' : 'סמן כנקודת ביקורת'}
      title="נקודת ביקורת"
      className={`w-7 h-7 shrink-0 rounded text-[11px] flex items-center justify-center transition ${
        on
          ? 'bg-purple-100 text-purple-700 ring-1 ring-purple-300'
          : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
      }`}
    >
      ⚑
    </button>
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
      className={`w-7 h-7 shrink-0 rounded text-[12px] flex items-center justify-center transition ${color} disabled:opacity-25 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}
