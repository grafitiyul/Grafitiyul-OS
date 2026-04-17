import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import { useEffect } from 'react';
import { DynamicFieldNode } from './DynamicFieldNode.jsx';
import Toolbar from './Toolbar.jsx';
import './editor.css';

// Treat these HTML forms as "no content" so the dirty check doesn't flip
// just because TipTap normalised an empty document.
function isEmptyHtml(html) {
  if (!html) return true;
  const stripped = html.replace(/\s+/g, '');
  return (
    stripped === '' ||
    stripped === '<p></p>' ||
    stripped === '<p><br></p>' ||
    stripped === '<p><br/></p>'
  );
}

// Promote plain-text stored content (from before the editor shipped) into a
// minimal HTML form that TipTap will render with preserved line breaks.
function normaliseIncoming(raw) {
  if (!raw) return '';
  if (/<[a-z][a-z0-9]*[\s>/]/i.test(raw)) return raw; // already HTML
  const esc = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const blocks = esc.split(/\n{2,}/).map((block) => {
    const withBreaks = block.split('\n').join('<br>');
    return `<p>${withBreaks}</p>`;
  });
  return blocks.join('');
}

export default function RichEditor({
  value,
  onChange,
  ariaLabel,
  minHeight = 220,
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      DynamicFieldNode,
    ],
    content: normaliseIncoming(value),
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange?.(isEmptyHtml(html) ? '' : html);
    },
    editorProps: {
      attributes: {
        class: 'rt-editor-prose',
        dir: 'rtl',
        'aria-label': ariaLabel || 'עורך תוכן',
      },
    },
  });

  // When the parent swaps to editing a different item, sync the editor
  // content. Passing `false` for emitUpdate prevents a spurious onChange
  // that would otherwise mark the form dirty.
  useEffect(() => {
    if (!editor) return;
    const incoming = normaliseIncoming(value);
    const current = editor.getHTML();
    if (incoming === current) return;
    if (isEmptyHtml(incoming) && isEmptyHtml(current)) return;
    editor.commands.setContent(incoming, false);
  }, [value, editor]);

  if (!editor) {
    return (
      <div
        className="border border-gray-300 rounded-md bg-white p-3 text-sm text-gray-500"
        style={{ minHeight }}
      >
        טוען עורך…
      </div>
    );
  }

  return (
    <div className="border border-gray-300 rounded-md bg-white focus-within:ring-2 focus-within:ring-blue-200 focus-within:border-blue-400">
      <Toolbar editor={editor} />
      <div className="px-3 py-2" style={{ minHeight }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
