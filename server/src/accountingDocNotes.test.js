import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  blockAnchor,
  blockPresent,
  renderBlock,
  composeNotesForDoctype,
  buildNotesByDoctype,
  unknownDocNoteTokens,
  dealNotesContext,
} from './accountingDocNotes.js';
import { documentNotesText } from './documentNotes.js';

// A deal shaped like an ICOUNT_DEAL_INCLUDE load (only the fields the note
// variables read).
const deal = {
  groupName: 'Democratic Leaders',
  title: 'סיור קבוצתי',
  tourDate: '2026-07-25',
  tourTime: '10:00',
  participants: 19,
  orderNo: 27123,
  organization: { name: 'ארגון הדוגמה' },
  contacts: [],
};
const ctx = dealNotesContext(deal);

// The approved standard wording as GOS renders it (recovered verbatim from
// live iCount documents 2026-08-02; only the date format is the canonical GOS
// DD/MM/YYYY instead of the legacy DD-MM-YYYY).
const RENDERED_STANDARD =
  'שם הקבוצה: Democratic Leaders\n' +
  'תאריך הסיור: 25/07/2026\n' +
  'כמות משתתפים: 19\n' +
  'ניתן לשלם בהעברה בנקאית מראש לחשבון: גרפיטיול בע"מ , הפועלים - בנק 12 , סניף -611 יפו, מספר חשבון: 219583\n' +
  'מדיניות ביטול/ דחייה:\n' +
  'ביטול פעילות: ניתן לבטל את הפעילות מכל סיבה שהיא עד 96 שעות טרם המועד שנקבע, ויתקבל החזר כספי מלא\n' +
  'באשראי/ביט/העברה בנקאית. יש לעשות זאת על ידי הודעה מראש באמצעות המייל, אבל ההפסד כולו שלכם\n' +
  'דחיית הפעילות: במידת הצורך, ניתן לדחות את הפעילות עד 48 שעות לפני.\n' +
  'ביטול או דחייה בתוך 48 השעות שטרם הפעילות יגרור חיוב מלא.';

test('standalone חשבון עסקה composes the exact standard wording', () => {
  const out = composeNotesForDoctype(DEFAULT_SETTINGS, 'deal', ctx);
  assert.equal(out, RENDERED_STANDARD);
});

test('default flags: invoice / receipt / invrec / refund get no default blocks', () => {
  for (const doctype of ['invoice', 'invrec', 'receipt', 'refund']) {
    assert.equal(composeNotesForDoctype(DEFAULT_SETTINGS, doctype, ctx), '');
  }
});

test('invoice with bank enabled gets ONLY the bank block', () => {
  const settings = { ...DEFAULT_SETTINGS, bankIncludeInvoice: true };
  const out = composeNotesForDoctype(settings, 'invoice', ctx);
  assert.equal(
    out,
    'ניתן לשלם בהעברה בנקאית מראש לחשבון: גרפיטיול בע"מ , הפועלים - בנק 12 , סניף -611 יפו, מספר חשבון: 219583',
  );
});

test('based-on inheritance passes the source notes through untouched for non-default doctypes', () => {
  const inherited = 'הערה חופשית של המסמך המקורי';
  assert.equal(composeNotesForDoctype(DEFAULT_SETTINGS, 'receipt', ctx, { inheritedNotes: inherited }), inherited);
});

test('dedup: inherited standard wording (legacy date format, other values) suppresses all blocks', () => {
  // A HISTORICAL document's notes — different group, legacy DD-MM-YYYY date,
  // different participant count. The anchors must still match.
  const inherited =
    'שם הקבוצה: BBYO J5\n' +
    'תאריך הסיור: 31-07-2026\n' +
    'כמות משתתפים: 45\n' +
    'ניתן לשלם בהעברה בנקאית מראש לחשבון: גרפיטיול בע"מ , הפועלים - בנק 12 , סניף -611 יפו, מספר חשבון: 219583\n' +
    'מדיניות ביטול/ דחייה:\n' +
    'ביטול פעילות: ניתן לבטל את הפעילות מכל סיבה שהיא עד 96 שעות טרם המועד שנקבע, ויתקבל החזר כספי מלא\n' +
    'באשראי/ביט/העברה בנקאית. יש לעשות זאת על ידי הודעה מראש באמצעות המייל, אבל ההפסד כולו שלכם\n' +
    'דחיית הפעילות: במידת הצורך, ניתן לדחות את הפעילות עד 48 שעות לפני.\n' +
    'ביטול או דחייה בתוך 48 השעות שטרם הפעילות יגרור חיוב מלא.';
  const settings = {
    ...DEFAULT_SETTINGS,
    dealInfoIncludeInvoice: true,
    bankIncludeInvoice: true,
    cancellationIncludeInvoice: true,
  };
  assert.equal(composeNotesForDoctype(settings, 'invoice', ctx, { inheritedNotes: inherited }), inherited);
});

