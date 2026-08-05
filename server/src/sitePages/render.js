import { visibleDocument } from '../../../shared/sitePage.mjs';

// Server-side rendering of a published page into an HTML fragment + SEO block.
//
// It runs on the SERVER, not in the browser, for three reasons the brief calls
// out: WordPress needs real HTML to embed (no client-side iframe), search
// engines need the metadata in the response, and a visitor with JavaScript off
// still gets the page.
//
// The fragment is intentionally class-based and style-free apart from ONE small
// stylesheet (pageStylesheet below): the WordPress theme owns the site's fonts
// and colours, and these rules only lay the sections out. Everything here is
// already sanitized by sanitize.js — esc() below is belt-and-braces for text
// nodes and attributes, never the primary defence.

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Hebrew text drives RTL; English fields render LTR inside the same page. */
const isHebrew = (s) => /[֐-׿]/.test(String(s || ''));
const dirFor = (s) => (isHebrew(s) ? 'rtl' : 'ltr');

/** A bilingual value with graceful fallback to the other language. */
const pickOr = (obj, base, locale) => {
  const primary = locale === 'en' ? obj[`${base}En`] : obj[`${base}He`];
  const secondary = locale === 'en' ? obj[`${base}He`] : obj[`${base}En`];
  return (primary || secondary || '').trim();
};

function heading(text, level = 2) {
  if (!text) return '';
  return `<h${level} class="gos-page__heading" dir="${dirFor(text)}">${esc(text)}</h${level}>`;
}

function imageTag(src, alt, className) {
  if (!src) return '';
  return `<img class="${className}" src="${esc(src)}" alt="${esc(alt || '')}" loading="lazy" decoding="async">`;
}

function linkTag(url, label) {
  if (!url) return '';
  return `<a class="gos-page__link" href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow" dir="ltr">${esc(label || url)}</a>`;
}

// ── Card rendering ──────────────────────────────────────────────────────────
// A recommendation card is a <article> with a definition list of the facts that
// exist. Empty fields emit nothing at all — the recovered data is uneven (some
// venues have no hours, some no website) and rendering empty labels would look
// broken.
const CARD_ROWS = [
  ['hours', 'שעות פעילות', 'Hours'],
  ['address', 'כתובת', 'Address'],
  ['phone', 'טלפון', 'Phone'],
  ['kosher', 'כשרות', 'Kosher'],
  ['notes', 'הערות', 'Notes'],
];

function renderCard(card, locale) {
  const label = (he, en) => (locale === 'en' ? en : he);
  const rows = CARD_ROWS.filter(([k]) => card[k])
    .map(([k, he, en]) => {
      const value = card[k];
      const body = String(value)
        .split('\n')
        .map((line) => esc(line))
        .join('<br>');
      return (
        `<div class="gos-card__row">` +
        `<dt class="gos-card__label">${esc(label(he, en))}</dt>` +
        `<dd class="gos-card__value" dir="${dirFor(value)}">${body}</dd>` +
        `</div>`
      );
    })
    .join('');

  const description = pickOr(card, 'description', locale);
  const links = [
    card.website ? linkTag(card.website, label('אתר המקום', 'Website')) : '',
    card.mapUrl ? linkTag(card.mapUrl, label('מפה', 'Map')) : '',
  ]
    .filter(Boolean)
    .join('');

  return (
    `<article class="gos-card">` +
    (card.image ? `<div class="gos-card__media">${imageTag(card.image, card.name, 'gos-card__img')}</div>` : '') +
    `<div class="gos-card__body">` +
    `<h3 class="gos-card__name" dir="${dirFor(card.name)}">${esc(card.name)}</h3>` +
    (card.category ? `<p class="gos-card__category" dir="${dirFor(card.category)}">${esc(card.category)}</p>` : '') +
    (description ? `<p class="gos-card__desc" dir="${dirFor(description)}">${esc(description)}</p>` : '') +
    (rows ? `<dl class="gos-card__facts">${rows}</dl>` : '') +
    (links ? `<p class="gos-card__links">${links}</p>` : '') +
    `</div>` +
    `</article>`
  );
}

// ── Pricing rendering ───────────────────────────────────────────────────────
// A pricing row is one sellable item: name, an optional duration/context line,
// structured price lines, optional notes. Amounts are integer minor units and
// are FORMATTED here — the stored document never carries display strings, so
// He and En rendering can never disagree about the number itself.
const PRICING_LINE_LABELS = {
  fixed: ['מחיר לקבוצה', 'Price per group'],
  extra: ['כל משתתף נוסף', 'Each additional participant'],
};

