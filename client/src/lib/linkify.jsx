import { tokenizeLinks } from './linkifyCore.js';

// Shared plain-text URL renderer — the ONE place WhatsApp-style text becomes
// clickable links. Returns React nodes (strings + <a> elements), so React's
// own escaping keeps XSS impossible: no HTML parsing, no innerHTML, and the
// tokenizer only ever emits http(s) hrefs.
//
// Renders inside a `whitespace-pre-wrap` + `dir="auto"` parent unchanged:
// line breaks, emojis and RTL Hebrew stay exactly as typed because non-URL
// segments pass through as raw strings.
export function linkifyText(text) {
  const tokens = tokenizeLinks(text);
  if (tokens.length === 1 && tokens[0].type === 'text') return text;
  return tokens.map((t, i) => {
    if (t.type === 'text') return t.text;
    return (
      <span key={i}>
        <a
          href={t.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="break-all text-blue-600 underline decoration-blue-300 underline-offset-2 hover:text-blue-800"
        >
          {t.text}
        </a>
        {t.rest}
      </span>
    );
  });
}
