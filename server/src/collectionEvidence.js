// Historical collection evidence — the PURE parser that turns free Hebrew text
// (Deal notes, imported Pipedrive notes, timeline entries, customer info) into
// candidate iCount document references.
//
// It only ever PROPOSES references. Nothing here decides that money was
// received: an extracted reference is verified against iCount (doc/info) and
// then judged by the canonical accounting semantics in collection.js. Parsing
// is deliberately conservative — a missed reference costs one manual link, a
// wrong one corrupts the books.
//
// Israeli accounting document vocabulary, longest phrase first so
// "חשבונית מס קבלה" never degrades into "חשבונית מס".

// doctype keys are the canonical iCount ones (see icountDocs.js DOC_TYPES).
// `unknown` means: a document number was stated but its type was not — the
// number alone is not enough, iCount must resolve it.
const DOCTYPE_PHRASES = [
  // ── explicit type + number ────────────────────────────────────────────────
  { re: 'חשבונית\\s*מס\\s*[\\/\\-]?\\s*קבלה', doctype: 'invrec' },
  { re: 'חשבונית\\s*מס[\\-\\s]*קבלה', doctype: 'invrec' },
  { re: 'חשבונית\\s*זיכוי', doctype: 'refund' },
  { re: 'הודעת\\s*זיכוי', doctype: 'refund' },
  { re: 'חשבון\\s*עסקה', doctype: 'deal' },
  { re: 'חשבונית\\s*עסקה', doctype: 'deal' },
  { re: 'דרישת\\s*תשלום', doctype: 'deal' },
  { re: 'חשבונית\\s*מס', doctype: 'invoice' },
  { re: 'חשבונית', doctype: 'unknown' },
  { re: 'קבלה', doctype: 'receipt' },
  { re: 'זיכוי', doctype: 'refund' },
];

// Between the type phrase and its number we tolerate only bookkeeping glue:
// "מס׳", "מספר", "#", ":", "-", whitespace. Anything else breaks the link, so
// prose that merely mentions a document is not mined for nearby digits.
const GLUE = "(?:\\s|[:#\\-–־]|מס['׳\"]?|מספר)*";

// A document number: 3–8 digits, not part of a longer number, not a decimal,
// and not immediately followed by a time/date separator.
const NUMBER = '(\\d{3,8})(?![\\d.,:/])';

const PHRASE_PATTERNS = DOCTYPE_PHRASES.map((p) => ({
  doctype: p.doctype,
  rx: new RegExp(`(?<![\\p{L}])${p.re}${GLUE}${NUMBER}`, 'gu'),
}));

// GOS/provider machine notes that state a number without naming the type.
// These are the Cardcom/iCount payment-page confirmations imported from the
// legacy stack — the number is reliable, the type is not stated.
const MACHINE_PATTERNS = [
  {
    // "הסליקה בוצע בהצלחה … מספר חשבונית 38483" — a CLEARED card payment.
    rx: /הסליקה\s*בוצע[^\n]{0,40}בהצלחה[\s\S]{0,120}?מספר\s*חשבונית\s*(\d{3,8})(?![\d.,:/])/gu,
    doctype: 'unknown',
    hint: 'cardcom_cleared',
  },
  {
    // "המסמך נוצר בהצלחה מספר 38460 | https://app.icount…"
    rx: /המסמך\s*נוצר\s*בהצלחה[^\d]{0,20}(\d{3,8})(?![\d.,:/])/gu,
    doctype: 'unknown',
    hint: 'doc_created',
  },
];

// A direct iCount document link. The `code` is a stable per-document hash that
// iCount itself minted — the strongest reference we can find in text, because
// it cannot be confused with any other document.
const ICOUNT_URL_RX =
  /https?:\/\/(?:app|www)\.icount\.co\.il\/[^\s"'<>)]*?(?:p_print\.php|doc)[^\s"'<>)]*/gu;

// Text that is a conversation transcript rather than a bookkeeping note. The
// numbers inside are timestamps, prices and phone numbers, and the accounting
// words are the customer talking — mining these produces garbage references.
const TRANSCRIPT_RX = /התכתבות\s*וואצאפ|התכתבות\s*ווטסאפ|תוכן\s*הפנייה\s*המקורית/u;

// HTML → plain text, preserving the line structure that separates one stated
// document from the next.
export function plainText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t ]+/g, ' ')
    .trim();
}

