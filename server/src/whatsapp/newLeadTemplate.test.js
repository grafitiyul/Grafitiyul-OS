import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStarredTemplate,
  setNewLeadDefault,
  clearNewLeadDefault,
  setActive,
  templateLanguages,
  TemplateNotStarrableError,
} from './newLeadTemplate.js';

// A focused stand-in for the WhatsAppTemplate table. It models the query shapes
// this module uses and nothing else, so a wrong assumption fails loudly instead
// of quietly passing.
function createDb(rows = []) {
  const templates = rows.map((r) => ({
    bodyHeHtml: null, bodyEnHtml: null, isActive: true, isNewLeadDefault: false, updatedAt: new Date(), ...r,
  }));
  const match = (row, where) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'not' in v) return row[k] !== v.not;
      return row[k] === v;
    });

  const client = {
    _rows: templates,
    $transaction: async (fn) => fn(client),
    whatsAppTemplate: {
      findFirst: async ({ where }) => templates.find((r) => match(r, where)) || null,
      findUnique: async ({ where }) => templates.find((r) => r.id === where.id) || null,
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const r of templates) if (match(r, where)) { Object.assign(r, data); count++; }
        return { count };
      },
      update: async ({ where, data }) => {
        const row = templates.find((r) => r.id === where.id);
        if (!row) throw new Error('not_found');
        Object.assign(row, data);
        return row;
      },
    },
  };
  return client;
}

const starredIds = (db) => db._rows.filter((r) => r.isNewLeadDefault).map((r) => r.id);

test('star: at most one template can hold it — starring clears the previous', async () => {
  const db = createDb([
    { id: 'a', nameHe: 'A', isNewLeadDefault: true },
    { id: 'b', nameHe: 'B' },
    { id: 'c', nameHe: 'C' },
  ]);
  await setNewLeadDefault(db, 'b');
  assert.deepEqual(starredIds(db), ['b'], 'exactly one template may be starred');

  await setNewLeadDefault(db, 'c');
  assert.deepEqual(starredIds(db), ['c']);
});

test('star: zero starred templates is a valid state', async () => {
  const db = createDb([{ id: 'a', nameHe: 'A', isNewLeadDefault: true }]);
  await clearNewLeadDefault(db);
  assert.deepEqual(starredIds(db), []);
  assert.equal(await getStarredTemplate(db), null, 'no star ⇒ no automatic reply');
});

test('star: an inactive template cannot be starred', async () => {
  const db = createDb([{ id: 'a', nameHe: 'A', isActive: false }]);
  await assert.rejects(
    () => setNewLeadDefault(db, 'a'),
    (err) => err instanceof TemplateNotStarrableError && err.code === 'template_inactive',
  );
  assert.deepEqual(starredIds(db), [], 'a rejected star must not be half-applied');
});

test('star: a missing template is rejected, not silently ignored', async () => {
  const db = createDb([{ id: 'a', nameHe: 'A' }]);
  await assert.rejects(
    () => setNewLeadDefault(db, 'ghost'),
    (err) => err instanceof TemplateNotStarrableError && err.code === 'not_found',
  );
});

test('star: deactivating the starred template clears the star', async () => {
  const db = createDb([{ id: 'a', nameHe: 'A', isNewLeadDefault: true }]);
  await setActive(db, 'a', false);
  assert.deepEqual(starredIds(db), [], 'a paused template must stop answering customers');
  assert.equal(await getStarredTemplate(db), null);
});

test('star: reactivating a template does NOT silently restore the star', async () => {
  const db = createDb([{ id: 'a', nameHe: 'A', isNewLeadDefault: true }]);
  await setActive(db, 'a', false);
  await setActive(db, 'a', true);
  assert.deepEqual(starredIds(db), [], 'turning a template back on is not consent to auto-send');
});

// Belt and braces: even if a star somehow survived on an inactive row (a manual
// DB edit, a legacy write), the send path must treat it as no template at all.
test('star: an inactive row holding a star is never returned to the send path', async () => {
  const db = createDb([{ id: 'a', nameHe: 'A', isActive: false, isNewLeadDefault: true }]);
  assert.equal(await getStarredTemplate(db), null);
});

test('star: getStarredTemplate returns both language bodies for the send path', async () => {
  const db = createDb([
    { id: 'a', nameHe: 'ברוכים הבאים', bodyHeHtml: '<p>שלום</p>', bodyEnHtml: '<p>Hi</p>', isNewLeadDefault: true },
  ]);
  const t = await getStarredTemplate(db);
  assert.equal(t.id, 'a');
  assert.deepEqual(templateLanguages(t), { he: true, en: true });
});

test('templateLanguages: empty and whitespace-only bodies count as absent', () => {
  assert.deepEqual(templateLanguages({ bodyHeHtml: '<p>שלום</p>', bodyEnHtml: null }), { he: true, en: false });
  assert.deepEqual(templateLanguages({ bodyHeHtml: '   ', bodyEnHtml: '<p>Hi</p>' }), { he: false, en: true });
  assert.deepEqual(templateLanguages(null), { he: false, en: false });
});
