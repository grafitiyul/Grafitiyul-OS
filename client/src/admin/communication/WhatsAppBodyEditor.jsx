import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { DynamicFieldNode } from '../../editor/DynamicFieldNode.jsx';
import EmojiButton from '../../editor/EmojiButton.jsx';
import { htmlToWhatsApp, whatsAppTextPreview } from '../../../../shared/waMarkup.mjs';
import { normalizeTokensToChips } from '../../../../shared/variableTokens.mjs';
import { getDynamicFieldByKey } from '../../lib/dynamicFields.js';

// Hydration normalization — stored/AI/legacy content may carry recognized raw
// {{tokens}} as plain text; TipTap's input/paste rules only fire on typing, so
// convert to canonical chip spans BEFORE setContent. Unknown keys stay raw and
// render as the amber warning chip via the paste rule when typed, or as text.
const chipLabel = (key) => getDynamicFieldByKey(key)?.label || null;
const normalizeIncoming = (html) => normalizeTokensToChips(html || '', chipLabel);
import VariableMenu from './VariableMenu.jsx';
import '../../editor/editor.css';

// The Communication Center WhatsApp editor — a genuinely rich editor whose
// capability set is EXACTLY what the bridge can transmit: bold / italic /
// strikethrough, lists, line breaks, links-as-text, emojis, variable chips.
// The same shared serializer (shared/waMarkup.mjs) drives this live preview
// AND the server's send-time conversion, so what the author sees is what
// WhatsApp receives — no invented syntax, no drift.

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// WhatsApp markup → styled preview HTML (bubble). Tokens render as chips.
export function waPreviewHtml(markup) {
  let out = esc(markup);
  out = out.replace(/```([\s\S]+?)```/g, '<code class="rounded bg-black/10 px-1">$1</code>');
  out = out.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
  out = out.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  out = out.replace(/~([^~\n]+)~/g, '<s>$1</s>');
  out = out.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (m, key) => {
    const f = getDynamicFieldByKey(key);
    return `<span class="mx-0.5 inline-flex items-center rounded bg-blue-100 px-1 text-[0.85em] font-medium text-blue-800">${esc(f?.label || key)}</span>`;
  });
  out = out.replace(/(https?:\/\/[^\s<]+)/g, '<span class="text-sky-700 underline">$1</span>');
  return out.replace(/\n/g, '<br>');
}

export default function WhatsAppBodyEditor({
  value, onChange, variables, categories, onInsertDocument, documents, showVariableKeys = true,
}) {
  const editorRef = useRef(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder: 'כתבו כאן את נוסח ההודעה…' }),
      DynamicFieldNode,
    ],
    content: normalizeIncoming(value),
    editorProps: {
      attributes: {
        dir: 'rtl',
        class: 'rt-editor-prose focus:outline-none px-3 py-2.5 min-h-[140px] text-[14px]',
      },
    },
    onUpdate: ({ editor: e }) => onChange?.(e.getHTML()),
  });
  editorRef.current = editor;

  // External value replacement (language tab switch) without clobbering typing.
  useEffect(() => {
    if (!editor) return;
    const incoming = normalizeIncoming(value);
    const current = editor.getHTML();
    if (incoming !== current && !editor.isFocused) {
      editor.commands.setContent(incoming, false);
    }
  }, [value, editor]);

  const markup = htmlToWhatsApp(editor?.getHTML() || value || '');
  const chars = whatsAppTextPreview(markup).length;

  const Btn = ({ onClick, active, title, children }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`rounded-md px-2 py-1 text-[13px] leading-none transition-colors ${
        active ? 'bg-emerald-100 text-emerald-800' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div dir="rtl" className="grid gap-4 lg:grid-cols-2">
      {/* editor */}
      <div className="rounded-xl border border-gray-300 bg-white focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-100">
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1.5 rounded-t-xl">
          <Btn title="מודגש" active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()}><strong>B</strong></Btn>
          <Btn title="נטוי" active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()}><em>I</em></Btn>
          <Btn title="קו חוצה" active={editor?.isActive('strike')} onClick={() => editor?.chain().focus().toggleStrike().run()}><s>S</s></Btn>
          <span className="mx-1 h-4 w-px bg-gray-200" />
          <Btn title="רשימה" active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()}>•≡</Btn>
          <Btn title="רשימה ממוספרת" active={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1≡</Btn>
          <span className="mx-1 h-4 w-px bg-gray-200" />
          {editor && <EmojiButton editor={editor} placement="down" />}
          <span className="mx-1 h-4 w-px bg-gray-200" />
          <VariableMenu variables={variables} categories={categories} editorRef={editorRef} showKeys={showVariableKeys} />
          {onInsertDocument && (
            <button
              type="button"
              onClick={onInsertDocument}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-gray-700 hover:bg-gray-50"
            >
              📎 הוסף מסמך
            </button>
          )}
        </div>
        <EditorContent editor={editor} />
        <div className="flex items-center justify-between border-t border-gray-100 px-3 py-1.5 text-[11px] text-gray-400">
          <span>עיצוב נתמך: מודגש · נטוי · קו חוצה · רשימות · אימוג׳י · משתנים</span>
          <span dir="ltr">{chars} תווים</span>
        </div>
      </div>

      {/* WhatsApp-style live preview — the same serializer the server sends with */}
      <div className="flex flex-col rounded-xl border border-gray-200 bg-[#efe7dd] p-3"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.035) 1px, transparent 0)', backgroundSize: '14px 14px' }}>
        <div className="mb-2 text-center text-[10.5px] font-medium text-gray-500">תצוגה מקדימה — כפי שיישלח ב-WhatsApp</div>
        <div className="flex-1">
          <div className="mr-auto max-w-[92%] rounded-xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 shadow-sm">
            {(documents || []).filter((d) => d.mode !== 'link').map((d) => (
              <div key={d.kind} className="mb-2 flex items-center gap-2 rounded-lg bg-white/70 px-2.5 py-2 text-[12px] text-gray-700">
                <span className="text-[17px]">📄</span>
                <span className="min-w-0 flex-1 truncate font-medium">{d.labelHe}</span>
                <span className="text-[10px] text-gray-400">PDF</span>
              </div>
            ))}
            {markup ? (
              <div
                className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-gray-900"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: waPreviewHtml(markup) }}
              />
            ) : (
              <div className="text-[13px] text-gray-400">ההודעה תוצג כאן…</div>
            )}
            <div className="mt-1 text-left text-[10px] text-gray-400">
              {new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })} ✓✓
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
