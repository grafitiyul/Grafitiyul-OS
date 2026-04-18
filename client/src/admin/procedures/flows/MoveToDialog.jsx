import { useMemo } from 'react';
import Dialog from '../../common/Dialog.jsx';
import { buildTree, isDescendant } from './treeOps.js';

// Cross-parent move fallback (critical for mobile, handy on desktop).
// Lists every group in the tree as a click target; selecting one moves
// the node there as the last child. Includes a "root" option for moves
// to the top level. Descendants of the node being moved are hidden to
// prevent cycles.
export default function MoveToDialog({
  open,
  nodes,
  nodeId,
  currentParentId,
  onConfirm,
  onClose,
}) {
  const targets = useMemo(() => {
    if (!nodeId) return [];
    const tree = buildTree(nodes);
    const rows = [];
    function walk(arr, depth) {
      for (const n of arr) {
        if (n.kind === 'group') {
          const isSelf = n.id === nodeId;
          const isDesc = isDescendant(nodes, nodeId, n.id);
          rows.push({
            id: n.id,
            title: n.groupTitle || '(ללא שם)',
            depth,
            disabled: isSelf || isDesc,
            disabledReason: isSelf
              ? 'אי אפשר להעביר פריט לתוך עצמו'
              : isDesc
              ? 'אי אפשר להעביר קבוצה לתוך צאצא שלה'
              : null,
          });
          if (n.children?.length) walk(n.children, depth + 1);
        }
      }
    }
    walk(tree, 0);
    return rows;
  }, [nodes, nodeId]);

  const atRoot = (currentParentId ?? null) === null;

  return (
    <Dialog open={open} onClose={onClose} title="העברה אל..." size="md">
      <div className="space-y-1">
        <MoveOption
          label="רמה עליונה"
          sub="ללא קבוצת אב"
          depth={0}
          current={atRoot}
          onClick={() => {
            if (!atRoot) onConfirm(null);
            onClose();
          }}
          disabled={atRoot}
          disabledReason={atRoot ? 'כבר ברמה עליונה' : null}
        />
        {targets.length === 0 ? (
          <div className="text-sm text-gray-500 italic px-2 py-3 text-center">
            אין קבוצות זמינות לתוכן להעביר את הפריט.
          </div>
        ) : (
          targets.map((t) => (
            <MoveOption
              key={t.id}
              label={t.title}
              depth={t.depth + 1}
              current={t.id === currentParentId}
              disabled={t.disabled || t.id === currentParentId}
              disabledReason={
                t.disabled
                  ? t.disabledReason
                  : t.id === currentParentId
                  ? 'הקבוצה הנוכחית'
                  : null
              }
              onClick={() => {
                if (!t.disabled && t.id !== currentParentId) {
                  onConfirm(t.id);
                }
                onClose();
              }}
            />
          ))
        )}
      </div>
    </Dialog>
  );
}

function MoveOption({
  label,
  sub,
  depth,
  current,
  disabled,
  disabledReason,
  onClick,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabledReason || undefined}
      className={`w-full text-right px-3 py-2 rounded-md border transition flex items-center gap-2 ${
        disabled
          ? 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed'
          : current
          ? 'border-blue-200 bg-blue-50 text-blue-800'
          : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-800'
      }`}
      style={{ paddingInlineStart: 12 + depth * 16 }}
    >
      <span className="text-[11px] text-gray-400 shrink-0 font-mono">
        {depth === 0 ? '•' : '└'}
      </span>
      <span className="flex-1 min-w-0 truncate font-medium text-sm">
        {label}
      </span>
      {sub && <span className="text-[11px] text-gray-500 shrink-0">{sub}</span>}
      {current && (
        <span className="text-[11px] text-blue-700 shrink-0">נוכחי</span>
      )}
      {disabled && disabledReason && !current && (
        <span className="text-[11px] text-gray-400 shrink-0">
          {disabledReason}
        </span>
      )}
    </button>
  );
}