// Numbers that are obviously not document numbers in this corpus: a bare year,
// or a 4-digit run that reads as a time/price fragment. Document numbers in the
// live iCount account are ≥ 4 digits and well above 2100.
function plausibleDocnum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return false;
  if (v < 100) return false;
  if (v >= 1900 && v <= 2100) return false; // a year
  return true;
}

// Parse ONE piece of text into candidate references.
// Returns [{ doctype, docnum, url, hint, matchedText }] — deduped within the
// text, ordered by first appearance.
export function parseDocumentReferences(rawText) {
  const text = plainText(rawText);
  if (!text) return [];

  const out = [];
  const seen = new Set();
  const push = (ref) => {
    const key = `${ref.doctype}:${ref.docnum || ''}:${ref.url || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };

  // Direct document links are always mined — even from a transcript, an iCount
  // URL is an unambiguous provider identifier.
  for (const m of text.matchAll(ICOUNT_URL_RX)) {
    push({ doctype: 'unknown', docnum: null, url: m[0], hint: 'url', matchedText: m[0] });
  }

  if (TRANSCRIPT_RX.test(text)) return out;

  for (const { rx, doctype, hint } of MACHINE_PATTERNS) {
    for (const m of text.matchAll(rx)) {
      if (!plausibleDocnum(m[1])) continue;
      push({ doctype, docnum: String(Number(m[1])), url: null, hint, matchedText: m[0].slice(0, 120) });
    }
  }

  // Typed references. Longest phrase wins: once a span is claimed by
  // "חשבונית מס קבלה", the shorter "חשבונית מס"/"קבלה" patterns must not
  // re-claim the same digits, so claimed number offsets are tracked.
  const claimed = new Set();
  for (const { rx, doctype } of PHRASE_PATTERNS) {
    for (const m of text.matchAll(rx)) {
      const numIdx = m.index + m[0].length - m[1].length;
      if (claimed.has(numIdx)) continue;
      if (!plausibleDocnum(m[1])) continue;
      claimed.add(numIdx);
      push({
        doctype,
        docnum: String(Number(m[1])),
        url: null,
        hint: 'typed',
        matchedText: m[0].slice(0, 120),
      });
    }
  }

  return out;
}

// Merge references found across several texts of ONE deal into a deduplicated
// reference set. A reference stated with an explicit type beats the same number
// seen untyped; a URL seen for a number is attached to it.
export function mergeDealReferences(refs) {
  const byNum = new Map();
  const urlOnly = [];
  for (const r of refs || []) {
    if (!r.docnum) {
      if (r.url) urlOnly.push(r);
      continue;
    }
    const prev = byNum.get(r.docnum);
    if (!prev) {
      byNum.set(r.docnum, { ...r, sources: [r.source].filter(Boolean), doctypes: new Set([r.doctype]) });
      continue;
    }
    prev.doctypes.add(r.doctype);
    if (prev.doctype === 'unknown' && r.doctype !== 'unknown') prev.doctype = r.doctype;
    if (!prev.url && r.url) prev.url = r.url;
    if (r.source) prev.sources.push(r.source);
  }
  const out = [];
  for (const [docnum, v] of byNum) {
    const stated = [...v.doctypes].filter((d) => d !== 'unknown');
    out.push({
      docnum,
      // Contradicting explicit types for one number is exactly the kind of
      // ambiguity that must reach a human — never silently pick one.
      doctype: stated.length === 1 ? stated[0] : stated.length === 0 ? 'unknown' : 'conflict',
      statedDoctypes: stated,
      url: v.url || null,
      hint: v.hint,
      sources: v.sources,
      matchedText: v.matchedText,
    });
  }
  return { references: out, urlOnly };
}
