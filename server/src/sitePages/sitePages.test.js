import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeDocument, sanitizeSiteHtml, safeUrl, safeImageUrl, plainText } from './sanitize.js';
import { renderPage, pageSeo, pageStructuredData, pageStylesheet } from './render.js';
import {
  normalizeDocument, visibleDocument, makeSection, makeCard, emptyDocument,
  normalizeSlug, SECTION_TYPE_KEYS, documentSummary,
  makePricingRow, makePricingLine,
} from '../../../shared/sitePage.mjs';
import { PUBLIC_LINKS, SITE_PAGE_SLUGS, sitePageUrl } from '../publicLinks.js';

// Regression tests for the "דפי אתר" module. These cover the behaviours the
// public page depends on and that a future refactor could silently break.
//
// Draft-vs-published isolation (#1–#5) is tested against a small in-memory
// double of the two Prisma models rather than a live database: the property
// being asserted is the SERVICE's logic — that a draft edit never touches the
// published pointer — and that logic is what a fake can prove.

// ── helpers ────────────────────────────────────────────────────────────────
const docWith = (...sections) => ({ ...emptyDocument(), sections });

function cardsSection(cards, heading = 'מסעדות') {
  const s = makeSection('cards');
  s.headingHe = heading;
  s.cards = cards.map((c) => ({ ...makeCard(), ...c }));
  return s;
}

// ── #8 No unsafe HTML / scripts ────────────────────────────────────────────
test('#8 script tags, handlers and javascript: URLs never survive sanitization', () => {
  assert.equal(sanitizeSiteHtml('<script>alert(1)</script><p>ok</p>'), '<p>ok</p>');
  assert.equal(sanitizeSiteHtml('<img src=x onerror="alert(1)">'), '');
  assert.equal(sanitizeSiteHtml('<iframe src="https://evil"></iframe>'), '');
  assert.ok(!sanitizeSiteHtml('<a href="javascript:alert(1)">x</a>').includes('javascript:'));
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('//evil.example/x'), '');
  assert.equal(safeImageUrl('data:text/html;base64,PHNjcmlwdD4='), '');
});

test('#8 outbound links are forced to noopener/noreferrer and open off-site', () => {
  const html = sanitizeSiteHtml('<p><a href="https://example.com">x</a></p>');
  assert.match(html, /rel="noopener noreferrer nofollow"/);
  assert.match(html, /target="_blank"/);
});

test('#8 a whole document is sanitized, including nested card fields', () => {
  const doc = sanitizeDocument(
    docWith(cardsSection([{ name: '<script>x</script>שם', website: 'javascript:evil', image: 'http://ok/x.jpg' }])),
  );
  const card = doc.sections[0].cards[0];
  assert.equal(card.name, 'שם');
  assert.equal(card.website, '');
  assert.equal(card.image, 'http://ok/x.jpg');
});

test('plainText decodes entities so the renderer escapes exactly once', () => {
  // The recovered content contains ד&quot;ר שקשוקה — a double-escape here would
  // put a literal &quot; on the live page.
  assert.equal(plainText('ד&quot;ר שקשוקה'), 'ד"ר שקשוקה');
  assert.equal(plainText('a &amp;lt; b'), 'a &lt; b');
  const { html } = renderPage(docWith(cardsSection([{ name: 'ד"ר שקשוקה' }])), { locale: 'he' });
  assert.ok(html.includes('ד&quot;ר שקשוקה') || html.includes('ד"ר שקשוקה'));
  assert.ok(!html.includes('&amp;quot;'));
});

// ── #9 Section ordering, duplicate, hide, delete ───────────────────────────
test('#9 section order is preserved exactly as stored', () => {
  const a = makeSection('richText'); a.headingHe = 'A';
  const b = makeSection('richText'); b.headingHe = 'B';
  const c = makeSection('richText'); c.headingHe = 'C';
  const { html } = renderPage(docWith(b, c, a), { locale: 'he' });
  assert.ok(html.indexOf('B') < html.indexOf('C'));
  assert.ok(html.indexOf('C') < html.indexOf('A'));
});

