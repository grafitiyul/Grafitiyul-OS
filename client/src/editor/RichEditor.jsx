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
import { useEffect, useRef, useState } from 'react';
import { Slice, Fragment } from '@tiptap/pm/model';
import { plainTextToParagraphs } from './pastePlainText.js';
import { DynamicFieldNode } from './DynamicFieldNode.jsx';
import { FontSize } from './FontSize.js';
import { MediaImage } from './MediaImage.jsx';
import { MediaVideo } from './MediaVideo.jsx';
import { MediaEmbed } from './MediaEmbed.jsx';
import Toolbar, { TOOLBAR_PRESETS } from './Toolbar.jsx';
import { EDITOR_PRESETS } from './editorPresets.js';
import { splitImageFiles, isImageFilePaste, uploadImagesIntoEditor } from './imageDropPaste.js';
import UploadBanner from './UploadBanner.jsx';
import { sanitizePastedHtml } from './pasteSanitizer.js';
import './editor.css';

// Opt-in live paste diagnostics — set `localStorage.gos_paste_debug = '1'` in
// DevTools (any environment, production included), paste, and read
// `window.__gosPasteDebug` / the `[gos-paste-debug]` console records. Each
// record captures the pipeline stage-by-stage: raw clipboard text/html +
// text/plain → sanitizer output → the ProseMirror doc JSON → the editor DOM.
// Zero effect when the flag is off.
function pasteDebugOn() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('gos_paste_debug') === '1';
  } catch {
    return false;
  }
}

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
  // Standardized editor role — resolves default chrome from EDITOR_PRESETS
  // ('full' | 'lite' | 'note'). The explicit props below still override, so a
  // screen can tweak one default without forking behavior. Default 'full'.
  preset = 'full',
  // Presentation tone only (does NOT change capabilities). 'default' = the white
  // form look used everywhere; 'note' = warm-yellow so the composer/edit surface
  // feels like the same sticky-note object as a saved note. Overrides the preset.
  tone,
  // Composer mode: start compact (~2 lines) with the toolbar HIDDEN; on focus,
  // expand (~3 lines) and reveal the toolbar. Content still auto-grows with what
  // is typed. Editor capabilities are unchanged — only the chrome is progressive.
  // Off by default, so every existing consumer is unaffected.
  collapsible = false,
  // Toolbar variant: 'full' (every tool) or 'lite' (a deliberately minimal set:
  // bold · underline · highlight · emoji · font size). Overrides the preset. The
  // editor instance is identical; only the chrome differs.
  toolbar,
  // Optional: receive the TipTap editor instance once created (see effect below).
  onEditorReady,
}) {
  const [focused, setFocused] = useState(false);
  // Resolve preset defaults, letting any explicit prop win.
  const presetCfg = EDITOR_PRESETS[preset] || EDITOR_PRESETS.full;
  const effTone = tone ?? presetCfg.tone ?? 'default';
  const effToolbar = toolbar ?? presetCfg.toolbar ?? 'full';
  // Typography rhythm of this surface (see pastePlainText.js): 'tight' =
  // zero paragraph margins (note face). A collapsible composer is always the
  // note face; the note preset is tight even when not collapsible (NoteCard's
  // edit mode must match the tight display it round-trips with — editing and
  // display parity). Paste normalisation maps blank lines per this rhythm.
  const rhythm = collapsible || presetCfg.rhythm === 'tight' ? 'tight' : 'spaced';
  const noteTone = effTone === 'note';
  const shellTone = noteTone
    ? 'border-amber-200 bg-amber-50 focus-within:ring-amber-200 focus-within:border-amber-300'
    : 'border-gray-300 bg-white focus-within:ring-blue-200 focus-within:border-blue-400';
  const toolbarBorder = noteTone ? 'border-amber-200' : 'border-gray-200';
  // Collapsible composer heights: a compact ~3-line collapsed note, expanding to
  // a comfortable editing area on focus (then auto-grows with text).
  const contentMin = collapsible ? (focused ? 110 : 84) : minContentHeight;
  const showToolbar = !collapsible || focused;
  const [uploadState, setUploadState] = useState({ phase: 'idle' });
  // Direct image drop/paste is a capability, not chrome: it exists exactly
  // where the toolbar's image button exists. A 'lite' editor (no image tool)
  // must not gain a hidden upload path through drag-and-drop.
  const canUploadImages = (TOOLBAR_PRESETS[effToolbar] || TOOLBAR_PRESETS.full)
    .flat()
    .includes('image');
  // Handlers below are created once (useEditor config is not re-built), so
  // they reach the live editor instance through a ref. Same for the rhythm —
  // constant in practice, but read through a ref so the paste hooks always see
  // the current value.
  const editorRef = useRef(null);
  const rhythmRef = useRef(rhythm);
  rhythmRef.current = rhythm;
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
    // Flush-on-blur: emit the live editor HTML one last time when focus leaves.
    // onUpdate already fires per keystroke, but a Save button click blurs the
    // editor first — this guarantees the parent's saved value reflects the very
    // latest content before any save handler that runs after the blur reads it.
    onBlur: ({ editor }) => {
      setFocused(false);
      const html = editor.getHTML();
      onChange?.(isEmptyHtml(html) ? '' : html);
    },
    editorProps: {
      // Paste diagnostics (opt-in, see pasteDebugOn above). Never consumes the
      // event — capture only.
      handleDOMEvents: {
        paste: (_view, event) => {
          if (!pasteDebugOn()) return false;
          const rec = {
            at: new Date().toISOString(),
            rhythm: rhythmRef.current,
            clipboardHtml: event.clipboardData?.getData('text/html') ?? null,
            clipboardText: event.clipboardData?.getData('text/plain') ?? null,
          };
          (window.__gosPasteDebug = window.__gosPasteDebug || []).push(rec);
          setTimeout(() => {
            const ed = editorRef.current;
            rec.docJson = ed?.getJSON?.();
            rec.docHtml = ed?.getHTML?.();
            rec.editorDom = ed?.view?.dom?.innerHTML ?? null;
            // eslint-disable-next-line no-console
            console.log('[gos-paste-debug]', rec);
          }, 0);
          return false;
        },
      },
      // Both paste paths run the canonical rhythm-aware structure contract
      // (pastePlainText.js): the pasted content must render on THIS surface
      // with the line/blank-line structure the author saw at the source.
      transformPastedHTML: (html) => {
        const out = sanitizePastedHtml(html, rhythmRef.current);
        if (pasteDebugOn()) {
          const rec = (window.__gosPasteDebug || []).slice(-1)[0];
          if (rec) rec.sanitizedHtml = out;
        }
        return out;
      },
      // text/plain pastes (WhatsApp, Notepad, terminals…): ProseMirror's
      // default splits EVERY line into its own paragraph and drops blank
      // lines — a pasted message became one-paragraph-per-visual-line with no
      // paragraph structure. The canonical contract (pastePlainText.js):
      // single newline = soft break, blank lines per the surface rhythm,
      // edges trimmed.
      clipboardTextParser: (text, $context) => {
        const schema = $context.doc.type.schema;
        const paragraphs = plainTextToParagraphs(text, rhythmRef.current);
        const nodes = paragraphs.map((lines) => {
          const content = [];
          lines.forEach((line, i) => {
            if (i) content.push(schema.nodes.hardBreak.create());
            content.push(schema.text(line));
          });
          return schema.nodes.paragraph.create(null, Fragment.from(content));
        });
        // Open depth 1 so a single-paragraph paste merges inline at the cursor
        // instead of forcing a new block.
        return new Slice(Fragment.from(nodes), 1, 1);
      },
      // Dropping an image file uploads it through the SAME path as the toolbar
      // image button and inserts it at the drop position. Files that aren't
      // images are rejected with a visible banner — never silently.
      handleDrop: canUploadImages
        ? (view, event, _slice, moved) => {
            if (moved) return false; // internal drag of existing content
            const files = event.dataTransfer?.files;
            if (!files?.length) return false;
            event.preventDefault();
            const { images, others } = splitImageFiles(files);
            if (!images.length) {
              setUploadState({
                phase: 'error',
                error: 'ניתן לגרור לכאן קבצי תמונה בלבד (JPG / PNG / GIF / WEBP).',
              });
              return true;
            }
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
            uploadImagesIntoEditor({
              editor: editorRef.current,
              files: images,
              pos: coords?.pos ?? null,
              setUploadState,
              skippedCount: others.length,
            });
            return true;
          }
        : undefined,
      // Pasting a screenshot / copied image FILE uploads it the same way.
      // Pastes that also carry text/html (web pages, Word) keep the existing
      // sanitized-HTML paste path untouched.
      handlePaste: canUploadImages
        ? (_view, event) => {
            if (!isImageFilePaste(event.clipboardData)) return false;
            event.preventDefault();
            const { images } = splitImageFiles(event.clipboardData.files);
            uploadImagesIntoEditor({
              editor: editorRef.current,
              files: images,
              setUploadState,
            });
            return true;
          }
        : undefined,
      attributes: {
        class: 'rt-editor-prose',
        dir: 'rtl',
        'aria-label': ariaLabel || 'עורך תוכן',
      },
    },
  });
  editorRef.current = editor;

  // Expose the TipTap instance to the parent (additive; no consumer is
  // affected unless it passes the prop). Enables cursor-position insertion —
  // e.g. the pricing card's "insert variable" menu calling
  // editor.chain().focus().insertContent(...).
  useEffect(() => {
    if (editor) onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!editor) return;
    // Never overwrite the document while the user is typing. Under React 18
    // automatic batching the `value` prop can transiently lag the live editor
    // by one update; without this guard the effect would "resync" the editor
    // back to the stale prop with emitUpdate:false — silently dropping the last
    // keystrokes and, because no onChange fires, never telling the parent. Only
    // sync from props when focus is elsewhere (external change: reload, revert,
    // draft restore). Mirrors the proven guard in TitleEditor.
    if (editor.isFocused) return;
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
        rhythm === 'tight' ? 'rt-editor-compact' : ''
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
          <Toolbar editor={editor} setUploadState={setUploadState} preset={effToolbar} />
        </div>
      )}
    </div>
  );
}
