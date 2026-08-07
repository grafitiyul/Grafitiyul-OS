import { parseWaMarkup } from './waFormat.js';

// THE live-conversation WhatsApp text renderer — the React half of the one
// markup grammar (waFormat.js). The other half, waPreview.js, paints the same
// nodes as an HTML string for the authoring preview.
//
// Why React nodes instead of an HTML string here: a conversation shows text
// WE DID NOT WRITE. Returning elements means no innerHTML anywhere on the path,
// so React's own escaping makes injection impossible by construction rather
// than by remembering to escape — and links become real, clickable anchors
// through the shared safe link renderer's markup (only ever http(s) hrefs).
//
// Variables are OFF: `{{x}}` is a GOS authoring token, not WhatsApp markup. A
// customer who types braces typed braces.
//
// Rendering is presentation only — `message.textContent` is never rewritten.

function nodes(list, keyPrefix = '') {
  return list.map((n, i) => {
    const key = `${keyPrefix}${i}`;
    switch (n.type) {
      case 'text':
        return n.value;
      case 'break':
        return <br key={key} />;
      case 'code':
        return (
          <code key={key} className="rounded bg-black/10 px-1 font-mono text-[0.92em]">
            {n.value}
          </code>
        );
      case 'link':
        return (
          <a
            key={key}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="break-all text-blue-600 underline decoration-blue-300 underline-offset-2 hover:text-blue-800"
          >
            {n.text}
          </a>
        );
      case 'bold':
        return <strong key={key}>{nodes(n.children, `${key}.`)}</strong>;
      case 'italic':
        return <em key={key}>{nodes(n.children, `${key}.`)}</em>;
      case 'strike':
        return <s key={key}>{nodes(n.children, `${key}.`)}</s>;
      default:
        return null;
    }
  });
}

/**
 * Render one WhatsApp message body with its native formatting.
 * Belongs inside a `whitespace-pre-wrap` + `dir="auto"` parent, exactly like
 * the plain renderer it replaced — line breaks, emoji and RTL Hebrew are
 * untouched.
 */
export function waTextNodes(text, { variables = false } = {}) {
  return nodes(parseWaMarkup(text, { variables }));
}

export default function WaText({ text, className = '', dir = 'auto' }) {
  return (
    <span className={className} dir={dir}>
      {waTextNodes(text)}
    </span>
  );
}