test('#9 hidden sections and hidden cards never reach the public document', () => {
  const shown = makeSection('richText'); shown.headingHe = 'גלוי'; shown.htmlHe = '<p>x</p>';
  const hidden = makeSection('richText'); hidden.headingHe = 'מוסתר'; hidden.hidden = true;
  const cards = cardsSection([{ name: 'גלוי' }, { name: 'מוסתר', hidden: true }]);
  const pub = visibleDocument(docWith(shown, hidden, cards));
  assert.equal(pub.sections.length, 2);
  assert.ok(!JSON.stringify(pub).includes('מוסתר'));

  const { html } = renderPage(docWith(shown, hidden, cards), { locale: 'he' });
  assert.ok(!html.includes('מוסתר'));
  assert.ok(html.includes('גלוי'));
});

test('#9 a duplicated section is independent of its source', () => {
  const s = cardsSection([{ name: 'א' }]);
  const copy = JSON.parse(JSON.stringify(s));
  copy.id = 'sec_copy';
  copy.cards[0].id = 'card_copy';
  copy.cards[0].name = 'ב';
  const doc = normalizeDocument(docWith(s, copy));
  assert.equal(doc.sections[0].cards[0].name, 'א');
  assert.equal(doc.sections[1].cards[0].name, 'ב');
  assert.notEqual(doc.sections[0].id, doc.sections[1].id);
});

test('#9 an unknown section type is dropped rather than rendered', () => {
  const doc = normalizeDocument({ sections: [{ id: 'x', type: 'evil-embed', html: '<script>' }] });
  assert.equal(doc.sections.length, 0);
});

// ── #6 Hebrew RTL and English LTR ──────────────────────────────────────────
test('#6 Hebrew renders RTL and English renders LTR', () => {
  const hero = makeSection('hero');
  hero.titleHe = 'המלצות למסעדות';
  hero.titleEn = 'Restaurant recommendations';

  const he = renderPage(docWith(hero), { locale: 'he' }).html;
  assert.match(he, /<div class="gos-page" dir="rtl" lang="he">/);
  assert.match(he, /dir="rtl">המלצות למסעדות</);

  const en = renderPage(docWith(hero), { locale: 'en' }).html;
  assert.match(en, /<div class="gos-page" dir="ltr" lang="en">/);
  assert.match(en, /dir="ltr">Restaurant recommendations</);
});

test('#6 STRICT locales: missing English NEVER silently falls back to Hebrew', () => {
  const hero = makeSection('hero');
  hero.titleHe = 'רק עברית';
  const text = makeSection('richText');
  text.headingHe = 'כותרת';
  text.htmlHe = '<p>תוכן בעברית</p>';
  const en = renderPage(docWith(hero, text), { locale: 'en' }).html;
  assert.ok(!en.includes('רק עברית'), 'Hebrew title must not appear on the English page');
  assert.ok(!en.includes('תוכן בעברית'), 'Hebrew body must not appear on the English page');
  // …and the same in the other direction.
  const enOnly = makeSection('richText');
  enOnly.headingEn = 'English only';
  enOnly.htmlEn = '<p>english body</p>';
  const he = renderPage(docWith(enOnly), { locale: 'he' }).html;
  assert.ok(!he.includes('English only'));
});

test('#6 per-field direction follows the actual text, not the page locale', () => {
  const { html } = renderPage(docWith(cardsSection([{ name: 'Kanu', address: 'הרצל 77' }])), { locale: 'he' });
  assert.match(html, /dir="ltr">Kanu</);
  assert.match(html, /dir="rtl">הרצל 77</);
});

// ── #7 SEO title / meta / canonical ────────────────────────────────────────
test('#7 SEO fields resolve per locale with sensible fallback', () => {
  const doc = {
    ...emptyDocument(),
    titleHe: 'כותרת העמוד',
    seo: {
      ...emptyDocument().seo,
      titleHe: 'כותרת SEO',
      descriptionHe: 'תיאור',
      canonicalUrl: 'https://grafitiyul.co.il/restaurant-recommendations/',
    },
  };
  const he = pageSeo(doc, { locale: 'he' });
  assert.equal(he.title, 'כותרת SEO');
  assert.equal(he.description, 'תיאור');
  assert.equal(he.canonical, 'https://grafitiyul.co.il/restaurant-recommendations/');
  assert.equal(he.noindex, false);
  assert.equal(he.locale, 'he_IL');
  // og:* falls back to the page title/description rather than emitting empty tags
  assert.equal(he.ogTitle, 'כותרת SEO');

  const en = pageSeo(doc, { locale: 'en' });
  assert.equal(en.title, '', 'STRICT: an English page never advertises a Hebrew title');
  assert.equal(en.locale, 'en_US');
});

