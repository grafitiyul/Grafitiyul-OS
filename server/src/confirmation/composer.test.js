// Confirmation Email — composer tests. Pure: composeFromContext with fixtures,
// no DB. Covers language strictness, filler effects, overrides, warnings.
// Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import { composeFromContext, buildEmailHtml } from './composer.js';
import { mergeOverrides, overrideFor, withoutOverride, normalizeOverrideState } from './overrides.js';
import { defaultSections } from './sections.js';

// ── fixtures ─────────────────────────────────────────────────────────────────
const CANCEL_BLOCK = {
  id: 'sc_cancel',
  type: 'confirmation_cancellation_policy',
  internalName: 'מדיניות ביטול רגילה',
  bodyHe: '<p>מדיניות רגילה</p>',
  bodyEn: '<p>Standard policy</p>',
  active: true,
};
const BRING_BLOCK = {
  id: 'sc_bring',
  type: 'confirmation_what_to_bring',
  internalName: 'מה להביא',
  bodyHe: '<p>נעליים נוחות</p>',
  bodyEn: null,
  active: true,
};

function ctx(over = {}) {
  return {
    deal: {
      id: 'd1',
      tourDate: '2026-08-20',
      tourTime: '10:00',
      participants: 25,
      groups: null,
      durationHours: null,
      product: { nameHe: 'סיור גרפיטי', nameEn: 'Graffiti Tour' },
      location: {
        nameHe: 'תל אביב', nameEn: 'Tel Aviv',
        logisticsHe: '<p>חניה ברחוב</p>', logisticsEn: '<p>Street parking</p>',
        parentLocation: null,
      },
    },
    template: {
      id: 'tpl1',
      internalName: 'ברירת מחדל',
      sections: [
        ...defaultSections(),
        { kind: 'block', sharedContentId: 'sc_cancel', hidden: false },
        { kind: 'block', sharedContentId: 'sc_bring', hidden: false },
      ],
      subjectHe: 'אישור הזמנה', subjectEn: 'Booking confirmation',
      greetingHe: null, greetingEn: null, closingHe: null, closingEn: null,
      blockLinks: [{ sharedContent: CANCEL_BLOCK }, { sharedContent: BRING_BLOCK }],
    },
    contact: {
      id: 'c1', firstNameHe: 'דנה', lastNameHe: 'לוי', firstNameEn: 'Dana', lastNameEn: 'Levi',
      communicationLanguage: 'he',
    },
    email: 'dana@example.com',
    language: 'he',
    tour: { productVariant: { durationHours: 2 } },
    meetingPoint: {
      html: '<p>מתחת לשעון</p>', source: 'shared_content',
      image: { url: 'https://r2.example/mp.jpg', key: 'k', mimeType: 'image/jpeg' },
    },
    fillers: [],
    policyRow: null,
    persistentOverrides: null,
    ...over,
  };
}
const byId = (r, id) => r.sections.find((s) => s.id === id);

// ── basics ───────────────────────────────────────────────────────────────────

test('composes every visible section in template order, Hebrew defaults', () => {
  const r = composeFromContext(ctx());
  assert.equal(r.language, 'he');
  assert.equal(r.subject, 'אישור הזמנה');
  assert.equal(r.hasFillers, false);
  assert.equal(byId(r, 'greeting').html, '<p>היי דנה,</p>');
  assert.match(byId(r, 'tour_details').html, /סיור גרפיטי/);
  assert.match(byId(r, 'tour_details').html, /שעתיים/); // variant duration 2h
  assert.equal(byId(r, 'meeting_point').html, '<p>מתחת לשעון</p>');
  assert.match(byId(r, 'meeting_point_image').html, /https:\/\/r2\.example\/mp\.jpg/);
  assert.equal(byId(r, 'location_logistics').html, '<p>חניה ברחוב</p>');
  assert.equal(byId(r, 'special_terms'), undefined); // no fillers → nothing
  assert.equal(byId(r, 'block:sc_cancel').html, '<p>מדיניות רגילה</p>');
  assert.equal(r.warnings.length, 0);
});

