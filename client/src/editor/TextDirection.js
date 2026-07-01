import { Extension } from '@tiptap/core';

// Per-block writing direction (RTL / LTR) — independent of text alignment.
//
// Why this is separate from alignment: Hebrew users routinely need an LTR
// paragraph for English text, URLs, product names or code, where punctuation,
// parentheses, numbers and mixed-language runs must follow LTR bidi rules.
// "Align left" only moves the block — it does NOT fix bidi, so commas, dots
// and brackets still land on the wrong side. Setting the writing direction
// (like the RTL/LTR buttons in Word / Google Docs) is what actually fixes it.
//
// Implementation: adds a `dir` attribute to block nodes (paragraph, heading,
// AND list nodes) and renders it as the standard HTML `dir` attribute. That
// means:
//   - saved getHTML() carries `<p dir="ltr">…` / `<ul dir="ltr">…`, so
//     direction survives save,
//   - parseHTML reads `dir` back on reload, so it round-trips,
//   - existing content (no `dir`) is untouched and simply inherits the
//     editor/container direction as before.
//
// Why list nodes are included (bulletList / orderedList / listItem): the
// bullet/number marker and the indentation are painted by the LIST element,
// positioned by that element's CSS `direction` — not by the paragraph inside
// the <li>. If direction were applied only to the paragraph (as before), the
// text would reflow but the markers and indent would stay on the original
// side — exactly the "English bullets on the wrong side" bug. Stamping `dir`
// on the list container flips markers + indentation together, matching Word.
export const TextDirection = Extension.create({
  name: 'textDirection',

  addOptions() {
    return {
      types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem'],
      directions: ['ltr', 'rtl'],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          dir: {
            default: null,
            parseHTML: (el) => {
              const dir = (el.getAttribute('dir') || '').toLowerCase();
              return dir === 'ltr' || dir === 'rtl' ? dir : null;
            },
            renderHTML: (attrs) => (attrs.dir ? { dir: attrs.dir } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      // Set the writing direction of the block(s) in the current selection.
      // Applies to every configured node type that is actually present in the
      // selection (paragraph + any enclosing list container/items). `.some`
      // (not `.every`): a plain paragraph has no list ancestor, so the list
      // updates return false — that must NOT fail the whole command. Success =
      // at least one applicable block was updated.
      setTextDirection:
        (direction) =>
        ({ commands }) => {
          if (!this.options.directions.includes(direction)) return false;
          return this.options.types
            .map((type) => commands.updateAttributes(type, { dir: direction }))
            .some(Boolean);
        },
      // Clear an explicit direction → block falls back to inherited direction.
      unsetTextDirection:
        () =>
        ({ commands }) =>
          this.options.types
            .map((type) => commands.resetAttributes(type, 'dir'))
            .some(Boolean),
    };
  },
});
