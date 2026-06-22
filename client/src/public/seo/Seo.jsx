import { useEffect } from 'react';
import { buildHead } from './buildHead.js';

// Per-page SEO. Renders nothing; it applies the <head> tags computed by the
// shared `buildHead`. In the current CSR setup it sets them imperatively after
// mount (good enough for the SPA preview + correct for users). Once Vike SSR
// lands (Step 3), the SAME `buildHead` output is emitted server-side so
// crawlers get the tags in the initial HTML — this component then only needs
// to keep them in sync on client navigation.
//
// All managed tags carry data-seo="1" so they can be upserted/cleaned without
// touching unrelated head tags.
const MARK = 'data-seo';

function upsertMeta({ name, property, content }) {
  const selector = name
    ? `meta[name="${name}"][${MARK}]`
    : `meta[property="${property}"][${MARK}]`;
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement('meta');
    if (name) el.setAttribute('name', name);
    if (property) el.setAttribute('property', property);
    el.setAttribute(MARK, '1');
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink({ rel, href }) {
  let el = document.head.querySelector(`link[rel="${rel}"][${MARK}]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    el.setAttribute(MARK, '1');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export default function Seo(props) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const head = buildHead(props);

    document.title = head.title;
    head.metas.forEach(upsertMeta);
    head.links.forEach(upsertLink);

    // JSON-LD structured data (one <script> per block).
    const ldNodes = head.jsonLd.map((block) => {
      const s = document.createElement('script');
      s.type = 'application/ld+json';
      s.setAttribute(MARK, '1');
      s.text = JSON.stringify(block);
      document.head.appendChild(s);
      return s;
    });

    // Clean up only the JSON-LD scripts on unmount/prop-change (meta/links are
    // upserted in place across navigations, so they don't need removal).
    return () => ldNodes.forEach((n) => n.remove());
    // Re-run whenever the serialised props change.
  }, [JSON.stringify(props)]);

  return null;
}