test('#7 a canonical URL that is not http(s) is rejected, not passed through', () => {
  const doc = sanitizeDocument({ ...emptyDocument(), seo: { ...emptyDocument().seo, canonicalUrl: 'javascript:evil' } });
  assert.equal(doc.seo.canonicalUrl, '');
});

test('#7 noindex survives the round trip and is exposed to the renderer', () => {
  const doc = sanitizeDocument({ ...emptyDocument(), seo: { ...emptyDocument().seo, noindex: true } });
  assert.equal(pageSeo(doc, { locale: 'he' }).noindex, true);
});

test('structured data is emitted only when FAQ content actually exists', () => {
  assert.equal(pageStructuredData(docWith(cardsSection([{ name: 'x' }])), { locale: 'he' }), null);
  const faq = makeSection('faq');
  faq.items = [{ id: 'q1', hidden: false, questionHe: 'שאלה?', questionEn: '', answerHe: '<p>תשובה</p>', answerEn: '' }];
  const sd = pageStructuredData(docWith(faq), { locale: 'he' });
  assert.equal(sd['@type'], 'FAQPage');
  assert.equal(sd.mainEntity[0].name, 'שאלה?');
  assert.equal(sd.mainEntity[0].acceptedAnswer.text, 'תשובה');
});

// ── #11 Restaurant links and images render safely ──────────────────────────
test('#11 card facts render only when present, and links are safe', () => {
  const { html } = renderPage(
    docWith(
      cardsSection([
        { name: 'לורנץ ומינץ', address: 'שלוש 42', phone: '03-9018070', website: 'https://lorenzandmintz.co.il/' },
        { name: 'בלי כלום' },
      ]),
    ),
    { locale: 'he' },
  );
  assert.ok(html.includes('שלוש 42'));
  assert.match(html, /href="https:\/\/lorenzandmintz\.co\.il\/"[^>]*rel="noopener noreferrer nofollow"/);
  // The bare card emits no empty label rows at all
  const bare = html.slice(html.indexOf('בלי כלום'));
  assert.ok(!bare.includes('gos-card__facts'), 'a card with no facts renders no facts list');
});

test('#11 multi-line opening hours render as line breaks, not collapsed text', () => {
  const { html } = renderPage(
    docWith(cardsSection([{ name: 'x', hours: 'ראשון עד חמישי, 08:00 - 17:00\nשבת: סגור' }])),
    { locale: 'he' },
  );
  assert.match(html, /08:00 - 17:00<br>שבת: סגור/);
});

test('#11 images carry alt text and lazy loading', () => {
  const { html } = renderPage(
    docWith(cardsSection([{ name: 'גושן', image: 'https://cdn.example/goshen.jpg' }])),
    { locale: 'he' },
  );
  assert.match(html, /<img class="gos-card__img" src="https:\/\/cdn\.example\/goshen\.jpg" alt="גושן" loading="lazy"/);
});

// ── #12 GOS links resolve to the live page ─────────────────────────────────
// Until the WordPress shell exists, the pages' public home is GOS itself
// (/pages/<slug> on the app origin — owner decision 2026-08-05). publicLinks
// stays the ONE owner: moving back to the marketing domain is a one-line
// change there, and these assertions then change with it.
test('#12 page links resolve through the canonical slug owner to the GOS public pages', () => {
  assert.equal(SITE_PAGE_SLUGS.restaurantRecommendations, 'restaurant-recommendations');
  assert.equal(PUBLIC_LINKS.restaurantRecommendations, 'https://app.grafitiyul.co.il/pages/restaurant-recommendations');
  assert.equal(PUBLIC_LINKS.agentPriceList, 'https://app.grafitiyul.co.il/pages/agent-price-list');
  // slashes in either direction still produce exactly one canonical form
  assert.equal(sitePageUrl('/restaurant-recommendations/'), 'https://app.grafitiyul.co.il/pages/restaurant-recommendations');
});

