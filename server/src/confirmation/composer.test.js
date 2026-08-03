// Confirmation Email — composer tests. Pure: composeFromContext with fixtures,
// no DB. Covers language strictness, filler effects, overrides, warnings.
// Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import { composeFromContext, buildEmailHtml } from './composer.js';
import { mergeOverrides, overrideFor, withoutOverride, normalizeOverrideState } from './overrides.js';
import { defaultSections } from './sections.js';

// ── fixtures ─────────────────────────────────────────────────────────────────
// Cancellation policies are ConfirmationSpecialText rows (CRM Settings), NOT
// Shared Content blocks — the composer renders them in the auto section.
const DEFAULT_POLICY = {
  id: 'st_default',
  internalName: 'מדיניות ביטול רגילה',
  bodyHe: '<p>מדיניות רגילה</p>',
  bodyEn: '<p>Standard policy</p>',
  active: true,
  isDefault: true,
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
        { kind: 'block', sharedContentId: 'sc_bring', hidden: false },
      ],
      subjectHe: 'אישור הזמנה', subjectEn: 'Booking confirmation',
      greetingHe: null, greetingEn: null, closingHe: null, closingEn: null,
      blockLinks: [{ sharedContent: BRING_BLOCK }],
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
    // ONE special-text context for every category (cancellation, new guide…).
    specialTexts: { byId: {}, defaults: { cancellation_policy: DEFAULT_POLICY } },
    persistentOverrides: null,
    ...over,
  };
}
// Convenience: a context whose special-text world is exactly these rows.
const withSpecial = ({ byId = {}, defaults = {} } = {}, over = {}) =>
  ctx({ specialTexts: { byId, defaults: { cancellation_policy: DEFAULT_POLICY, ...defaults } }, ...over });
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
  // Cancellation = auto section fed by the category DEFAULT special text.
  assert.equal(byId(r, 'cancellation_policy').html, '<p>מדיניות רגילה</p>');
  assert.equal(byId(r, 'cancellation_policy').source, 'default');
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

test('cancellation filler mode=policy renders the CHOSEN predefined policy', () => {
  const r = composeFromContext(
    withSpecial(
      {
        byId: {
          st_flex: {
            id: 'st_flex', category: 'cancellation_policy', internalName: 'גמישה',
            bodyHe: '<p>ביטול חופשי</p>', bodyEn: '<p>Free cancellation</p>', active: true, isDefault: false,
          },
        },
      },
      { fillers: [{ kind: 'cancellation_policy', mode: 'policy', specialTextId: 'st_flex' }] },
    ),
  );
  const s = byId(r, 'cancellation_policy');
  assert.equal(s.html, '<p>ביטול חופשי</p>');
  assert.equal(s.source, 'filler_policy');
  assert.equal(s.sourceLabel, 'נוסח מוגדר מראש — גמישה');
});

test('cancellation filler mode=override renders the deal Customer Note', () => {
  const r = composeFromContext(
    ctx({ fillers: [{ kind: 'cancellation_policy', mode: 'override', noteHe: '<p>סוכם אחרת</p>' }] }),
  );
  const s = byId(r, 'cancellation_policy');
  assert.equal(s.html, '<p>סוכם אחרת</p>');
  assert.equal(s.source, 'filler_override');
});

test('mode=default falls back to the category default policy', () => {
  const r = composeFromContext(ctx({ fillers: [{ kind: 'cancellation_policy', mode: 'default' }] }));
  assert.equal(byId(r, 'cancellation_policy').html, '<p>מדיניות רגילה</p>');
});

test('deleted/inactive chosen policy → missing_policy warning, no silent fallback', () => {
  const r = composeFromContext(
    ctx({ fillers: [{ kind: 'cancellation_policy', mode: 'policy', specialTextId: 'st_gone' }] }),
  );
  assert.equal(byId(r, 'cancellation_policy').html, null);
  assert.ok(r.warnings.some((w) => w.code === 'missing_policy'));
});

