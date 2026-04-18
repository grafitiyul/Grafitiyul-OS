import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import Highlight from '@tiptap/extension-highlight';
import { useEffect, useState } from 'react';
import { DynamicFieldNode } from './DynamicFieldNode.jsx';
import { FontSize } from './FontSize.js';
import { MediaImage } from './MediaImage.jsx';
import { MediaVideo } from './MediaVideo.jsx';
import Toolbar from './Toolbar.jsx';
import UploadBanner from './UploadBanner.jsx';
import { sanitizePastedHtml } from './pasteSanitizer.js';
import './editor.css';

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

function normaliseIncoming(raw) {
  if (!raw) return '';
  if (/<[a-z][a-z0-9]*[\s>/]/i.test(raw)) return raw;
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
  placeholder = 'כתבו כאן תוכן...',
  minContentHeight = 200,
  maxHeight = '60vh',
}) {
  const [uploadState, setUploadState] = useState({ phase: 'idle' });
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
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
        emptyNodeClass: 'is-empty',
        showOnlyCurrent: false,
      }),
      TextStyle,
      Color,
      FontFamily.configure({ types: ['textStyle'] }),
      FontSize,
      Highlight.configure({ multicolor: true }),
      MediaImage.configure({ inline: false, allowBase64: false }),
      MediaVideo,
      DynamicFieldNode,
    ],
    content: normaliseIncoming(value),
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange?.(isEmptyHtml(html) ? '' : html);
    },
    editorProps: {
      transformPastedHTML: sanitizePastedHtml,
      attributes: {
        class: 'rt-editor-prose',
        dir: 'rtl',
        'aria-label': ariaLabel || 'עורך תוכן',
      },
    },
  });

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
        style={{ minHeight: minContentHeight }}
      >
        טוען עורך…
      </div>
    );
  }

  return (
    <div
      className="rt-editor-shell border border-gray-300 rounded-md bg-white focus-within:ring-2 focus-within:ring-blue-200 focus-within:border-blue-400 flex flex-col"
      style={{ maxHeight }}
    >
      {/* Upload feedback — visible only during / after an upload. */}
      <UploadBanner
        state={uploadState}
        onDismiss={() => setUploadState({ phase: 'idle' })}
        onCancel={uploadState?.cancel}
      />
      {/* Content area — grows with content, scrolls internally when it exceeds maxHeight */}
      <div
        className="rt-editor-scroll flex-1 overflow-y-auto overflow-x-hidden px-3 py-2"
        style={{ minHeight: minContentHeight }}
        onClick={() => editor.chain().focus().run()}
      >
        <EditorContent editor={editor} />
      </div>
      {/* Toolbar pinned at the bottom of the widget, always visible */}
      <div className="rt-editor-toolbar-wrap shrink-0 border-t border-gray-200">
        <Toolbar editor={editor} setUploadState={setUploadState} />
      </div>
    </div>
  );
}