function formatAmount(amountMinor, locale) {
  const major = amountMinor / 100;
  const digits = Number.isInteger(major) ? 0 : 2;
  const num = major.toLocaleString(locale === 'en' ? 'en-US' : 'he-IL', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return locale === 'en' ? `${num} NIS` : `${num} ₪`;
}

function pricingLineLabel(line, locale) {
  if (line.kind === 'tier' && line.upto != null) {
    return locale === 'en' ? `Up to ${line.upto} participants` : `עד ${line.upto} משתתפים`;
  }
  const fixed = PRICING_LINE_LABELS[line.kind];
  const custom = pickOr(line, 'label', locale);
  // A custom label always wins (even on fixed/extra); registry label otherwise.
  return custom || (fixed ? (locale === 'en' ? fixed[1] : fixed[0]) : '');
}

function renderPricingRow(row, locale) {
  const title = pickOr(row, 'title', locale);
  if (!title) return '';
  const meta = pickOr(row, 'meta', locale);
  const notes = pickOr(row, 'notes', locale);
  const lines = (row.lines || [])
    .map((l) => {
      const label = pricingLineLabel(l, locale);
      if (!label && l.amountMinor == null) return '';
      const amount = l.amountMinor == null ? '' : `<span class="gos-price__amount" dir="ltr">${esc(formatAmount(l.amountMinor, locale))}</span>`;
      return (
        `<li class="gos-price__line">` +
        `<span class="gos-price__label" dir="${dirFor(label)}">${esc(label)}</span>` +
        amount +
        `</li>`
      );
    })
    .filter(Boolean)
    .join('');
  return (
    `<article class="gos-price">` +
    `<h3 class="gos-price__name" dir="${dirFor(title)}">${esc(title)}</h3>` +
    (meta ? `<p class="gos-price__meta" dir="${dirFor(meta)}">${esc(meta)}</p>` : '') +
    (lines ? `<ul class="gos-price__lines">${lines}</ul>` : '') +
    (notes ? `<p class="gos-price__notes" dir="${dirFor(notes)}">${esc(notes).split('\n').join('<br>')}</p>` : '') +
    `</article>`
  );
}

function renderSection(section, locale) {
  switch (section.type) {
    case 'hero': {
      const title = pickOr(section, 'title', locale);
      const subtitle = pickOr(section, 'subtitle', locale);
      return (
        `<header class="gos-page__hero">` +
        (title ? `<h1 class="gos-page__title" dir="${dirFor(title)}">${esc(title)}</h1>` : '') +
        (subtitle ? `<p class="gos-page__subtitle" dir="${dirFor(subtitle)}">${esc(subtitle)}</p>` : '') +
        (section.image ? imageTag(section.image, title, 'gos-page__heroimg') : '') +
        `</header>`
      );
    }
    case 'richText': {
      const html = pickOr(section, 'html', locale);
      const head = pickOr(section, 'heading', locale);
      if (!html && !head) return '';
      return (
        `<section class="gos-page__section gos-page__section--text">` +
        heading(head) +
        (html ? `<div class="gos-page__rich" dir="${dirFor(html.replace(/<[^>]*>/g, ''))}">${html}</div>` : '') +
        `</section>`
      );
    }
    case 'image': {
      const caption = pickOr(section, 'caption', locale);
      if (!section.image) return '';
      return (
        `<figure class="gos-page__figure">` +
        imageTag(section.image, pickOr(section, 'alt', locale), 'gos-page__img') +
        (caption ? `<figcaption dir="${dirFor(caption)}">${esc(caption)}</figcaption>` : '') +
        `</figure>`
      );
    }
    case 'imageText': {
      const html = pickOr(section, 'html', locale);
      const head = pickOr(section, 'heading', locale);
      return (
        `<section class="gos-page__section gos-page__split gos-page__split--${section.imageSide === 'end' ? 'end' : 'start'}">` +
        (section.image ? `<div class="gos-page__split-media">${imageTag(section.image, pickOr(section, 'alt', locale), 'gos-page__img')}</div>` : '') +
        `<div class="gos-page__split-body">${heading(head)}${html ? `<div class="gos-page__rich">${html}</div>` : ''}</div>` +
        `</section>`
      );
    }
    case 'cards': {
      const head = pickOr(section, 'heading', locale);
      const note = pickOr(section, 'note', locale);
      const cards = section.cards.map((c) => renderCard(c, locale)).join('');
      if (!cards && !head) return '';
      return (
        `<section class="gos-page__section gos-page__section--cards">` +
        heading(head) +
        (note ? `<p class="gos-page__note" dir="${dirFor(note)}">${esc(note)}</p>` : '') +
        `<div class="gos-cards">${cards}</div>` +
        `</section>`
      );
    }
    case 'faq': {
      const head = pickOr(section, 'heading', locale);
      const items = section.items
        .map((i) => {
          const q = pickOr(i, 'question', locale);
          const a = locale === 'en' ? i.answerEn || i.answerHe : i.answerHe || i.answerEn;
          if (!q) return '';
          return (
            `<details class="gos-faq__item">` +
            `<summary class="gos-faq__q" dir="${dirFor(q)}">${esc(q)}</summary>` +
            `<div class="gos-faq__a gos-page__rich" dir="${dirFor(String(a).replace(/<[^>]*>/g, ''))}">${a || ''}</div>` +
            `</details>`
          );
        })
        .join('');
      if (!items) return '';
      return `<section class="gos-page__section gos-page__section--faq">${heading(head)}<div class="gos-faq">${items}</div></section>`;
    }
    case 'cta': {
      const head = pickOr(section, 'heading', locale);
      const body = pickOr(section, 'body', locale);
      const label = pickOr(section, 'buttonLabel', locale);
      if (!head && !body && !label) return '';
      return (
        `<section class="gos-page__section gos-page__cta">` +
        heading(head) +
        (body ? `<p dir="${dirFor(body)}">${esc(body)}</p>` : '') +
        (label && section.buttonUrl
          ? `<p><a class="gos-page__btn" href="${esc(section.buttonUrl)}" rel="noopener noreferrer">${esc(label)}</a></p>`
          : '') +
        `</section>`
      );
    }
    case 'pricing': {
      const head = pickOr(section, 'heading', locale);
      const note = pickOr(section, 'note', locale);
      const rows = (section.rows || []).map((r) => renderPricingRow(r, locale)).filter(Boolean).join('');
      if (!rows && !head) return '';
      return (
        `<section class="gos-page__section gos-page__section--pricing">` +
        heading(head) +
        (note ? `<p class="gos-page__note" dir="${dirFor(note)}">${esc(note)}</p>` : '') +
        `<div class="gos-pricing">${rows}</div>` +
        `</section>`
      );
    }
    case 'divider':
      return `<hr class="gos-page__divider">`;
    default:
      return '';
  }
}

/**
 * Render a published document.
 * @param content the FROZEN version content (already sanitized at publish time)
 * @param locale  'he' | 'en'
 */
export function renderPage(content, { locale = 'he' } = {}) {
  const doc = visibleDocument(content);
  const dir = locale === 'en' ? 'ltr' : 'rtl';
  const body = doc.sections.map((s) => renderSection(s, locale)).join('\n');
  const html = `<div class="gos-page" dir="${dir}" lang="${locale === 'en' ? 'en' : 'he'}">\n${body}\n</div>`;
  return { html, seo: pageSeo(doc, { locale }) };
}

/** The metadata WordPress should emit in <head>. */
export function pageSeo(content, { locale = 'he', canonicalFallback = '' } = {}) {
  const doc = visibleDocument(content);
  const s = doc.seo;
  const title = (locale === 'en' ? s.titleEn || s.titleHe : s.titleHe || s.titleEn) || pickOr(doc, 'title', locale);
  const description = locale === 'en' ? s.descriptionEn || s.descriptionHe : s.descriptionHe || s.descriptionEn;
  return {
    title: title || '',
    description: description || '',
    canonical: s.canonicalUrl || canonicalFallback || '',
    noindex: s.noindex === true,
    ogTitle: (locale === 'en' ? s.ogTitleEn || s.ogTitleHe : s.ogTitleHe || s.ogTitleEn) || title || '',
    ogDescription:
      (locale === 'en' ? s.ogDescriptionEn || s.ogDescriptionHe : s.ogDescriptionHe || s.ogDescriptionEn) ||
      description ||
      '',
    ogImage: s.ogImage || '',
    locale: locale === 'en' ? 'en_US' : 'he_IL',
  };
}

/**
 * FAQPage structured data — emitted only when the page actually has FAQ items,
 * so we never claim a schema the content does not support.
 */
export function pageStructuredData(content, { locale = 'he' } = {}) {
  const doc = visibleDocument(content);
  const faq = doc.sections.filter((s) => s.type === 'faq').flatMap((s) => s.items);
  if (!faq.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq
      .map((i) => {
        const q = pickOr(i, 'question', locale);
        const a = (locale === 'en' ? i.answerEn || i.answerHe : i.answerHe || i.answerEn) || '';
        if (!q || !a) return null;
        return {
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: String(a).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() },
        };
      })
      .filter(Boolean),
  };
}