test('#12 no customer-facing link points at THEGUY, and all are https', () => {
  for (const url of Object.values(PUBLIC_LINKS)) {
    assert.ok(!url.includes('theguy'), `${url} must not reference the temporary domain`);
    assert.match(url, /^https:\/\//);
  }
});

// ── pricing sections (agents price list & any future price page) ───────────
function pricingSection(rows, heading = 'מחירון') {
  const s = makeSection('pricing');
  s.headingHe = heading;
  s.rows = rows.map((r) => ({ ...makePricingRow(), ...r }));
  return s;
}

const priceLine = (patch) => ({ ...makePricingLine(), ...patch });

test('pricing amounts survive normalize+sanitize as NUMBERS, junk becomes null', () => {
  const doc = sanitizeDocument(
    docWith(
      pricingSection([
        {
          titleHe: 'סיור גרפיטי',
          lines: [
            priceLine({ kind: 'tier', upto: 10, amountMinor: 165000 }),
            priceLine({ kind: 'extra', amountMinor: '12000' }),
            priceLine({ kind: 'made-up-kind', amountMinor: 'lots', upto: -3 }),
          ],
          variantId: 'var_1',
          cardGroupId: 'card_1',
        },
      ]),
    ),
  );
  const row = doc.sections[0].rows[0];
  assert.equal(row.lines[0].amountMinor, 165000);
  assert.equal(row.lines[0].upto, 10);
  assert.equal(row.lines[1].amountMinor, 12000, 'numeric strings are coerced');
  assert.equal(row.lines[2].kind, 'custom', 'unknown kinds degrade to custom');
  assert.equal(row.lines[2].amountMinor, null, 'non-numeric amount becomes null');
  assert.equal(row.lines[2].upto, null, 'negative thresholds are rejected');
  assert.equal(row.cardGroupId, 'card_1', 'the canonical card reference is retained for drift checks');
});

test('pricing text fields are sanitized like every other plain field', () => {
  const doc = sanitizeDocument(
    docWith(pricingSection([{ titleHe: '<script>x</script>סיור', notesHe: '<b>עד 45</b>' }])),
  );
  const row = doc.sections[0].rows[0];
  assert.equal(row.titleHe, 'סיור');
  assert.equal(row.notesHe, 'עד 45');
});

test('hidden pricing rows never reach the public document or the rendered page', () => {
  const s = pricingSection([
    { titleHe: 'פריט גלוי', lines: [priceLine({ kind: 'fixed', amountMinor: 130000 })] },
    { titleHe: 'פריט מוסתר', hidden: true, lines: [priceLine({ kind: 'fixed', amountMinor: 99900 })] },
  ]);
  const pub = visibleDocument(docWith(s));
  assert.equal(pub.sections[0].rows.length, 1);
  assert.ok(!JSON.stringify(pub).includes('מוסתר'));
  const { html } = renderPage(docWith(s), { locale: 'he' });
  assert.ok(html.includes('פריט גלוי'));
  assert.ok(!html.includes('פריט מוסתר'));
  assert.ok(!html.includes('999'), 'a hidden row’s price is not in the page');
});

test('pricing renders Hebrew ₪ and English NIS from the SAME stored number', () => {
  const s = pricingSection([
    {
      titleHe: 'סיור וסדנת גרפיטי',
      titleEn: 'Graffiti Tour & Workshop',
      lines: [
        priceLine({ kind: 'tier', upto: 5, amountMinor: 140000 }),
        priceLine({ kind: 'tier', upto: 10, amountMinor: 165000 }),
        priceLine({ kind: 'extra', amountMinor: 12000 }),
      ],
    },
  ]);
  const he = renderPage(docWith(s), { locale: 'he' }).html;
  assert.ok(he.includes('עד 5 משתתפים'));
  assert.ok(he.includes('1,400 ₪'));
  assert.ok(he.includes('כל משתתף נוסף'));
  assert.ok(he.includes('120 ₪'));

  const en = renderPage(docWith(s), { locale: 'en' }).html;
  assert.ok(en.includes('Up to 10 participants'));
  assert.ok(en.includes('1,650 NIS'));
  assert.ok(en.includes('Each additional participant'));
  assert.ok(en.includes('Graffiti Tour &amp; Workshop'));
  // amounts are LTR-isolated so RTL context cannot reorder them
  assert.match(he, /<span class="gos-price__amount" dir="ltr">/);
});

test('pricing internal references (variantId/cardGroupId) never leak into the payload', () => {
  const s = pricingSection([
    {
      titleHe: 'סיור',
      lines: [priceLine({ kind: 'fixed', amountMinor: 130000 })],
      variantId: 'cmquk1dau001nqcpmqf5lgeic',
      cardGroupId: 'card_4d4c8116-197c-41a7-9be9-d222a0f69d22',
    },
  ]);
  for (const locale of ['he', 'en']) {
    const { html, seo } = renderPage(docWith(s), { locale });
    const blob = JSON.stringify({ html, seo });
    assert.ok(!blob.includes('cmquk1dau'), 'variant id must not render');
    assert.ok(!blob.includes('card_4d4c8116'), 'card group id must not render');
  }
});

test('a custom pricing line renders its own label per locale', () => {
  const s = pricingSection([
    {
      titleHe: 'תוספות',
      titleEn: 'Add-ons',
      lines: [priceLine({ kind: 'custom', labelHe: 'טעימה כשרה', labelEn: 'Kosher tasting', amountMinor: 20000 })],
    },
  ]);
  assert.ok(renderPage(docWith(s), { locale: 'he' }).html.includes('טעימה כשרה'));
  assert.ok(renderPage(docWith(s), { locale: 'en' }).html.includes('Kosher tasting'));
});

test('a pricing row with no title renders nothing (no orphan price fragments)', () => {
  const s = pricingSection([{ titleHe: '', lines: [priceLine({ kind: 'fixed', amountMinor: 55500 })] }]);
  const { html } = renderPage(docWith(s), { locale: 'he' });
  assert.ok(!html.includes('555'));
});

// ── contract guards ────────────────────────────────────────────────────────
test('every declared section type has a renderer that produces a string', () => {
  for (const key of SECTION_TYPE_KEYS) {
    const s = makeSection(key);
    const { html } = renderPage(docWith(s), { locale: 'he' });
    assert.equal(typeof html, 'string', `${key} must render`);
  }
});

test('normalizeSlug keeps a URL path segment safe', () => {
  assert.equal(normalizeSlug('  /Restaurant Recommendations/ '), 'restaurant-recommendations');
  assert.equal(normalizeSlug('a<>b?c'), 'abc');
  assert.equal(normalizeSlug('המלצות למסעדות'), 'המלצות-למסעדות');
});

test('documentSummary counts what the list screen shows', () => {
  const s = documentSummary(docWith(cardsSection([{ name: 'a' }, { name: 'b' }]), makeSection('divider')));
  assert.equal(s.sections, 2);
  assert.equal(s.cards, 2);
});

// ── #10 The public payload is self-contained (cached-snapshot fallback) ────
// The WordPress plugin caches ONE payload and must be able to render the page
// from that copy alone while GOS is unreachable. If the payload ever stopped
// carrying its own stylesheet or SEO, the outage fallback would render unstyled
// and untitled — so the self-containment is asserted here, not assumed.
test('#10 a rendered payload carries everything needed to display it offline', () => {
  const hero = makeSection('hero');
  hero.titleHe = 'המלצות למסעדות שוות';
  const doc = {
    ...docWith(hero, cardsSection([{ name: 'גושן', address: 'נחלת בנימין 30' }])),
    seo: {
      ...emptyDocument().seo,
      titleHe: 'המלצות למסעדות שוות - גרפיטיול',
      descriptionHe: 'תיאור',
      canonicalUrl: 'https://grafitiyul.co.il/restaurant-recommendations/',
    },
  };

  const { html, seo } = renderPage(doc, { locale: 'he' });

  assert.ok(html.includes('המלצות למסעדות שוות'), 'content is in the payload');
  assert.ok(html.includes('גושן'), 'cards are in the payload');
  assert.ok(pageStylesheet.includes('.gos-cards'), 'the stylesheet is shipped with the payload');
  assert.equal(seo.title, 'המלצות למסעדות שוות - גרפיטיול');
  assert.equal(seo.canonical, 'https://grafitiyul.co.il/restaurant-recommendations/');
  // No absolute dependency on the GOS app origin: a cached copy must not need it.
  assert.ok(!html.includes('app.grafitiyul.co.il'), 'rendered HTML never points back at the admin app');
});

// ── #13 No duplicate editable WordPress copy ──────────────────────────────
// The WP plugin only takes over a page whose WordPress content is EMPTY, and it
// renders from the GOS payload. This asserts the GOS half of that boundary: the
// public payload is READ-only in shape — it exposes no edit affordance, no admin
// URL and no draft — so nothing about it invites a second editing surface.
test('#13 the public payload exposes published content only, never a draft or an edit path', () => {
  const doc = docWith(cardsSection([{ name: 'x' }]));
  const { html, seo } = renderPage(doc, { locale: 'he' });
  const blob = JSON.stringify({ html, seo });
  for (const forbidden of ['/admin/', 'draft', 'api/site-pages', 'wp-admin']) {
    assert.ok(!blob.includes(forbidden), `public payload must not contain "${forbidden}"`);
  }
});