test('unrelated inherited notes get the enabled blocks appended after a blank line', () => {
  const settings = { ...DEFAULT_SETTINGS, bankIncludeInvoice: true };
  const out = composeNotesForDoctype(settings, 'invoice', ctx, { inheritedNotes: 'תודה על ההזמנה!' });
  assert.equal(
    out,
    'תודה על ההזמנה!\n\nניתן לשלם בהעברה בנקאית מראש לחשבון: גרפיטיול בע"מ , הפועלים - בנק 12 , סניף -611 יפו, מספר חשבון: 219583',
  );
});

test('missing deal values resolve to empty — never raw tokens, no dangling spaces', () => {
  const bare = dealNotesContext({ contacts: [] });
  const out = composeNotesForDoctype(DEFAULT_SETTINGS, 'deal', bare);
  assert.ok(!out.includes('{{'), 'raw moustache must never survive');
  assert.ok(out.includes('שם הקבוצה:'));
  assert.ok(!/[ \t]$/m.test(out), 'no trailing spaces after empty fills');
});

test('anchors derive from the canonical templates', () => {
  assert.equal(blockAnchor(DEFAULT_SETTINGS.bankTemplate), 'ניתן לשלם בהעברה בנקאית מראש לחשבון:');
  assert.equal(blockAnchor(DEFAULT_SETTINGS.dealInfoTemplate), 'כמות משתתפים:');
  assert.equal(
    blockAnchor(DEFAULT_SETTINGS.cancellationTemplate),
    'ביטול פעילות: ניתן לבטל את הפעילות מכל סיבה שהיא עד 96 שעות טרם המועד שנקבע, ויתקבל החזר כספי מלא',
  );
  assert.ok(blockPresent('שולם. כמות משתתפים: 12', DEFAULT_SETTINGS.dealInfoTemplate));
  assert.ok(!blockPresent('שולם במלואו', DEFAULT_SETTINGS.dealInfoTemplate));
});

test('unknown tokens are rejected at validation and stripped at render', () => {
  assert.deepEqual(unknownDocNoteTokens('{{bank_name}} {{group_name}} {{no_such_token}}'), ['no_such_token']);
  const out = renderBlock('לפני {{no_such_token}} אחרי', DEFAULT_SETTINGS, ctx);
  assert.equal(out, 'לפני אחרי');
});

test('buildNotesByDoctype returns a suggestion per producible type', () => {
  const map = buildNotesByDoctype(DEFAULT_SETTINGS, deal);
  assert.deepEqual(Object.keys(map).sort(), ['deal', 'invoice', 'invrec', 'receipt', 'refund'].sort());
  assert.equal(map.deal, RENDERED_STANDARD);
  assert.equal(map.receipt, '');
});

// ── Inherited notes arrive from a FREE-FORM provider field ───────────────────
// iCount's own UI writes rich HTML into `hwc`. The composition layer normalizes
// at the boundary (documentNotes.js), so the suggestion the operator reviews is
// readable text — and, being already normalized, it is byte-identical to what
// buildIssuePayload sends as `hwc`. Production shape: Deal #25707 → base
// document 54513.
const PROD_54513_HWC =
  '<div>סדנה למחלקת נשים ויולדות<br /><br />ניתן לשלם בהעברה בנקאית לחשבון: ' +
  'גרפיטיול בע"מ, הפועלים - בנק 12, סניף 500- הרימון, מס\' חשבון: 219587</div>';

test('inherited HTML notes are normalized before composition (Deal #25707 shape)', () => {
  const map = buildNotesByDoctype(DEFAULT_SETTINGS, deal, { inheritedNotes: PROD_54513_HWC });
  // חשבונית מס קבלה inherits ONLY — this is the exact value the modal shows.
  const invrec = map.invrec;
  assert.ok(!/<[a-z/]/i.test(invrec), `markup leaked into the suggestion: ${invrec}`);
  assert.equal(
    invrec,
    'סדנה למחלקת נשים ויולדות\n\n' +
      'ניתן לשלם בהעברה בנקאית לחשבון: גרפיטיול בע"מ, הפועלים - בנק 12, סניף 500- הרימון, מס\' חשבון: 219587',
  );
  // Preview === payload: buildIssuePayload runs the same normalizer over the
  // operator's (unedited) text and must not change a character.
  assert.equal(documentNotesText(invrec), invrec);
});

test('dedup anchors match against normalized inherited text, not markup', () => {
  // The bank block wrapped in HTML by iCount must still be recognised as
  // present, so a follow-up never appends a duplicate bank paragraph.
  const html = `<div>${DEFAULT_SETTINGS.bankTemplate.replace(/\{\{[a-z_]+\}\}/g, 'x')}</div>`;
  const map = buildNotesByDoctype(
    { ...DEFAULT_SETTINGS, bankIncludeInvoice: true, dealInfoIncludeInvoice: false, cancellationIncludeInvoice: false },
    deal,
    { inheritedNotes: html },
  );
  assert.equal(map.invoice.match(/ניתן לשלם בהעברה בנקאית מראש לחשבון:/g).length, 1);
});
