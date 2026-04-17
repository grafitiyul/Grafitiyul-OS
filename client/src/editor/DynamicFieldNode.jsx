import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes, InputRule, PasteRule } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { getDynamicFieldByKey } from '../lib/dynamicFields.js';

// Inline atom node representing a dynamic field token like {{first_name}}.
//
// Source of truth: the stable `fieldKey` attribute. The display label is
// looked up at render time from the registry — renaming a label in the
// registry never changes saved content.
//
// Clicking a chip opens a small inline menu that lets the user convert it
// back to raw `{{key}}` text or remove it outright.

export const DynamicFieldNode = Node.create({
  name: 'dynamicField',

  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      fieldKey: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-field-key'),
        renderHTML: (attrs) => {
          if (!attrs.fieldKey) return {};
          return { 'data-field-key': attrs.fieldKey };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="dynamic-field"]',
        getAttrs: (el) => {
          const key = el.getAttribute('data-field-key');
          return key ? { fieldKey: key } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const key = node.attrs.fieldKey;
    const field = getDynamicFieldByKey(key);
    const label = field?.label || `{{${key}}}`;
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'dynamic-field' }),
      label,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChipView);
  },

  addCommands() {
    return {
      insertDynamicField:
        (fieldKey) =>
        ({ commands }) => {
          if (!fieldKey) return false;
          return commands.insertContent({
            type: this.name,
            attrs: { fieldKey },
          });
        },
    };
  },

  // Custom InputRule rather than nodeInputRule: we must consume the full
  // `{{...}}` match including the surrounding braces. nodeInputRule would
  // leave the braces outside the replacement.
  addInputRules() {
    const type = this.type;
    return [
      new InputRule({
        find: /\{\{([a-z][a-z0-9_]*)\}\}$/,
        handler: ({ state, range, match }) => {
          const fieldKey = match[1];
          if (!fieldKey) return null;
          state.tr.replaceWith(range.from, range.to, type.create({ fieldKey }));
        },
      }),
    ];
  },

  addPasteRules() {
    const type = this.type;
    return [
      new PasteRule({
        find: /\{\{([a-z][a-z0-9_]*)\}\}/g,
        handler: ({ state, range, match }) => {
          const fieldKey = match[1];
          if (!fieldKey) return null;
          state.tr.replaceWith(range.from, range.to, type.create({ fieldKey }));
        },
      }),
    ];
  },
});

function ChipView({ node, editor, getPos }) {
  const key = node.attrs.fieldKey;
  const field = getDynamicFieldByKey(key);
  const known = !!field;
  const label = field?.label;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e) {
      if (menuRef.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      setMenuOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  function convertToText(e) {
    e?.preventDefault();
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (typeof pos !== 'number') return;
    const from = pos;
    const to = pos + node.nodeSize;
    // Delete the chip, then drop in the raw `{{key}}` text at the same
    // position. Programmatic insertContent doesn't trigger input rules,
    // so the text stays as text.
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .deleteRange({ from, to })
      .insertContentAt(from, `{{${key}}}`)
      .run();
    setMenuOpen(false);
  }

  function removeChip(e) {
    e?.preventDefault();
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (typeof pos !== 'number') return;
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run();
    setMenuOpen(false);
  }

  const tooltip = known
    ? `${field.description ? field.description + ' — ' : ''}{{${key}}}`
    : `שדה לא מוכר: {{${key}}}`;

  return (
    <NodeViewWrapper
      as="span"
      dir="rtl"
      contentEditable={false}
      data-type="dynamic-field"
      data-field-key={key || ''}
      className={`relative inline-flex items-center gap-1 rounded-md px-2 py-0.5 mx-0.5 text-[0.9em] select-none align-baseline border transition-colors ${
        known
          ? 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200'
          : 'bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200'
      }`}
      title={tooltip}
    >
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        onMouseDown={(e) => {
          e.preventDefault();
          setMenuOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setMenuOpen((v) => !v);
          }
        }}
        className="cursor-pointer flex items-center gap-1"
      >
        <span aria-hidden="true" className="text-[0.85em] opacity-70">
          {known ? '✦' : '⚠'}
        </span>
        <span>{known ? label : `{{${key}}}`}</span>
      </span>
      {menuOpen && (
        <span
          ref={menuRef}
          dir="rtl"
          contentEditable={false}
          role="menu"
          className="absolute top-full start-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg py-1 z-30 min-w-[160px] flex flex-col text-[13px] font-normal text-gray-800"
        >
          <button
            role="menuitem"
            type="button"
            onMouseDown={convertToText}
            className="w-full text-right px-3 py-1.5 hover:bg-gray-50"
          >
            המר לטקסט
          </button>
          <button
            role="menuitem"
            type="button"
            onMouseDown={removeChip}
            className="w-full text-right px-3 py-1.5 hover:bg-red-50 text-red-600"
          >
            הסר
          </button>
        </span>
      )}
    </NodeViewWrapper>
  );
}
