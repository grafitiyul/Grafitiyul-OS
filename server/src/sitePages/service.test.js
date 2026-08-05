import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __useTestDb, createPage, saveDraft, publishPage, rollbackPage,
  unpublishPage, getPublishedBySlug, getPage,
} from './service.js';
import { makeSection, emptyDocument } from '../../../shared/sitePage.mjs';

// The draft ⇄ published invariants, proved against an in-memory double of the
// two Prisma models. What is under test is this module's LOGIC — that editing a
// draft cannot change the live page, that publishing is idempotent, that
// rollback re-points rather than rewrites — none of which needs Postgres.
//
// The double implements only the queries service.js actually issues; if the
// service starts using a call the double lacks, these tests fail loudly rather
// than silently passing, which is the behaviour we want from a fake.

function makeDb() {
  const pages = new Map();
  const versions = new Map();
  let seq = 0;
  const id = (p) => `${p}_${++seq}`;

  const withRelations = (page, include) => {
    if (!page) return null;
    const out = { ...page };
    if (include?.publishedVersion) out.publishedVersion = page.publishedVersionId ? { ...versions.get(page.publishedVersionId) } : null;
    if (include?.versions) {
      out.versions = [...versions.values()]
        .filter((v) => v.pageId === page.id)
        .sort((a, b) => b.versionNo - a.versionNo);
    }
    return out;
  };

  return {
    _pages: pages,
    _versions: versions,
    sitePage: {
      async findUnique({ where, include }) {
        const page = where.id
          ? pages.get(where.id)
          : [...pages.values()].find((p) => p.slug === where.slug);
        return withRelations(page, include);
      },
      async findMany() { return [...pages.values()]; },
      async create({ data }) {
        const row = { id: id('page'), publishedVersionId: null, publishedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        pages.set(row.id, row);
        return { ...row };
      },
      async update({ where, data }) {
        const row = pages.get(where.id);
        if (!row) throw new Error('page not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
      async delete({ where }) { pages.delete(where.id); },
    },
    sitePageVersion: {
      async create({ data }) {
        const row = { id: id('ver'), publishedAt: new Date(), ...data };
        versions.set(row.id, row);
        return { ...row };
      },
      async findFirst({ where, orderBy }) {
        const list = [...versions.values()].filter((v) => v.pageId === where.pageId);
        list.sort((a, b) => (orderBy?.versionNo === 'desc' ? b.versionNo - a.versionNo : a.versionNo - b.versionNo));
        return list[0] ? { ...list[0] } : null;
      },
      async findUnique({ where }) { const v = versions.get(where.id); return v ? { ...v } : null; },
    },
  };
}

const textSection = (text) => {
  const s = makeSection('richText');
  s.headingHe = text;
  s.htmlHe = `<p>${text}</p>`;
  return s;
};

const docOf = (text) => ({ ...emptyDocument(), sections: [textSection(text)] });

async function seedPublished(text = 'גרסה ראשונה') {
  const page = await createPage({ internalName: 'עמוד בדיקה', pageType: 'info', slug: 'test-page' });
  await saveDraft(page.id, { document: docOf(text) });
  const { version } = await publishPage(page.id, {});
  return { pageId: page.id, version };
}

test.beforeEach(() => __useTestDb(makeDb()));
test.after(() => __useTestDb(null));

// ── #1 A draft is never publicly visible ───────────────────────────────────
test('#1 an unpublished page is not addressable through the public read', async () => {
  const page = await createPage({ internalName: 'סודי', pageType: 'info', slug: 'secret-page' });
  await saveDraft(page.id, { document: docOf('תוכן שלא פורסם') });

  assert.equal(await getPublishedBySlug('secret-page'), null);
});

// ── #2 A published version renders publicly ────────────────────────────────
test('#2 after publish the public read returns the frozen content', async () => {
  const { pageId } = await seedPublished('תוכן חי');
  const published = await getPublishedBySlug('test-page');

  assert.ok(published, 'published page must be readable');
  assert.equal(published.slug, 'test-page');
  assert.equal(published.versionNo, 1);
  assert.equal(published.content.sections[0].htmlHe, '<p>תוכן חי</p>');
  assert.equal((await getPage(pageId)).status, 'published');
});

// ── #3 Draft edits do not change the live page ─────────────────────────────
test('#3 editing the draft after publish leaves the live page byte-identical', async () => {
  const { pageId } = await seedPublished('הגרסה שפורסמה');
  const before = await getPublishedBySlug('test-page');

  await saveDraft(pageId, { document: docOf('טיוטה חדשה לגמרי') });

  const after = await getPublishedBySlug('test-page');
  assert.deepEqual(after.content, before.content, 'live content must not move');
  assert.equal(after.versionId, before.versionId, 'live version pointer must not move');

  const row = await getPage(pageId);
  assert.equal(row.draftDirty, true, 'the page is flagged as having unpublished changes');
  assert.equal(row.draft.sections[0].htmlHe, '<p>טיוטה חדשה לגמרי</p>', 'the draft did change');
});

// ── #4 Publish updates the public version exactly once ─────────────────────
test('#4 publishing twice with no edit does not mint a second version', async () => {
  const { pageId } = await seedPublished('יציב');

  const second = await publishPage(pageId, {});
  assert.equal(second.created, false, 'no new version for an unchanged draft');
  assert.equal(second.version.versionNo, 1);

  const page = await getPage(pageId);
  assert.equal(page.versions.length, 1);
  assert.equal(page.draftDirty, false);
});

test('#4 publishing after a real edit mints exactly one new version and moves the pointer', async () => {
  const { pageId } = await seedPublished('ראשון');
  await saveDraft(pageId, { document: docOf('שני') });

  const result = await publishPage(pageId, {});
  assert.equal(result.created, true);
  assert.equal(result.version.versionNo, 2);

  const live = await getPublishedBySlug('test-page');
  assert.equal(live.versionNo, 2);
  assert.equal(live.content.sections[0].htmlHe, '<p>שני</p>');
  assert.equal((await getPage(pageId)).versions.length, 2);
});

// ── #5 Rollback restores a previous version ────────────────────────────────
test('#5 rollback re-points at the old version without rewriting it', async () => {
  const { pageId, version: v1 } = await seedPublished('גרסה 1');
  await saveDraft(pageId, { document: docOf('גרסה 2') });
  const { version: v2 } = await publishPage(pageId, {});

  assert.equal((await getPublishedBySlug('test-page')).versionNo, 2);

  await rollbackPage(pageId, v1.id, {});
  const live = await getPublishedBySlug('test-page');
  assert.equal(live.versionNo, 1);
  assert.equal(live.content.sections[0].htmlHe, '<p>גרסה 1</p>');

  // the newer version still exists untouched — rollback is not a delete
  const page = await getPage(pageId);
  assert.equal(page.versions.length, 2);
  const stillThere = page.versions.find((v) => v.id === v2.id);
  assert.ok(stillThere, 'the rolled-past version is retained');
});

test('#5 rollback leaves the working draft alone', async () => {
  const { pageId, version: v1 } = await seedPublished('גרסה 1');
  await saveDraft(pageId, { document: docOf('גרסה 2') });
  await publishPage(pageId, {});
  await saveDraft(pageId, { document: docOf('עבודה בתהליך') });

  await rollbackPage(pageId, v1.id, {});
  const page = await getPage(pageId);
  assert.equal(page.draft.sections[0].htmlHe, '<p>עבודה בתהליך</p>');
});

// ── #1 again: unpublish removes it from the public surface, keeps history ──
test('#1 unpublish makes the page publicly invisible but keeps its versions', async () => {
  const { pageId } = await seedPublished('פורסם');
  await unpublishPage(pageId);

  assert.equal(await getPublishedBySlug('test-page'), null);
  assert.equal((await getPage(pageId)).versions.length, 1);
});

// ── content safety on the write path ───────────────────────────────────────
test('a script pasted into the draft is stripped before it is ever stored', async () => {
  const page = await createPage({ internalName: 'x', pageType: 'info', slug: 'xss-page' });
  const s = makeSection('richText');
  s.htmlHe = '<p>ok</p><script>alert(1)</script>';
  await saveDraft(page.id, { document: { ...emptyDocument(), sections: [s] } });

  const row = await getPage(page.id);
  assert.equal(row.draft.sections[0].htmlHe, '<p>ok</p>');

  await publishPage(page.id, {});
  const live = await getPublishedBySlug('xss-page');
  assert.ok(!JSON.stringify(live.content).includes('<script'));
});

// ── frozen pricing: no silent price change after publish ───────────────────
test('a published price list keeps its frozen amounts when the draft price changes', async () => {
  const priceDoc = (amountMinor) => {
    const s = makeSection('pricing');
    s.headingHe = 'מחירון';
    s.rows = [{
      id: 'pr_test', hidden: false,
      titleHe: 'סיור גרפיטי', titleEn: 'Graffiti Tour',
      metaHe: '', metaEn: '', notesHe: '', notesEn: '',
      lines: [{ id: 'pl_test', kind: 'fixed', upto: null, amountMinor, labelHe: '', labelEn: '' }],
      variantId: 'var_x', cardGroupId: 'card_x',
    }];
    return { ...emptyDocument(), sections: [s] };
  };

  const page = await createPage({ internalName: 'מחירון סוכנים', pageType: 'price_list', slug: 'agent-price-list' });
  await saveDraft(page.id, { document: priceDoc(130000) });
  await publishPage(page.id, {});

  // The canonical Pricing Card moved (or an operator retyped) — draft updates…
  await saveDraft(page.id, { document: priceDoc(150000) });

  // …but the LIVE page still carries the frozen amount until a new publish.
  const live = await getPublishedBySlug('agent-price-list');
  assert.equal(live.content.sections[0].rows[0].lines[0].amountMinor, 130000);

  const { version } = await publishPage(page.id, {});
  assert.equal(version.versionNo, 2);
  assert.equal((await getPublishedBySlug('agent-price-list')).content.sections[0].rows[0].lines[0].amountMinor, 150000);
});

test('a duplicate slug is rejected rather than silently overwriting a page', async () => {
  await createPage({ internalName: 'a', pageType: 'info', slug: 'same-slug' });
  await assert.rejects(
    () => createPage({ internalName: 'b', pageType: 'info', slug: 'same-slug' }),
    /slug_taken/,
  );
});
