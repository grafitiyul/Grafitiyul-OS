import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocumentReferences, mergeDealReferences, plainText } from './collectionEvidence.js';

// The parser turns free Hebrew operator notes into candidate document
// references. Every case below is taken from the real production corpus.
// Its bias is deliberate: a MISSED reference costs one manual link, a WRONG one
// puts money on the wrong deal.

const refs = (s) => parseDocumentReferences(s);
const pairs = (s) => refs(s).map((r) => `${r.doctype}:${r.docnum}`);

test('a typed document reference is read with its type', () => {
  assert.deepEqual(pairs('חשבונית מס קבלה 38474'), ['invrec:38474']);
  assert.deepEqual(pairs('קבלה 20241'), ['receipt:20241']);
  assert.deepEqual(pairs('חשבונית מס 10149'), ['invoice:10149']);
  assert.deepEqual(pairs('חשבון עסקה 54424'), ['deal:54424']);
  assert.deepEqual(pairs('חשבונית זיכוי 40001'), ['refund:40001']);
});

test('"חשבונית מס קבלה" never degrades into "חשבונית מס" or "קבלה"', () => {
  // The longest phrase claims the number; the shorter patterns must not
  // re-claim the same digits under a different type.
  assert.deepEqual(pairs('חשבונית מס קבלה 38474'), ['invrec:38474']);
});

test('two documents stated in one run-on note are both found', () => {
  // Real note: "חשבון עסקה 54424חשבונית מס קבלה 38449"
  assert.deepEqual(
    pairs('חשבון עסקה 54424חשבונית מס קבלה 38449').sort(),
    ['deal:54424', 'invrec:38449'],
  );
});

test('bookkeeping glue between the type and the number is tolerated', () => {
  assert.deepEqual(pairs('חשבונית מס קבלה מס׳ 38474'), ['invrec:38474']);
  assert.deepEqual(pairs('קבלה #20241'), ['receipt:20241']);
  assert.deepEqual(pairs('חשבונית מס - 10149'), ['invoice:10149']);
});

test('the clearing-success machine note yields the number with an unknown type', () => {
  const note =
    'הסליקה בוצע בהצלחה \nמספר חשבונית 38483\nלינק למסמך חשבונאי: \nhttps://app.icount.co.il/hash/p_print.php?code=RG8wVk1n';
  const out = refs(note);
  assert.ok(out.some((r) => r.docnum === '38483' && r.hint === 'cardcom_cleared'));
  // The link is captured too — an unambiguous provider identifier.
  assert.ok(out.some((r) => r.hint === 'url' && r.url.includes('p_print.php')));
});

test('"המסמך נוצר בהצלחה מספר N | <link>" yields number + link', () => {
  const out = refs('המסמך נוצר בהצלחה מספר 38460 | https://app.icount.co.il/hash/p_print.php?code=AAA==');
  assert.ok(out.some((r) => r.docnum === '38460' && r.hint === 'doc_created'));
  assert.ok(out.some((r) => r.hint === 'url'));
});

test('a WhatsApp transcript is NOT mined for numbers', () => {
  // The words are the customer talking and the digits are clock times. Mining
  // this produced garbage links in the first draft of the importer.
  const chat =
    '2026-07-21 התכתבות וואצאפ בין גרפיטיול הזמנות ל שירן ששון לקוח: 11:43 היי צריך לעשות תיקון בחשבונית 1143 ולהעביר על שם עיריית אור יהודה';
  assert.deepEqual(refs(chat).filter((r) => r.docnum), []);
});

test('prose that merely mentions a document yields nothing', () => {
  assert.deepEqual(pairs('נשלח להפקת חשבונית עסקה'), []);
  assert.deepEqual(pairs('ממתין להוצאת חשבונית עסקה'), []);
  assert.deepEqual(pairs('שולם ויצאה קבלה'), []);
});

test('a number that is not adjacent to the type is not captured', () => {
  assert.deepEqual(pairs('חשבונית מס נשלחה ללקוח ביום 15 לחודש'), []);
});

test('years, times and prices are not mistaken for document numbers', () => {
  assert.deepEqual(pairs('קבלה 2022'), []); // a year
  assert.deepEqual(pairs('קבלה 12:30'), []); // a time
  assert.deepEqual(pairs('קבלה 1,250.50'), []); // a price
});

test('HTML notes are flattened before matching', () => {
  assert.equal(plainText('<div>חשבונית מס קבלה&nbsp;38474</div>').trim(), 'חשבונית מס קבלה 38474');
  assert.deepEqual(pairs('<p>חשבונית מס קבלה 38474</p>'), ['invrec:38474']);
});

test('an iCount link with no number is kept as a URL-only reference', () => {
  const out = refs('המסמך: https://app.icount.co.il/hash/p_print.php?code=XYZ');
  assert.equal(out.length, 1);
  assert.equal(out[0].docnum, null);
  assert.equal(out[0].hint, 'url');
});

// ── Merging one deal's references ───────────────────────────────────────────

test('an explicit type beats the same number seen untyped', () => {
  const { references } = mergeDealReferences([
    { doctype: 'unknown', docnum: '38474', hint: 'doc_created' },
    { doctype: 'invrec', docnum: '38474', hint: 'typed' },
  ]);
  assert.equal(references.length, 1);
  assert.equal(references[0].doctype, 'invrec');
});

test('contradicting explicit types for one number become a conflict, never a guess', () => {
  const { references } = mergeDealReferences([
    { doctype: 'invrec', docnum: '32538' },
    { doctype: 'receipt', docnum: '32538' },
  ]);
  assert.equal(references[0].doctype, 'conflict');
  assert.deepEqual(references[0].statedDoctypes.sort(), ['invrec', 'receipt']);
});

test('the same document stated twice collapses to one reference', () => {
  const { references } = mergeDealReferences([
    { doctype: 'invrec', docnum: '38474', source: 'a' },
    { doctype: 'invrec', docnum: '38474', source: 'b' },
  ]);
  assert.equal(references.length, 1);
  assert.deepEqual(references[0].sources, ['a', 'b']);
});
