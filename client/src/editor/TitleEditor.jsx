import { useEditor, EditorContent } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Paragraph from '@tiptap/extension-paragraph';
import History from '@tiptap/extension-history';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect } from 'react';
import { DynamicFieldNode } from './DynamicFieldNode.jsx';
import { sanitizePastedHtml } from './pasteSanitizer.js';
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

  return <EditorContent editor={editor} />;
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