test('no default policy configured at all → warning, never a silent empty', () => {
  const r = composeFromContext(ctx({ specialTexts: { byId: {}, defaults: {} } }));
  const s = byId(r, 'cancellation_policy');
  assert.equal(s.html, null);
  assert.equal(s.sourceLabel, 'לא הוגדרה ברירת מחדל');
  assert.ok(r.warnings.some((w) => w.code === 'missing_policy'));
});

test('activity language comes from the TOUR, never the communication language', () => {
  const c = ctx();
  c.deal = { ...c.deal, tourLanguage: 'he' };
  c.tour = { ...c.tour, tourLanguage: 'en' }; // booked tour runs in English
  c.template = { ...c.template, greetingHe: '<p>שפה: {{tour_language}}</p>' };
  const r = composeFromContext(c);
  assert.equal(byId(r, 'greeting').html, '<p>שפה: אנגלית</p>');
});

test('special terms: new_guide + other_note items render in order', () => {
  const r = composeFromContext(
    ctx({
      fillers: [
        { kind: 'new_guide', mode: 'override', noteHe: '<p>מדריך חדש</p>' },
        { kind: 'other_note', noteHe: '<p>עוד תנאי</p>' },
      ],
    }),
  );
  const s = byId(r, 'special_terms');
  assert.equal(s.title, 'תנאים מיוחדים שסוכמו');
  assert.equal(s.html, '<p>מדריך חדש</p><p>עוד תנאי</p>');
  assert.equal(s.data.items.length, 2);
});

// ── new_guide resolves through the SAME special-text path as cancellation ───

test('new_guide default wording comes from the category ★ default', () => {
  const r = composeFromContext(
    withSpecial(
      {
        defaults: {
          new_guide: {
            id: 'st_ng', category: 'new_guide', internalName: 'נוסח מדריך חדש רגיל',
            bodyHe: '<p>מדריך חדש יעביר את הפעילות</p>', bodyEn: '<p>A new guide will lead</p>',
            active: true, isDefault: true,
          },
        },
      },
      { fillers: [{ kind: 'new_guide', mode: 'default' }] },
    ),
  );
  const item = byId(r, 'special_terms').data.items[0];
  assert.equal(item.html, '<p>מדריך חדש יעביר את הפעילות</p>');
  assert.equal(item.sourceLabel, 'ברירת מחדל — נוסח מדריך חדש רגיל');
  assert.equal(r.warnings.length, 0);
});

test('new_guide with NO configured default warns instead of sending empty', () => {
  const r = composeFromContext(ctx({ fillers: [{ kind: 'new_guide', mode: 'default' }] }));
  const item = byId(r, 'special_terms').data.items[0];
  assert.equal(item.html, null);
  assert.equal(item.sourceLabel, 'לא הוגדרה ברירת מחדל');
  assert.ok(r.warnings.some((w) => w.code === 'missing_policy' && w.label === 'מדריך חדש'));
});

test('a legacy new_guide row (bare note, no mode) still resolves as an override', () => {
  const r = composeFromContext(ctx({ fillers: [{ kind: 'new_guide', noteHe: '<p>נוסח ישן</p>' }] }));
  const item = byId(r, 'special_terms').data.items[0];
  assert.equal(item.html, '<p>נוסח ישן</p>');
  assert.equal(item.source, 'filler_override');
});

// ── internal source labels (office-only, never in the email) ────────────────

test('sourceLabel is internal: it never reaches the rendered email HTML', () => {
  const r = composeFromContext(
    ctx({ fillers: [{ kind: 'cancellation_policy', mode: 'default' }] }),
  );
  assert.equal(byId(r, 'cancellation_policy').sourceLabel, 'ברירת מחדל — מדיניות ביטול רגילה');
  assert.doesNotMatch(r.emailHtml, /ברירת מחדל/);
  assert.doesNotMatch(r.emailHtml, /מדיניות ביטול רגילה/); // the internal NAME
  assert.match(r.emailHtml, /<p>מדיניות רגילה<\/p>/); // the customer TEXT
});

