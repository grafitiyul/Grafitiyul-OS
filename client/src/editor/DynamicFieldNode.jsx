import { Node, mergeAttributes, InputRule, PasteRule } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { getDynamicFieldByKey } from '../lib/dynamicFields.js';

// Inline atom node representing a dynamic field token like {{first_name}}.
//
// Source of truth: the stable `fieldKey` attribute. The display label is
// looked up at render time from the registry — renaming a label in the
// registry never changes saved content.
//
// Raw token form: users may type or paste `{{key}}` and an input/paste
// rule promotes it to this node. The user never sees the raw token in
// the editor after promotion.
//
// Serialised form (HTML saved to DB):
//   <span data-type="dynamic-field" data-field-key="first_name">שם פרטי</span>
// The text inside is the label at serialisation time — human-readable
// fallback only; the fieldKey is still the source of truth on parse.

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

  // Custom InputRule rather than nodeInputRule, because nodeInputRule
  // replaces only the capture-group range — it leaves the `{{` and `}}`
  // outside the replacement. We need to consume the entire match.
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

function ChipView({ node }) {
  const key = node.attrs.fieldKey;
  const field = getDynamicFieldByKey(key);
  const known = !!field;
  const label = field?.label;
  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      dir="rtl"
      data-type="dynamic-field"
      data-field-key={key || ''}
      title={`{{${key}}}`}
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 mx-0.5 text-[0.9em] select-none align-baseline border ${
        known
          ? 'bg-blue-100 text-blue-800 border-blue-200'
          : 'bg-amber-100 text-amber-900 border-amber-300'
      }`}
    >
      <span aria-hidden="true" className="text-[0.85em] opacity-70">✦</span>
      <span>{known ? label : `{{${key}}}`}</span>
    </NodeViewWrapper>
  );
}
