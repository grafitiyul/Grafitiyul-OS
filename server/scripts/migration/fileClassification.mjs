// THE one classifier for legacy file bodies. Pure, no IO — so the audit script
// and the importer can never disagree about what a file is.
//
// Business rule (owner, 2026-08-02): the automatically generated proforma /
// חשבונית עסקה PDFs that iCount+Pipedrive produced per deal are repetitive and
// low-value; on pre-2026 deals they are deferred rather than downloaded, so the
// daily API budget goes to genuinely distinct documents (signed agreements,
// customer files, custom quotes, briefs, images, spreadsheets…).
//
// Matching is deliberately STRUCTURAL, not a fixed string. The observed shape is
//     "<company> deal <number> (<lang> <original|translated>).pdf"
// with drift in company name, spacing, capitalisation, punctuation, the language
// marker and the original/translated suffix. Anything that does not match that
// shape with high confidence is NOT proforma — the asymmetry is intentional:
// wrongly deferring a signed agreement costs far more than downloading one extra
// proforma.

export const PROFORMA = 'proforma';
export const OTHER = 'other';
export const UNCERTAIN = 'uncertain';

// Latin + Hebrew words that appear in the generated names.
const DEAL_WORD = '(?:deal|deals|עסקה|עסקת)';
const LANG = '(?:he|en|iw|heb|eng|hebrew|english|עברית|אנגלית)';
const VARIANT = '(?:original|translated|translation|orig|trans|מקור|מקורי|מתורגם|תרגום)';

// "… deal 54506 (he original).pdf" — the number and the parenthetical are the
// two load-bearing parts; everything before them is free-form company naming.
const CORE = new RegExp(
  `${DEAL_WORD}\\s*[#:_-]?\\s*\\d{3,}\\b[\\s._-]*[(\\[{]?\\s*(?:${LANG})?\\s*[,._-]?\\s*(?:${VARIANT})?\\s*[)\\]}]?\\s*$`,
  'i',
);
// Same shape but with the parenthetical missing entirely: "… deal 54506.pdf".
const CORE_BARE = new RegExp(`${DEAL_WORD}\\s*[#:_-]?\\s*\\d{3,}\\s*$`, 'i');

const normalise = (s) => String(s || '')
  .replace(/‏|‎|‪|‫|‬/g, '') // bidi marks
  .replace(/[ \s]+/g, ' ')
  .trim();

const stripExt = (s) => s.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim();

/**
 * @param file census row: { file_name, mime, file_size, ... }
 * @returns { kind: 'proforma'|'other'|'uncertain', why: string }
 */
export function classifyFile(file) {
  const raw = normalise(file?.file_name);
  if (!raw) return { kind: UNCERTAIN, why: 'no filename' };

  const ext = (raw.match(/\.([A-Za-z0-9]{1,5})$/) || [, ''])[1].toLowerCase();
  const mime = String(file?.mime || '').toLowerCase();
  const isPdf = ext === 'pdf' || mime.includes('pdf');

  // A non-PDF is never one of these generated documents — Word, Excel, images,
  // signed scans and anything else go straight to the import pile.
  if (!isPdf) return { kind: OTHER, why: `non-PDF (${ext || mime || 'unknown'})` };

  const base = stripExt(raw);
  if (CORE.test(base)) return { kind: PROFORMA, why: 'generated pattern: …deal <n> (<lang> <variant>)' };
  if (CORE_BARE.test(base)) return { kind: PROFORMA, why: 'generated pattern: …deal <n>' };

  // A PDF that does not match the generated shape is a real document.
  return { kind: OTHER, why: 'PDF, non-generated name' };
}
