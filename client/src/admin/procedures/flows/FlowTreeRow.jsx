import { useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ITEM_KINDS, ITEM_KIND_LABELS } from '../bank/config.js';
import { titleToPlain } from '../../../editor/TitleEditor.jsx';
import { api } from '../../../lib/api.js';

// A single row in the flow tree. Renders either an item or a group header.
// Primary affordances visible on the row: drag handle, type, title.
// Everything else (move-to, add below, checkpoint toggle, delete) lives in
// a single ⋯ menu. Groups are visually heavier than items so the tree
// hierarchy reads at a glance.
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
  onAddItem, // (groups only — contextual "+ פריט" under expanded group)
  onAddGroup, // (groups only — contextual "+ קבוצה" under expanded group)
  onAddItemBelow,
  onAddGroupBelow,
  onMoveTo,
  onPreview, // (node) → opens item / group preview
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.25 : 1,
  };

  const isGroup = node.kind === 'group';
  const isFolderRef = node.kind === 'folderRef';
  const isContainer = isGroup || isFolderRef;
  const isCheckpoint = !!node.checkpointAfter;

  const item =
    node.kind === ITEM_KINDS.CONTENT
      ? node.contentItem
      : node.kind === ITEM_KINDS.QUESTION
      ? node.questionItem
      : null;
  const title = isGroup
    ? node.groupTitle || '(ללא שם)'
    : isFolderRef
    ? node.bankFolder?.name || '(תיקייה נמחקה)'
    : item?.title || '(פריט נמחק)';

  const kindLabel = isGroup
    ? 'קבוצה'
    : isFolderRef
    ? 'תיקייה מהבנק'
    : ITEM_KIND_LABELS[node.kind];
  const kindBadgeCls = isGroup
    ? 'bg-purple-100 text-purple-800 border border-purple-200'
    : isFolderRef
    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
    : node.kind === ITEM_KINDS.QUESTION
    ? 'bg-amber-100 text-amber-800'
    : 'bg-blue-100 text-blue-800';

  // Three tiers of row styling. Groups (purple) are admin-defined
  // containers. folderRefs (emerald) are LIVE links to bank folders
  // — visually distinct so admins immediately read "this isn't a
  // local container, the source of truth is in the bank". Items are
  // flat. Selected wins either way.
  const rowCls = [
    'group flex items-start gap-2 py-1.5 ps-2 pe-2 rounded-md transition cursor-pointer relative',
    isSelected
      ? 'bg-blue-50 ring-1 ring-blue-300'
      : isGroup
      ? 'bg-purple-50/80 hover:bg-purple-100/70'
      : isFolderRef
      ? 'bg-emerald-50/80 hover:bg-emerald-100/70'
      : 'hover:bg-gray-50',
    dropHint === 'inside' ? 'ring-2 ring-blue-400 bg-blue-50' : '',
  ]
    .filter(Boolean)
    .join(' ');

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
        className={rowCls}
        style={{
          marginInlineStart: depth * 20,
          // Colored leading-edge bar for containers — reads as
          // "structural element". Purple for groups, emerald for the
          // bank-linked folderRef.
          ...(isGroup
            ? {
                borderInlineStart: '3px solid rgb(168 85 247)',
                paddingInlineStart: 8,
              }
            : isFolderRef
            ? {
                borderInlineStart: '3px solid rgb(16 185 129)',
                paddingInlineStart: 8,
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
          className="shrink-0 w-5 h-6 flex items-center justify-center text-gray-400 hover:text-gray-700 cursor-grab active:cursor-grabbing mt-0.5"
          style={{ touchAction: 'none' }}
        >
          <span className="font-mono text-[11px] leading-none">⋮⋮</span>
        </button>

        {/* Collapse chevron for containers (groups and folderRefs) */}
        {isContainer ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            aria-label={isCollapsed ? 'הצג תוכן' : 'קפל'}
            className={`shrink-0 w-6 h-6 flex items-center justify-center rounded mt-0.5 ${
              isFolderRef
                ? 'text-emerald-700 hover:bg-emerald-200/70'
                : 'text-purple-700 hover:bg-purple-200/70'
            }`}
          >
            <span
              className="text-[13px]"
              style={{
                display: 'inline-block',
                transform: isCollapsed ? 'rotate(-90deg)' : 'none',
                transition: 'transform 0.12s',
              }}
            >
              ▼
            </span>
          </button>
        ) : (
          <span className="shrink-0 w-6" aria-hidden />
        )}

        {/* Type badge */}
        <span
          className={`shrink-0 mt-1 text-[10px] px-1.5 py-0.5 rounded leading-tight ${kindBadgeCls}`}
        >
          {kindLabel}
        </span>

        {/* Title (editable for groups, static for items / folderRefs).
            Item titles may contain HTML (dynamic-field chips) — render via
            dangerouslySetInnerHTML with the shared .gos-prose class.
            folderRef titles come from the bank — read-only here, edit in
            the bank to rename. */}
        {isGroup ? (
          <input
            value={node.groupTitle || ''}
            onChange={(e) => onUpdate({ groupTitle: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            placeholder="שם הקבוצה"
            className="flex-1 min-w-0 text-[15px] font-semibold text-gray-900 bg-transparent border-0 focus:outline-none focus:bg-white focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5"
          />
        ) : isFolderRef ? (
          <span
            className="flex-1 min-w-0 text-[15px] font-semibold text-emerald-900 leading-relaxed pt-0.5 truncate"
            title="שם התיקייה נשלט מהבנק. לעריכה — פתחו את התיקייה בלשונית 'בנק פריטים'."
          >
            📁 {title}
          </span>
        ) : isHtmlTitle(title) ? (
          <span
            className="gos-prose flex-1 min-w-0 text-sm text-gray-900 leading-relaxed pt-0.5"
            style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
            dir="rtl"
            dangerouslySetInnerHTML={{ __html: title }}
          />
        ) : (
          <span
            className="flex-1 min-w-0 text-sm text-gray-900 leading-relaxed pt-0.5"
            style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
          >
            {titleToPlain(title) || title}
          </span>
        )}

        {/* Preview eye — available for items and groups. Groups preview
            shows the group's items in reading order. */}
        {onPreview && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPreview(node);
            }}
            className="shrink-0 mt-0.5 text-gray-500 hover:text-blue-700 hover:bg-blue-50 rounded p-1"
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
          </button>
        )}

        {/* Read-only checkpoint indicator (toggle lives in the menu) */}
        {isCheckpoint && (
          <span
            className="shrink-0 mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-purple-700 bg-purple-100 border border-purple-200 rounded px-1.5 py-0.5"
            title="נקודת ביקורת — הלומד ימתין לאישור לפני המשך"
          >
            <span aria-hidden>⚑</span>
            <span className="hidden sm:inline">ביקורת</span>
          </span>
        )}

        {/* Single secondary-actions menu */}
        <RowMenu
          isCheckpoint={isCheckpoint}
          onMoveTo={onMoveTo}
          onAddItemBelow={onAddItemBelow}
          onAddGroupBelow={onAddGroupBelow}
          onToggleCheckpoint={() =>
            onUpdate({ checkpointAfter: !isCheckpoint })
          }
          onRemove={onRemove}
          isGroup={isGroup}
        />
      </div>

      {/* Expanded group: contextual add buttons under its children */}
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

      {/* Expanded folderRef: read-only nested preview of bank contents.
          The admin needs to see what's inside without bouncing back to
          the bank tab. Bank is the source of truth — this view is
          informational only, no inline editing here. */}
      {isFolderRef && !isCollapsed && (
        <FolderRefPreview
          bankFolderId={node.bankFolderId}
          depth={depth + 1}
        />
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

function RowMenu({
  isCheckpoint,
  onMoveTo,
  onAddItemBelow,
  onAddGroupBelow,
  onToggleCheckpoint,
  onRemove,
  isGroup,
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (btnRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      className="relative shrink-0 mt-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={btnRef}
        type="button"
        aria-label="פעולות נוספות"
        title="פעולות נוספות"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-7 h-7 shrink-0 rounded text-[14px] flex items-center justify-center transition text-gray-500 hover:bg-gray-200 hover:text-gray-800"
      >
        ⋯
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          dir="rtl"
          className="absolute top-full end-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg py-1 z-30 min-w-[200px] text-[13px]"
        >
          <MenuItem
            onClick={() => {
              setOpen(false);
              onMoveTo();
            }}
          >
            העבר אל...
          </MenuItem>
          <MenuDivider />
          <MenuItem
            onClick={() => {
              setOpen(false);
              onAddItemBelow();
            }}
          >
            + פריט מתחת
          </MenuItem>
          <MenuItem
            onClick={() => {
              setOpen(false);
              onAddGroupBelow();
            }}
          >
            + קבוצה מתחת
          </MenuItem>
          <MenuDivider />
          <MenuItem
            onClick={() => {
              setOpen(false);
              onToggleCheckpoint();
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={isCheckpoint ? 'text-purple-600' : 'text-gray-400'}
              >
                ⚑
              </span>
              {isCheckpoint ? 'בטל נקודת ביקורת' : 'סמן נקודת ביקורת'}
            </span>
          </MenuItem>
          <MenuDivider />
          <MenuItem
            danger
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            {isGroup ? 'מחק קבוצה' : 'מחק פריט'}
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, danger }) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={onClick}
      className={`w-full text-right px-3 py-1.5 transition ${
        danger ? 'text-red-600 hover:bg-red-50' : 'hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

function MenuDivider() {
  return <div className="h-px bg-gray-100 my-1" aria-hidden />;
}

function isHtmlTitle(s) {
  return typeof s === 'string' && /<[a-z]/i.test(s);
}

// ── FolderRefPreview ─────────────────────────────────────────────
//
// Read-only nested preview of a bank folder's contents — shown when
// a folderRef row is expanded. Pulls the recursive tree from the
// server (`api.folders.contents(id)`) so the rendering reflects the
// CURRENT bank state (the source of truth). No DnD here — admins
// edit folder structure in the bank tab.
function FolderRefPreview({ bankFolderId, depth }) {
  const [state, setState] = useState({ phase: 'loading' });

  useEffect(() => {
    if (!bankFolderId) {
      setState({ phase: 'missing' });
      return;
    }
    let cancelled = false;
    setState({ phase: 'loading' });
    (async () => {
      try {
        const data = await api.folders.contents(bankFolderId);
        if (cancelled) return;
        setState({ phase: 'ready', data });
      } catch (e) {
        if (!cancelled)
          setState({ phase: 'error', message: e?.message || 'שגיאה' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bankFolderId]);

  if (!bankFolderId || state.phase === 'missing') {
    return (
      <div
        style={{ marginInlineStart: depth * 20 }}
        className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 my-1"
      >
        התיקייה המקושרת אינה קיימת יותר בבנק.
      </div>
    );
  }
  if (state.phase === 'loading') {
    return (
      <div
        style={{ marginInlineStart: depth * 20 }}
        className="text-[11px] text-gray-500 italic px-2 py-1"
      >
        טוען תוכן תיקייה…
      </div>
    );
  }
  if (state.phase === 'error') {
    return (
      <div
        style={{ marginInlineStart: depth * 20 }}
        className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 my-1"
      >
        טעינת תוכן התיקייה נכשלה: {state.message}
      </div>
    );
  }

  const { children } = state.data;
  if (!children || children.length === 0) {
    return (
      <div
        style={{ marginInlineStart: depth * 20 }}
        className="text-[11px] text-gray-500 italic bg-emerald-50/40 border border-emerald-200 rounded px-2 py-1 my-1"
      >
        התיקייה ריקה. ניתן להוסיף פריטים בלשונית "בנק פריטים".
      </div>
    );
  }
  return (
    <div className="my-1">
      {children.map((c) => (
        <FolderRefPreviewRow key={`${c.kind}:${c.id}`} entry={c} depth={depth} />
      ))}
      <div
        style={{ marginInlineStart: depth * 20 }}
        className="text-[10px] text-emerald-700/70 italic px-2 py-0.5"
      >
        תצוגה לקריאה בלבד — עריכה מתבצעת בבנק.
      </div>
    </div>
  );
}

function FolderRefPreviewRow({ entry, depth }) {
  if (entry.kind === 'folder') {
    return (
      <>
        <div
          style={{ marginInlineStart: depth * 20 }}
          className="flex items-center gap-2 px-2 py-1 text-[12px] text-emerald-900"
        >
          <span aria-hidden>📁</span>
          <span className="font-medium truncate">{entry.name}</span>
        </div>
        {(entry.children || []).map((c) => (
          <FolderRefPreviewRow
            key={`${c.kind}:${c.id}`}
            entry={c}
            depth={depth + 1}
          />
        ))}
      </>
    );
  }
  const badgeCls =
    entry.kind === 'question'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-blue-100 text-blue-800';
  const label = entry.kind === 'question' ? 'שאלה' : 'תוכן';
  const titleHtml = typeof entry.title === 'string' && /<[a-z]/i.test(entry.title);
  return (
    <div
      style={{ marginInlineStart: depth * 20 }}
      className="flex items-center gap-2 px-2 py-1 text-[12px] text-gray-800"
    >
      <span className={`text-[10px] px-1.5 py-0.5 rounded ${badgeCls}`}>
        {label}
      </span>
      {titleHtml ? (
        <span
          className="gos-prose flex-1 min-w-0 truncate"
          dir="rtl"
          dangerouslySetInnerHTML={{ __html: entry.title }}
        />
      ) : (
        <span className="flex-1 min-w-0 truncate">
          {titleToPlain(entry.title) || '(ללא כותרת)'}
        </span>
      )}
    </div>
  );
}