test('a deal duration override is flagged internally on tour details', () => {
  const c = ctx({ fillers: [{ kind: 'activity_duration', durationHours: 3 }] });
  c.deal = { ...c.deal, durationHours: 3 };
  const r = composeFromContext(c);
  assert.match(byId(r, 'tour_details').sourceLabel, /משך מותאם לעסקה זו/);
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

// ── QA polish: labeled warnings + assembled emailHtml ────────────────────────

test('every warning names its section with an operator-facing label', () => {
  const c = ctx({ language: 'en', email: null, meetingPoint: null, tour: null });
  c.template = { ...c.template, subjectEn: null };
  const r = composeFromContext(c);
  const byCode = Object.fromEntries(r.warnings.map((w) => [w.code, w]));
  assert.equal(byCode.missing_content.label, 'מה להביא'); // block internal name
  assert.equal(byCode.no_tour.label, 'נקודת מפגש');
  assert.equal(byCode.missing_subject.label, 'נושא המייל');
  assert.equal(byCode.no_recipient_email.label, 'נמען');
});

test('auto-section language gaps use the section vocabulary label', () => {
  const c = ctx({ language: 'en' });
  c.deal = {
    ...c.deal,
    location: { ...c.deal.location, logisticsEn: null }, // English gap, Hebrew exists
  };
  const r = composeFromContext(c);
  const w = r.warnings.find((x) => x.sectionId === 'location_logistics');
  assert.equal(w.label, 'לוגיסטיקה במיקום');
  assert.ok(w.otherLanguageHasContent);
});

test('compose returns emailHtml — the exact assembled+sanitized send body', () => {
  const r = composeFromContext(ctx({ fillers: [{ kind: 'other_note', noteHe: '<p>תנאי</p>' }] }));
  assert.ok(r.emailHtml.includes('<h3>תנאים מיוחדים שסוכמו</h3>'));
  assert.ok(r.emailHtml.includes('מדיניות רגילה'));
  assert.doesNotMatch(r.emailHtml, /מדיניות ביטול רגילה/); // internal names never leak
});

// ── variable substitution (ONE catalog: preview == send) ────────────────────

test('tokens in template overrides substitute with catalog values', () => {
  const c = ctx({
    persistentOverrides: {
      sections: { greeting: { html: '<p>היי {{customer_first_name}}, נתראה ב{{tour_city}}!</p>' } },
    },
  });
  const r = composeFromContext(c);
  assert.equal(byId(r, 'greeting').html, '<p>היי דנה, נתראה בתל אביב!</p>');
  assert.match(r.emailHtml, /היי דנה, נתראה בתל אביב!/);
  assert.equal(r.warnings.length, 0);
});

test('chip spans substitute too (data-field-key form)', () => {
  const c = ctx();
  c.template = {
    ...c.template,
    greetingHe: '<p>שלום <span data-type="dynamic-field" data-field-key="customer_full_name">שם מלא</span></p>',
  };
  const r = composeFromContext(c);
  assert.equal(byId(r, 'greeting').html, '<p>שלום דנה לוי</p>');
});

test('subject tokens substitute; empty-value token warns with its label', () => {
  const c = ctx();
  c.template = { ...c.template, subjectHe: 'אישור הזמנה {{deal_number}} — {{org_name}}' };
  c.deal = { ...c.deal, orderNo: 27123 };
  const r = composeFromContext(c);
  assert.equal(r.subject, 'אישור הזמנה 27123 — ');
  const w = r.warnings.find((x) => x.code === 'missing_variable');
  assert.equal(w.label, 'שם הארגון');
});

test('unknown token stays raw and warns; staff keys are NOT resolvable', () => {
  const c = ctx({
    persistentOverrides: { sections: { closing: { html: '<p>{{staff_portal_link}}</p>' } } },
  });
  const r = composeFromContext(c);
  assert.equal(byId(r, 'closing').html, '<p>{{staff_portal_link}}</p>');
  assert.ok(r.warnings.some((x) => x.code === 'unknown_variable'));
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
