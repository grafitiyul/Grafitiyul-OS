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
// Implementation: adds a `dir` attribute to block nodes (paragraph, heading)
// and renders it as the standard HTML `dir` attribute. That means:
//   - saved getHTML() carries `<p dir="ltr">…`, so direction survives save,
//   - parseHTML reads `dir` back on reload, so it round-trips,
//   - existing content (no `dir`) is untouched and simply inherits the
//     editor/container direction as before.
export const TextDirection = Extension.create({
  name: 'textDirection',

  addOptions() {
    return {
      types: ['paragraph', 'heading'],
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
      setTextDirection:
        (direction) =>
        ({ commands }) => {
          if (!this.options.directions.includes(direction)) return false;
          return this.options.types
            .map((type) => commands.updateAttributes(type, { dir: direction }))
            .every(Boolean);
        },
      // Clear an explicit direction → block falls back to inherited direction.
      unsetTextDirection:
        () =>
        ({ commands }) =>
          this.options.types
            .map((type) => commands.resetAttributes(type, 'dir'))
            .every(Boolean),
    };
  },
});
