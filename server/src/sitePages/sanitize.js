import sanitizeHtml from 'sanitize-html';
import { normalizeDocument, sectionType } from '../../../shared/sitePage.mjs';

// Sanitization for website-page rich text. This is the ONLY gate between what an
// operator types (or pastes from the old site) and what a logged-out visitor's
// browser executes, so it runs on WRITE (draft save) and again on PUBLISH — a
// row that predates a tightening of this list can never leak through.
//
// Narrower than the email allowlist on purpose: a marketing page is our own
// layout, so it does not need tables, <font>, or arbitrary inline styles the way
// a forwarded newsletter does. Everything that can execute or navigate off-policy
// is gone: script/style/iframe/object/embed/form, every on* handler, and any
// scheme that is not http(s)/mailto/tel.

const OPTIONS = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'mark',
    'ul', 'ol', 'li', 'blockquote',
    'h2', 'h3', 'h4',
    'a', 'span', 'div',
  ],
  allowedAttributes: {
    // `dir` is load-bearing here: these pages mix Hebrew RTL and English LTR.
    '*': ['dir'],
    a: ['href', 'target', 'rel'],
    span: ['dir'],
    p: ['dir'],
    div: ['dir'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href'],
  disallowedTagsMode: 'discard',
  // Drop these WITH their text content — a stripped <script> that left its source
  // behind as visible text would be both ugly and a hint at what was attempted.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'form', 'title', 'head'],
  transformTags: {
    // Every outbound link is untrusted: no opener handle, no referrer leak.
    a: (tagName, attribs) => ({
      tagName: 'a',
      attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' },
    }),
  },
};

/** Sanitize one rich-text field. Returns '' for empty/degenerate input. */
export function sanitizeSiteHtml(html) {
  if (!html) return '';
  return sanitizeHtml(String(html), OPTIONS).trim();
}

/**
 * Plain text for fields that must never carry markup (names, addresses, SEO).
 *
 * Entities are decoded back to real characters so what we STORE is true plain
 * text. The renderer then escapes exactly once. Storing `&amp;` instead would
 * double-escape into a visible "&amp;" on the page — the classic bug, and the
 * recovered content is full of `&quot;` (e.g. ד"ר שקשוקה).
 */
export function plainText(value) {
  if (!value) return '';
  const stripped = sanitizeHtml(String(value), { allowedTags: [], allowedAttributes: {} });
  return decodeEntities(stripped).replace(/[ \t]+/g, ' ').trim();
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    // &amp; LAST, so "&amp;lt;" decodes to "&lt;" and not to "<".
    .replace(/&amp;/g, '&');
}

/**
 * A URL an operator supplied, reduced to something safe to put in href/src.
 * Anything that is not absolute http(s) — including `javascript:` and protocol-
 * relative `//evil` — is rejected outright rather than "cleaned", because a
 * half-valid URL on a live page is worse than a missing one.
 * A bare `example.com` (common in the recovered content) is upgraded to https.
 */
export function safeUrl(value) {
  const raw = plainText(value);
  if (!raw) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//') ? raw : `https://${raw}`;
  let u;
  try {
    u = new URL(candidate);
  } catch {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  return u.toString();
}

/** Image source: same rule as safeUrl, but never upgrades a bare string. */
export function safeImageUrl(value) {
  const raw = plainText(value);
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
  } catch {
    return '';
  }
}

// ── Whole-document sanitization ─────────────────────────────────────────────
// Composes the shared normalizer (shape) with the rules above (safety). Every
// stored document has passed through here, so the public renderer can treat its
// input as already-safe and never has to escape defensively at render time.

const HTML_FIELDS = new Set(['htmlHe', 'htmlEn']);
const URL_FIELDS = new Set(['buttonUrl', 'website', 'mapUrl']);
const IMAGE_FIELDS = new Set(['image', 'ogImage']);

function sanitizeField(key, value) {
  if (HTML_FIELDS.has(key)) return sanitizeSiteHtml(value);
  if (IMAGE_FIELDS.has(key)) return safeImageUrl(value);
  if (URL_FIELDS.has(key)) return safeUrl(value);
  return plainText(value);
}

export function sanitizeDocument(raw) {
  const doc = normalizeDocument(raw);
  return {
    titleHe: plainText(doc.titleHe),
    titleEn: plainText(doc.titleEn),
    sections: doc.sections.map((s) => {
      const out = { id: s.id, type: s.type, hidden: s.hidden };
      for (const f of sectionType(s.type).fields) {
        if (f === 'cards') {
          out.cards = s.cards.map((c) => {
            const card = { id: c.id, hidden: c.hidden };
            for (const [k, v] of Object.entries(c)) {
              if (k === 'id' || k === 'hidden') continue;
              card[k] = sanitizeField(k, v);
            }
            return card;
          });
        } else if (f === 'items') {
          out.items = s.items.map((i) => ({
            id: i.id,
            hidden: i.hidden,
            questionHe: plainText(i.questionHe),
            questionEn: plainText(i.questionEn),
            // Answers are the one FAQ field allowed to carry links/formatting.
            answerHe: sanitizeSiteHtml(i.answerHe),
            answerEn: sanitizeSiteHtml(i.answerEn),
          }));
        } else if (f === 'rows') {
          // Pricing rows: text is plain, amounts stay NUMBERS (the normalizer
          // already coerced them to integer-minor-or-null; stringifying here
          // would corrupt them). variantId/cardGroupId are internal refs the
          // renderer never emits — plain text is enough.
          out.rows = s.rows.map((r) => ({
            id: r.id,
            hidden: r.hidden,
            titleHe: plainText(r.titleHe),
            titleEn: plainText(r.titleEn),
            metaHe: plainText(r.metaHe),
            metaEn: plainText(r.metaEn),
            notesHe: plainText(r.notesHe),
            notesEn: plainText(r.notesEn),
            lines: r.lines.map((l) => ({
              id: l.id,
              kind: l.kind,
              upto: l.upto,
              amountMinor: l.amountMinor,
              labelHe: plainText(l.labelHe),
              labelEn: plainText(l.labelEn),
            })),
            variantId: plainText(r.variantId),
            cardGroupId: plainText(r.cardGroupId),
          }));
        } else if (f === 'imageSide') {
          out.imageSide = s.imageSide;
        } else {
          out[f] = sanitizeField(f, s[f]);
        }
      }
      return out;
    }),
    seo: {
      titleHe: plainText(doc.seo.titleHe),
      titleEn: plainText(doc.seo.titleEn),
      descriptionHe: plainText(doc.seo.descriptionHe),
      descriptionEn: plainText(doc.seo.descriptionEn),
      canonicalUrl: safeUrl(doc.seo.canonicalUrl),
      noindex: doc.seo.noindex === true,
      ogTitleHe: plainText(doc.seo.ogTitleHe),
      ogTitleEn: plainText(doc.seo.ogTitleEn),
      ogDescriptionHe: plainText(doc.seo.ogDescriptionHe),
      ogDescriptionEn: plainText(doc.seo.ogDescriptionEn),
      ogImage: safeImageUrl(doc.seo.ogImage),
    },
  };
}