/** The ONE stylesheet the fragment needs. Served with the page, scoped to .gos-page. */
export const pageStylesheet = `
.gos-page{max-width:1080px;margin:0 auto;padding:0 16px 48px;line-height:1.65}
.gos-page__title{font-size:clamp(1.9rem,4vw,2.75rem);margin:.6em 0 .3em}
.gos-page__subtitle{font-size:1.15rem;opacity:.85;margin:0 0 1em}
.gos-page__heroimg,.gos-page__img{max-width:100%;height:auto;border-radius:14px}
.gos-page__section{margin:2.5rem 0}
.gos-page__heading{font-size:clamp(1.35rem,2.6vw,1.9rem);margin:0 0 .8em;padding-bottom:.3em;border-bottom:2px solid currentColor}
.gos-page__note{opacity:.85;margin:0 0 1em}
.gos-page__rich :is(p,ul,ol){margin:0 0 .9em}
.gos-page__rich a{text-decoration:underline}
.gos-page__divider{border:0;border-top:1px solid rgba(128,128,128,.35);margin:2.5rem 0}
.gos-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}
.gos-card{display:flex;flex-direction:column;border:1px solid rgba(128,128,128,.28);border-radius:16px;overflow:hidden;background:rgba(127,127,127,.04)}
.gos-card__media{aspect-ratio:16/10;overflow:hidden}
.gos-card__img{width:100%;height:100%;object-fit:cover;border-radius:0;display:block}
.gos-card__body{padding:14px 16px 16px}
.gos-card__name{font-size:1.15rem;margin:0 0 .35em}
.gos-card__category{margin:0 0 .5em;font-size:.9rem;opacity:.75}
.gos-card__desc{margin:0 0 .7em}
.gos-card__facts{margin:0;display:grid;gap:4px}
.gos-card__row{display:flex;gap:6px;flex-wrap:wrap;font-size:.94rem}
.gos-card__label{font-weight:600;margin:0;opacity:.8}
.gos-card__label::after{content:":"}
.gos-card__value{margin:0}
.gos-card__links{margin:.8em 0 0;display:flex;gap:14px;flex-wrap:wrap}
.gos-page__link{text-decoration:underline;word-break:break-word}
.gos-page__split{display:grid;gap:24px;align-items:center}
@media(min-width:760px){.gos-page__split{grid-template-columns:1fr 1fr}.gos-page__split--end .gos-page__split-media{order:2}}
.gos-faq{display:grid;gap:10px}
.gos-faq__item{border:1px solid rgba(128,128,128,.28);border-radius:12px;padding:12px 16px}
.gos-faq__q{cursor:pointer;font-weight:600}
.gos-faq__a{margin-top:.6em}
.gos-pricing{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px}
.gos-price{display:flex;flex-direction:column;border:1px solid rgba(128,128,128,.28);border-radius:16px;padding:16px 18px;background:rgba(127,127,127,.04)}
.gos-price__name{font-size:1.12rem;margin:0 0 .25em}
.gos-price__meta{margin:0 0 .7em;font-size:.9rem;opacity:.75}
.gos-price__lines{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.gos-price__line{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px dashed rgba(128,128,128,.25)}
.gos-price__line:last-child{border-bottom:0}
.gos-price__label{min-width:0}
.gos-price__amount{font-weight:700;white-space:nowrap}
.gos-price__notes{margin:.7em 0 0;font-size:.9rem;opacity:.8}
.gos-page__cta{text-align:center}
.gos-page__btn{display:inline-block;padding:12px 26px;border-radius:999px;background:#111;color:#fff;text-decoration:none;font-weight:600}
@media(max-width:520px){.gos-page{padding:0 12px 32px}.gos-cards{grid-template-columns:1fr}}
`.trim();