test('English: strict language — greeting name, subject, block gap warning', () => {
  const r = composeFromContext(ctx({ language: 'en' }));
  assert.equal(byId(r, 'greeting').html, '<p>Hi Dana,</p>');
  assert.equal(r.subject, 'Booking confirmation');
  assert.match(byId(r, 'tour_details').html, /2 hours/);
  // BRING_BLOCK has no English → warning with otherLanguageHasContent
  const w = r.warnings.find((w) => w.sectionId === 'block:sc_bring');
  assert.ok(w && w.code === 'missing_content' && w.otherLanguageHasContent);
  assert.equal(byId(r, 'block:sc_bring').html, null);
});

test('English greeting with no English name is nameless, never Hebrew', () => {
  const c = ctx({ language: 'en' });
  c.contact = { ...c.contact, firstNameEn: '', lastNameEn: '' };
  const r = composeFromContext(c);
  assert.equal(byId(r, 'greeting').html, '<p>Hello,</p>');
});

test('hidden sections and inactive blocks are skipped', () => {
  const c = ctx();
  c.template = {
    ...c.template,
    sections: c.template.sections.map((s) =>
      s.key === 'closing' || s.sharedContentId === 'sc_bring' ? { ...s, hidden: true } : s,
    ),
  };
  const r = composeFromContext(c);
  assert.equal(byId(r, 'closing'), undefined);
  assert.equal(byId(r, 'block:sc_bring'), undefined);
});

test('no tour → meeting point empty with no_tour warning, image omitted', () => {
  const r = composeFromContext(ctx({ meetingPoint: null, tour: null }));
  assert.equal(byId(r, 'meeting_point').html, null);
  assert.equal(byId(r, 'meeting_point_image'), undefined);
  assert.ok(r.warnings.some((w) => w.code === 'no_tour'));
});

// ── fillers ──────────────────────────────────────────────────────────────────

test('duration filler: Deal.durationHours wins and the Customer Note rides along', () => {
  const c = ctx({
    fillers: [{ kind: 'activity_duration', durationHours: 3, noteHe: '<p>הוארך במיוחד</p>' }],
  });
  c.deal = { ...c.deal, durationHours: 3 };
  const r = composeFromContext(c);
  const td = byId(r, 'tour_details');
  assert.match(td.html, /3 שעות/);
  assert.match(td.html, /הוארך במיוחד/);
  assert.equal(td.data.durationOverridden, true);
  assert.equal(r.hasFillers, true);
});

test('cancellation filler mode=policy replaces the block from the chosen policy', () => {
  const r = composeFromContext(
    ctx({
      fillers: [{ kind: 'cancellation_policy', mode: 'policy', policyId: 'sc_flex' }],
      policyRow: {
        id: 'sc_flex', type: 'confirmation_cancellation_policy', internalName: 'גמישה',
        bodyHe: '<p>ביטול חופשי</p>', bodyEn: '<p>Free cancellation</p>', active: true,
      },
    }),
  );
  const s = byId(r, 'block:sc_cancel');
  assert.equal(s.html, '<p>ביטול חופשי</p>');
  assert.equal(s.source, 'filler_policy');
});

test('cancellation filler mode=override replaces with the Customer Note', () => {
  const r = composeFromContext(
    ctx({ fillers: [{ kind: 'cancellation_policy', mode: 'override', noteHe: '<p>סוכם אחרת</p>' }] }),
  );
  assert.equal(byId(r, 'block:sc_cancel').html, '<p>סוכם אחרת</p>');
});

test('deleted/inactive chosen policy → missing_policy warning, no silent fallback', () => {
  const r = composeFromContext(
    ctx({ fillers: [{ kind: 'cancellation_policy', mode: 'policy', policyId: 'sc_gone' }], policyRow: null }),
  );
  assert.equal(byId(r, 'block:sc_cancel').html, null);
  assert.ok(r.warnings.some((w) => w.code === 'missing_policy'));
});

