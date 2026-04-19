import { useEditor, EditorContent } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Paragraph from '@tiptap/extension-paragraph';
import History from '@tiptap/extension-history';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect, useRef, useState } from 'react';
import { DynamicFieldNode } from './DynamicFieldNode.jsx';
import { sanitizePastedHtml } from './pasteSanitizer.js';
import { DYNAMIC_FIELDS } from '../lib/dynamicFields.js';
import './editor.css';

// Single-line TipTap editor for item titles. Supports only:
//   - plain text
//   - dynamic-field chips ({{field_key}} → DynamicFieldNode)
//
// No formatting marks (bold/italic/etc.), no lists, no media. Enter is
// intercepted so the title stays one line. The storage format is still HTML
// (so chips round-trip cleanly); plain-text titles are valid HTML with no
// surrounding <p>.

// Enforce a single paragraph: `Document` content spec is `paragraph` (exactly
// one), not `block+`. This is the canonical single-line TipTap recipe.
const SingleLineDocument = Document.extend({
  content: 'paragraph',
});

function htmlToPlain(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}

export default function TitleEditor({
  value,
  onChange,
  placeholder = 'כותרת',
  ariaLabel,
  autoFocus = false,
}) {
  const editor = useEditor({
    extensions: [
      SingleLineDocument,
      Paragraph,
      Text,
      History,
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
        emptyNodeClass: 'is-empty',
      }),
      DynamicFieldNode,
    ],
    content: normaliseTitleInput(value),
    editorProps: {
      attributes: {
        class: 'rt-title-input',
        dir: 'rtl',
        'aria-label': ariaLabel || placeholder,
      },
      // Single-line: Enter never inserts a hard break or a new paragraph.
      handleKeyDown(_view, event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          return true;
        }
        return false;
      },
      // Reuse the body-editor's paste sanitizer so Word / Docs pastes don't
      // bring in spurious formatting or Google Docs bold wrappers. Strip any
      // newline / paragraph breaks from pasted content (single-line).
      transformPastedHTML(html) {
        const sanitized = sanitizePastedHtml(html);
        return sanitized
          .replace(/<\/?p[^>]*>/gi, ' ')
          .replace(/<br\s*\/?>(\s)*/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      },
    },
    onUpdate({ editor }) {
      // Emit HTML so chips survive. Empty → empty string (not '<p></p>') so
      // server-side validation (title required) sees a real empty value.
      const html = editor.getHTML();
      onChange(isBlankHtml(html) ? '' : html);
    },
  });

  // Reset content when value changes from outside (e.g. draft restore).
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const incoming = normaliseTitleInput(value);
    if (current !== incoming && !editor.isFocused) {
      editor.commands.setContent(incoming, false);
    }
  }, [editor, value]);

  useEffect(() => {
    if (editor && autoFocus) editor.commands.focus();
  }, [editor, autoFocus]);

  function insertField(key) {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertContent({ type: 'dynamicField', attrs: { fieldKey: key } })
      .run();
  }

  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <EditorContent editor={editor} />
      </div>
      <FieldPickerButton onPick={insertField} />
    </div>
  );
}

// Opens a menu of available dynamic fields and inserts the picked key at
// the title's caret. Fixes the bug where the body editor's toolbar button
// inserted into the body even when the user's cursor was in the title.
function FieldPickerButton({ onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
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
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onMouseDown={(e) => {
          // Prevent the editor from losing focus so the field lands in the
          // title editor's caret position.
          e.preventDefault();
        }}
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] border border-gray-300 rounded px-2 py-0.5 text-gray-700 hover:bg-gray-50 font-mono"
        title="הוסף שדה דינמי"
        aria-label="הוסף שדה דינמי"
      >
        {'{'} {'}'}
      </button>
      {open && (
        <div
          className="absolute z-30 end-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[220px]"
          dir="rtl"
        >
          <div className="px-3 py-1 text-[10px] text-gray-500 uppercase tracking-wide">
            הוסף שדה דינמי
          </div>
          {DYNAMIC_FIELDS.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-500 italic">
              אין שדות זמינים.
            </div>
          ) : (
            DYNAMIC_FIELDS.map((f) => (
              <button
                key={f.key}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  onPick(f.key);
                }}
                className="w-full text-right px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2"
              >
                <span className="font-medium">{f.label}</span>
                <span className="text-[10px] text-gray-400 font-mono" dir="ltr">
                  {f.key}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Plain-text input → minimally valid HTML for TipTap's single-paragraph doc.
function normaliseTitleInput(raw) {
  if (raw == null || raw === '') return '';
  if (/<[a-z]/i.test(raw)) return raw;
  const esc = String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<p>${esc}</p>`;
}

function isBlankHtml(html) {
  if (!html) return true;
  const plain = htmlToPlain(html).trim();
  return plain === '';
}

// Exposed so lists / flow tree rows can render title HTML as plain text
// when they need a compact textual representation (e.g. tooltips, fuzzy
// search indexes).
export function titleToPlain(html) {
  return htmlToPlain(html).trim();
}
