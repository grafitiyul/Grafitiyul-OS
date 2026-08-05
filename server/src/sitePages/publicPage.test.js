import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveLocale, renderPublicPageHtml, renderNotFoundHtml, buildSitemapXml } from './publicPage.js';
import { makeSection, emptyDocument, localeContentCount } from '../../../shared/sitePage.mjs';

// The public GOS-domain pages (/pages/:slug): ONE generic shell over the
// published payload. These tests cover the behaviours the owner specified for
// the 2026-08-05 GOS-hosted publication: per-page default language, explicit
// ?lang that survives deep links, strict languages with an honest coming-soon
// page, per-page indexing, and no admin metadata.

function bilingualDoc() {
  const hero = makeSection('hero');
  hero.titleHe = 'מחירון סוכנים';
  hero.titleEn = 'Agents Price List';
  const text = makeSection('richText');
  text.headingHe = 'הערות';
  text.headingEn = 'Notes';
  text.htmlHe = '<p>תוכן בעברית</p>';
  text.htmlEn = '<p>English content</p>';
  return { ...emptyDocument(), titleHe: 'מחירון', titleEn: 'Price list', sections: [hero, text] };
}

function hebrewOnlyDoc() {
  const hero = makeSection('hero');
  hero.titleHe = 'המלצות למסעדות';
  const text = makeSection('richText');
  text.headingHe = 'המלצות';
  text.htmlHe = '<p>רשימת מסעדות</p>';
  return { ...emptyDocument(), titleHe: 'המלצות למסעדות', sections: [hero, text] };
}

const published = (content, defaultLanguage = 'he', extra = {}) => ({
  slug: 'test-page',
  pageType: 'info',
  defaultLanguage,
  versionId: 'ver_1',
  versionNo: 1,
  publishedAt: new Date('2026-08-05'),
  content,
  ...extra,
});

// ── default language + explicit choice (behaviours 3, 4, 5, 6) ─────────────
test('no ?lang → the page opens in ITS configured default language', () => {
  assert.equal(resolveLocale('he', undefined), 'he');
  assert.equal(resolveLocale('en', undefined), 'en');
  assert.equal(resolveLocale('nonsense', undefined), 'he', 'unknown config degrades to Hebrew');
});

test('an explicit ?lang always wins over the default and over any guess', () => {
  assert.equal(resolveLocale('he', 'en'), 'en');
  assert.equal(resolveLocale('en', 'he'), 'he');
  assert.equal(resolveLocale('en', 'fr'), 'en', 'junk lang param falls back to the page default');
});

test('a Hebrew-default page renders RTL Hebrew; the English deep link renders LTR English', () => {
  const doc = bilingualDoc();
  const he = renderPublicPageHtml(published(doc, 'he'), {});
  assert.equal(he.locale, 'he');
  assert.match(he.html, /<html lang="he" dir="rtl">/);
  assert.ok(he.html.includes('תוכן בעברית'));
  assert.ok(!he.html.includes('English content'));

  const en = renderPublicPageHtml(published(doc, 'he'), { langParam: 'en' });
  assert.equal(en.locale, 'en');
  assert.match(en.html, /<html lang="en" dir="ltr">/);
  assert.ok(en.html.includes('English content'));
  assert.ok(!en.html.includes('תוכן בעברית'));
});

test('an English-default page opens in English with no lang param', () => {
  const r = renderPublicPageHtml(published(bilingualDoc(), 'en'), {});
  assert.equal(r.locale, 'en');
  assert.match(r.html, /<html lang="en" dir="ltr">/);
});

// ── the language switcher (behaviour 5) ────────────────────────────────────
test('both language links are always present, with the active one marked', () => {
  const { html } = renderPublicPageHtml(published(bilingualDoc(), 'en'), {});
  assert.match(html, /<a href="\?lang=he"[^>]*>עברית<\/a>/);
  assert.match(html, /<a href="\?lang=en"[^>]*aria-current="true"[^>]*>English<\/a>/);
});

// ── missing content (behaviour 7) ──────────────────────────────────────────
test('a locale with zero content gets the honest coming-soon page, never mixed language', () => {
  const doc = hebrewOnlyDoc();
  assert.equal(localeContentCount(doc, 'en'), 0);
  const r = renderPublicPageHtml(published(doc, 'he'), { langParam: 'en' });
  assert.equal(r.comingSoon, true);
  assert.ok(r.html.includes('English version coming soon'));
  assert.ok(!r.html.includes('רשימת מסעדות'), 'Hebrew content must not leak into the placeholder');
  assert.match(r.html, /noindex,nofollow/, 'the placeholder variant is never indexable');
  assert.match(r.html, /href="\?lang=he"/, 'a way back to the language that exists');
});

// ── indexing (behaviours 8, 9) ─────────────────────────────────────────────
test('an indexable page emits NO robots restriction and carries its canonical', () => {
  const doc = bilingualDoc();
  doc.seo.noindex = false;
  const { html } = renderPublicPageHtml(published(doc, 'he'), { canonicalUrl: 'https://app.grafitiyul.co.il/pages/test-page' });
  assert.ok(!html.includes('noindex'));
  assert.match(html, /<link rel="canonical" href="https:\/\/app\.grafitiyul\.co\.il\/pages\/test-page">/);
  assert.match(html, /hreflang="en"/, 'language alternates advertised for indexable pages');
});

test('a noindex page emits noindex,nofollow', () => {
  const doc = bilingualDoc();
  doc.seo.noindex = true;
  const { html } = renderPublicPageHtml(published(doc, 'he'), {});
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
});

// ── sitemap (behaviour 10) ─────────────────────────────────────────────────
test('the sitemap lists indexable pages only — a noindex page never appears', () => {
  const xml = buildSitemapXml(
    [
      { slug: 'restaurant-recommendations', publishedAt: '2026-08-05', noindex: false },
      { slug: 'agent-price-list', publishedAt: '2026-08-05', noindex: true },
    ],
    (slug) => `https://app.grafitiyul.co.il/pages/${slug}`,
  );
  assert.ok(xml.includes('restaurant-recommendations'));
  assert.ok(!xml.includes('agent-price-list'));
  assert.match(xml, /^<\?xml version="1\.0"/);
});

// ── no admin metadata (behaviour 11) ───────────────────────────────────────
test('the public shell exposes no admin routes, drafts or internal ids', () => {
  const r = renderPublicPageHtml(published(bilingualDoc(), 'he'), {});
  for (const forbidden of ['/admin/', 'draft', 'api/site-pages', 'wp-admin', 'ver_1']) {
    assert.ok(!r.html.includes(forbidden), `public page must not contain "${forbidden}"`);
  }
  assert.ok(!renderNotFoundHtml().includes('/admin/'));
});

// ── one generic renderer (behaviour 12) ────────────────────────────────────
test('both real pages flow through the SAME generic code path', () => {
  // Different slugs, different defaults, same function, same shell markers.
  const a = renderPublicPageHtml(published(hebrewOnlyDoc(), 'he', { slug: 'restaurant-recommendations' }), {});
  const b = renderPublicPageHtml(published(bilingualDoc(), 'en', { slug: 'agent-price-list' }), {});
  for (const r of [a, b]) {
    assert.ok(r.html.includes('gos-shell__header'));
    assert.ok(r.html.includes('gos-shell__lang'));
    assert.ok(r.html.includes('gos-shell__footer'));
  }
});