test('special terms: new_guide + other_note items render in order', () => {
  const r = composeFromContext(
    ctx({
      fillers: [
        { kind: 'new_guide', noteHe: '<p>מדריך חדש</p>' },
        { kind: 'other_note', noteHe: '<p>עוד תנאי</p>' },
      ],
    }),
  );
  const s = byId(r, 'special_terms');
  assert.equal(s.title, 'תנאים מיוחדים שסוכמו');
  assert.equal(s.html, '<p>מדריך חדש</p><p>עוד תנאי</p>');
  assert.equal(s.data.items.length, 2);
});

// ── overrides ────────────────────────────────────────────────────────────────

test('persistent override replaces html; overlay (one-shot) beats persistent', () => {
  const c = ctx({
    persistentOverrides: { sections: { greeting: { html: '<p>פתיח קבוע</p>' } } },
  });
  const r1 = composeFromContext(c);
  assert.equal(byId(r1, 'greeting').html, '<p>פתיח קבוע</p>');
  assert.equal(byId(r1, 'greeting').overridden, true);
  const r2 = composeFromContext(c, {
    overrideOverlay: { sections: { greeting: { html: '<p>פתיח חד-פעמי</p>' } } },
  });
  assert.equal(byId(r2, 'greeting').html, '<p>פתיח חד-פעמי</p>');
});

test('warnings: missing subject language + missing recipient email', () => {
  const c = ctx({ language: 'en', email: null });
  c.template = { ...c.template, subjectEn: null };
  const r = composeFromContext(c);
  assert.ok(r.warnings.some((w) => w.code === 'missing_subject' && w.otherLanguageHasContent));
  assert.ok(r.warnings.some((w) => w.code === 'no_recipient_email'));
});

// ── buildEmailHtml ───────────────────────────────────────────────────────────

test('email HTML: internal block names never render; customer titles do', () => {
  const r = composeFromContext(
    ctx({ fillers: [{ kind: 'other_note', noteHe: '<p>תנאי</p>' }] }),
  );
  const html = buildEmailHtml(r);
  // block internal name must NOT appear
  assert.doesNotMatch(html, /מדיניות ביטול רגילה/);
  assert.match(html, /<p>מדיניות רגילה<\/p>/);
  // special_terms customer title DOES appear as a heading
  assert.match(html, /<h3>תנאים מיוחדים שסוכמו<\/h3>/);
  assert.match(html, /<p>תנאי<\/p>/);
});

test('email HTML: an operator override title renders as a customer heading', () => {
  const r = composeFromContext(ctx(), {
    overrideOverlay: { sections: { 'block:sc_bring': { html: '<p>ציוד</p>', title: 'מה להביא לסיור' } } },
  });
  const html = buildEmailHtml(r);
  assert.match(html, /<h3>מה להביא לסיור<\/h3>/);
});

test('email HTML: empty sections are skipped entirely', () => {
  const r = composeFromContext(ctx({ language: 'en' })); // sc_bring has no English
  const html = buildEmailHtml(r);
  assert.doesNotMatch(html, /נעליים/);
  assert.match(html, /Standard policy/);
});

// ── overrides.js unit ────────────────────────────────────────────────────────

test('mergeOverrides: field-level, overlay wins, empty → null', () => {
  assert.equal(mergeOverrides(null, null), null);
  const m = mergeOverrides(
    { sections: { a: { html: '<p>x</p>', title: 'ת' } } },
    { sections: { a: { html: '<p>y</p>' }, b: { title: 'ב' } } },
  );
  assert.deepEqual(m.sections.a, { html: '<p>y</p>', title: 'ת' });
  assert.deepEqual(m.sections.b, { title: 'ב' });
});

test('overrideFor/withoutOverride/normalizeOverrideState', () => {
  const state = { sections: { a: { html: '<p>x</p>' }, junk: { html: '   ' } } };
  assert.deepEqual(overrideFor(state, 'a'), { html: '<p>x</p>', title: null });
  assert.equal(overrideFor(state, 'junk'), null);
  assert.equal(withoutOverride({ sections: { a: { html: '<p>x</p>' } } }, 'a'), null);
  assert.deepEqual(normalizeOverrideState(state), { sections: { a: { html: '<p>x</p>' } } });
  assert.equal(normalizeOverrideState({ sections: { junk: { html: ' ' } } }), null);
});
