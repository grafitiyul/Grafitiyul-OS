// Pure tokenizer behind the shared link renderer (linkify.jsx) — kept JSX-free
// so it is unit-testable with node --test. Splits plain text into tokens:
//   { type: 'text', text }               — rendered verbatim (React-escaped)
//   { type: 'link', text, href, rest }   — <a href> + trailing punctuation
// href is only ever an http(s) URL: matches must start with http(s):// or
// www., so no javascript:/data: scheme can ever be produced.

const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;

// Trailing sentence punctuation belongs to the text, not the URL — WhatsApp
// itself splits it the same way. A ")" is stripped only when unbalanced
// (more ")" than "(" in the URL), so wikipedia-style "(...)" paths survive.
function splitTrailing(match) {
  let url = match;
  let rest = '';
  for (;;) {
    const last = url[url.length - 1];
    if ('.,!?;:*~״”’'.includes(last)) {
      url = url.slice(0, -1);
      rest = last + rest;
    } else if (last === ')' && url.split(')').length > url.split('(').length) {
      url = url.slice(0, -1);
      rest = last + rest;
    } else {
      break;
    }
  }
  return [url, rest];
}

export function tokenizeLinks(text) {
  if (typeof text !== 'string' || !text) return [{ type: 'text', text: text || '' }];
  const parts = text.split(URL_RE);
  if (parts.length === 1) return [{ type: 'text', text }];
  return parts
    .map((part, i) => {
      // Odd indices are the captured URL candidates.
      if (i % 2 === 0) return { type: 'text', text: part };
      const [url, rest] = splitTrailing(part);
      // A bare "www." with no real host left after trimming is just text.
      if (!/^(https?:\/\/|www\.)[^\s]*[\w/-]/i.test(url)) return { type: 'text', text: part };
      const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      return { type: 'link', text: url, href, rest };
    })
    .filter((t) => t.type === 'link' || t.text !== '');
}
