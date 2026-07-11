import './editor.css';
import { richHtmlForDisplay } from './htmlNormalize.js';

// THE canonical rich-text display component — the single rendering path for
// rich content authored in GOS (system invariant, see CLAUDE.md §16):
// editing and display parity is mandatory, so every read surface must render
// through this component instead of hand-rolling dangerouslySetInnerHTML,
// ad-hoc CSS, or plain {text} interpolation (which collapses line breaks).
//
// What it guarantees:
//   • typography identical to the editor surface (.gos-prose mirrors
//     .rt-editor-prose — paragraph rhythm, headings, lists, links, marks)
//   • plain-text content (textarea-authored, imported) gets its newlines
//     restored as real <p>/<br> blocks instead of collapsing to one line
//   • the same paragraph/inline-heading normalisation as every other GOS
//     read surface (richHtmlForDisplay)
//   • per-language direction via the dir prop (RTL default; the
//     .gos-prose[dir] rules make the attribute win over the class default)
//
// `tight` opts into the compact note face (.gos-prose-tight — margin-0
// blocks, 15px): the display parity partner of the compact composer
// (.rt-editor-compact), for content authored in note-style editors
// (timeline notes, Deal fields like customerInfo).
//
// `className` is for LAYOUT (margins, width) only — never for typography;
// the content styling contract belongs to .gos-prose alone.
export default function RichText({ html, dir, tight = false, className = '' }) {
  const rendered = richHtmlForDisplay(html || '');
  if (!rendered) return null;
  return (
    <div
      dir={dir}
      className={['gos-prose', tight ? 'gos-prose-tight' : '', className].filter(Boolean).join(' ')}
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
}
