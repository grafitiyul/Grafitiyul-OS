import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import { TextDirection } from './TextDirection.js';
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
import { MediaEmbed } from './MediaEmbed.jsx';
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
  // Presentation tone only (does NOT change capabilities). 'default' = the white
  // form look used everywhere; 'note' = warm-yellow so the composer/edit surface
  // feels like the same sticky-note object as a saved note.
  tone = 'default',
  // Composer mode: start compact (~2 lines) with the toolbar HIDDEN; on focus,
  // expand (~3 lines) and reveal the toolbar. Content still auto-grows with what
  // is typed. Editor capabilities are unchanged — only the chrome is progressive.
  // Off by default, so every existing consumer is unaffected.
  collapsible = false,
}) {
  const [focused, setFocused] = useState(false);
  const noteTone = tone === 'note';
  const shellTone = noteTone
    ? 'border-amber-200 bg-amber-50 focus-within:ring-amber-200 focus-within:border-amber-300'
    : 'border-gray-300 bg-white focus-within:ring-blue-200 focus-within:border-blue-400';
  const toolbarBorder = noteTone ? 'border-amber-200' : 'border-gray-200';
  // Collapsible composer heights: a compact ~3-line collapsed note, expanding to
  // a comfortable editing area on focus (then auto-grows with text).
  const contentMin = collapsible ? (focused ? 110 : 84) : minContentHeight;
  const showToolbar = !collapsible || focused;
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
      // Writing direction (RTL/LTR) per block — kept separate from alignment.
      TextDirection,
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
      MediaEmbed,
      DynamicFieldNode,
    ],
    content: normaliseIncoming(value),
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange?.(isEmptyHtml(html) ? '' : html);
    },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
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
      className={`rt-editor-shell border rounded-md focus-within:ring-2 ${shellTone} flex flex-col ${
        collapsible ? 'rt-editor-compact' : ''
      }`}
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
        className={`rt-editor-scroll flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 ${
          collapsible ? 'transition-[min-height] duration-150 ease-out' : ''
        }`}
        style={{ minHeight: contentMin }}
        onClick={() => editor.chain().focus().run()}
      >
        <EditorContent editor={editor} />
      </div>
      {/* Toolbar pinned at the bottom. In collapsible (composer) mode it appears
          only while the editor is focused — the full editor is otherwise intact. */}
      {showToolbar && (
        <div className={`rt-editor-toolbar-wrap shrink-0 border-t ${toolbarBorder}`}>
          <Toolbar editor={editor} setUploadState={setUploadState} />
        </div>
      )}
    </div>
  );
}
