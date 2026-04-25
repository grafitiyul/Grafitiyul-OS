// ExportDocument → .docx Buffer.
//
// Hebrew / RTL handling:
//   * Paragraph: `bidirectional: true` (sets <w:bidi/>) + right alignment.
//   * Text run:  `rightToLeft: true` (sets <w:rtl/>) plus the complex-
//                script mirrors of bold/italic. Without the run-level
//                rtl mark, Word keeps Latin bidi resolution and visibly
//                misorders punctuation, list markers, and short runs of
//                English embedded in Hebrew.
//   * Default font: Arial in BOTH the latin and complex-script slots so
//                Hebrew glyphs don't fall back to a different system font.
//
// Numbered list isolation:
//   * Every `<ol>` and `<ul>` allocates a unique numbering reference at
//     render time. Word continues counters on every paragraph that
//     shares a numId, so a single shared `gosOl` reference would make
//     the second list start at "previous list length + 1" (showing
//     up as 29, 30, 31 instead of 1, 2, 3). One numbering def per
//     list is the reliable fix.

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  PageBreak,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import { prisma } from '../../db.js';
import { parseHtmlToBlocks } from './htmlParse.js';

// Default image dims when we can't sniff intrinsic size — keeps the
// document readable without any image-decoding deps. ~6 inches wide.
const DEFAULT_IMG_W = 480;
const DEFAULT_IMG_H = 320;

const HEADING_BY_DEPTH = (depth) =>
  depth <= 0 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;

// ── List numbering allocator ───────────────────────────────────────
// Every list encountered gets its own concrete numbering reference,
// so Word treats each one as an independent counter. The renderer
// builds `numbering.config[]` from `entries()` after the body is built.
function makeListAllocator() {
  const entries = [];
  return {
    alloc(ordered) {
      const ref = `${ordered ? 'gosOl' : 'gosUl'}__${entries.length}`;
      entries.push({ ref, ordered });
      return ref;
    },
    entries() {
      return entries;
    },
  };
}

function rtlPara(opts) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    ...opts,
  });
}

// Convert /api/media/:id image src → bytes via Prisma. Other src values
// (data URIs, external URLs) we skip — too many failure modes to fetch
// at render time, and the project does not serve external images today.
async function loadImageBytes(src) {
  if (!src || typeof src !== 'string') return null;
  const m = src.match(/\/api\/media\/([^/?#]+)/);
  if (!m) return null;
  const asset = await prisma.mediaAsset.findUnique({ where: { id: m[1] } });
  if (!asset || !asset.bytes || asset.kind !== 'image') return null;
  return {
    bytes: Buffer.from(asset.bytes),
    mime: asset.mimeType || 'image/png',
  };
}

// Map raw run marks to docx TextRun props. Adds the run-level RTL flag
// plus the complex-script mirrors of bold/italic so Hebrew picks them
// up (Word stores them on separate properties from the Latin variants).
function runProps(run) {
  return {
    text: run.text,
    bold: !!run.bold,
    boldComplexScript: !!run.bold,
    italics: !!run.italic,
    italicsComplexScript: !!run.italic,
    underline: run.underline ? {} : undefined,
    strike: !!run.strike,
    rightToLeft: true,
  };
}

// Build a sequence of TextRun / ExternalHyperlink children for a run list.
async function buildInlineChildren(runs) {
  const out = [];
  for (const r of runs) {
    if (r.kind === 'lineBreak') {
      out.push(new TextRun({ break: 1, rightToLeft: true }));
      continue;
    }
    if (r.kind === 'image') {
      const img = await loadImageBytes(r.src);
      if (img) {
        out.push(
          new ImageRun({
            data: img.bytes,
            transformation: { width: DEFAULT_IMG_W, height: DEFAULT_IMG_H },
            type: imageTypeFromMime(img.mime),
          }),
        );
      } else if (r.alt) {
        out.push(
          new TextRun({
            text: `[${r.alt}]`,
            italics: true,
            italicsComplexScript: true,
            rightToLeft: true,
          }),
        );
      }
      continue;
    }
    if (r.kind === 'mediaPlaceholder') {
      const text = r.href ? `[${r.label}: ${r.href}]` : `[${r.label}]`;
      out.push(
        new TextRun({
          text,
          italics: true,
          italicsComplexScript: true,
          rightToLeft: true,
        }),
      );
      continue;
    }
    if (r.kind === 'text') {
      if (r.link) {
        out.push(
          new ExternalHyperlink({
            link: r.link,
            children: [new TextRun({ ...runProps(r), style: 'Hyperlink' })],
          }),
        );
      } else {
        out.push(new TextRun(runProps(r)));
      }
    }
  }
  return out;
}

function imageTypeFromMime(mime) {
  if (!mime) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('webp')) return 'webp';
  return 'png';
}

// Walk parsed blocks → docx paragraphs.
async function blocksToParagraphs(blocks, ctx) {
  const out = [];
  for (const b of blocks) {
    await pushBlock(b, out, ctx);
  }
  return out;
}

async function pushBlock(b, out, ctx) {
  if (b.type === 'paragraph') {
    const children = await buildInlineChildren(b.runs || []);
    if (children.length === 0) return;
    out.push(
      rtlPara({
        children,
        heading: b.level ? headingByHtmlLevel(b.level) : undefined,
      }),
    );
    return;
  }
  if (b.type === 'image') {
    const img = await loadImageBytes(b.src);
    if (img) {
      out.push(
        rtlPara({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: img.bytes,
              transformation: { width: DEFAULT_IMG_W, height: DEFAULT_IMG_H },
              type: imageTypeFromMime(img.mime),
            }),
          ],
        }),
      );
    } else if (b.alt) {
      out.push(
        rtlPara({
          children: [
            new TextRun({
              text: `[${b.alt}]`,
              italics: true,
              italicsComplexScript: true,
              rightToLeft: true,
            }),
          ],
        }),
      );
    }
    return;
  }
  if (b.type === 'video' || b.type === 'embed') {
    const text = b.src ? `[${b.label}: ${b.src}]` : `[${b.label}]`;
    out.push(
      rtlPara({
        children: [
          new TextRun({
            text,
            italics: true,
            italicsComplexScript: true,
            rightToLeft: true,
          }),
        ],
      }),
    );
    return;
  }
  if (b.type === 'rule') {
    out.push(
      rtlPara({
        border: {
          bottom: { color: '999999', size: 6, style: BorderStyle.SINGLE },
        },
      }),
    );
    return;
  }
  if (b.type === 'blockquote') {
    for (const c of b.children || []) {
      const inner = [];
      await pushBlock(c, inner, ctx);
      for (const p of inner) {
        out.push(p);
      }
    }
    return;
  }
  if (b.type === 'list') {
    // Each list gets its OWN numbering reference. Nested lists call
    // pushBlock recursively from the item-children loop below, which
    // re-enters this branch and allocates a fresh ref — so they
    // restart independently of their parent list, just like Word does
    // when you create them by hand.
    const ref = ctx.lists.alloc(!!b.ordered);
    for (const item of b.items || []) {
      const children = await buildInlineChildren(item.runs || []);
      out.push(
        rtlPara({
          children,
          numbering: { reference: ref, level: ctx.listLevel || 0 },
        }),
      );
      if (item.children?.length) {
        for (const childBlock of item.children) {
          await pushBlock(childBlock, out, {
            ...ctx,
            // Only meaningful when childBlock is itself a list; for
            // non-list children this value is ignored.
            listLevel: Math.min((ctx.listLevel || 0) + 1, 8),
          });
        }
      }
    }
    return;
  }
}

function headingByHtmlLevel(level) {
  switch (level) {
    case 1: return HeadingLevel.HEADING_2; // never collide with doc H1
    case 2: return HeadingLevel.HEADING_3;
    case 3: return HeadingLevel.HEADING_4;
    case 4: return HeadingLevel.HEADING_5;
    default: return HeadingLevel.HEADING_6;
  }
}

// ── Document assembly ──────────────────────────────────────────────

function titleParagraph(text, level) {
  return rtlPara({
    children: [
      new TextRun({
        text,
        bold: true,
        boldComplexScript: true,
        rightToLeft: true,
      }),
    ],
    heading: level,
    spacing: { before: 240, after: 120 },
  });
}

async function sectionTitleParagraphs(section) {
  if (!section.title) return [];
  const headingLevel =
    section.type === 'folder' || section.type === 'group'
      ? HEADING_BY_DEPTH(section.depth)
      : HeadingLevel.HEADING_4;
  const text = section.titleIsHtml
    ? plainFromHtml(section.title)
    : section.title;
  return [titleParagraph(text || '', headingLevel)];
}

function plainFromHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function questionExtraParagraphs(qd, ctx) {
  const out = [];
  if (qd.options && qd.options.length > 0) {
    out.push(
      rtlPara({
        children: [
          new TextRun({
            text: 'אפשרויות:',
            bold: true,
            boldComplexScript: true,
            rightToLeft: true,
          }),
        ],
        spacing: { before: 120, after: 60 },
      }),
    );
    // Fresh bullet list per question so option numbering can never
    // bleed in from another paragraph.
    const ref = ctx.lists.alloc(false);
    qd.options.forEach((opt) => {
      out.push(
        rtlPara({
          children: [new TextRun({ text: String(opt), rightToLeft: true })],
          numbering: { reference: ref, level: 0 },
        }),
      );
    });
  }
  if (qd.allowTextAnswer) {
    out.push(
      rtlPara({
        children: [
          new TextRun({
            text: 'שדה טקסט חופשי: ',
            bold: true,
            boldComplexScript: true,
            rightToLeft: true,
          }),
          new TextRun({ text: 'מופעל', rightToLeft: true }),
        ],
        spacing: { before: 60 },
      }),
    );
  }
  out.push(
    rtlPara({
      children: [
        new TextRun({
          text: 'דרישה: ',
          bold: true,
          boldComplexScript: true,
          rightToLeft: true,
        }),
        new TextRun({
          text: qd.requirementLabel || qd.requirement || '',
          rightToLeft: true,
        }),
      ],
      spacing: { after: 120 },
    }),
  );
  return out;
}

// Build all paragraphs for a document. `pagination`:
//   'compact'        — sections flow continuously
//   'page-per-item'  — page break before each content/question section
async function buildBody(doc, opts, lists) {
  const out = [];
  out.push(titleParagraph(doc.title || '', HeadingLevel.HEADING_1));

  const pageBreak = opts.pagination === 'page-per-item';
  const compact = !pageBreak;
  // Separator policy in compact mode: a horizontal line BEFORE every item
  // section that is not the first item in the document. This produces
  // separators between items (and around any heading that sits between
  // them), but never before the first item or after the last one.
  let itemEmitted = false;

  for (let i = 0; i < doc.sections.length; i++) {
    const s = doc.sections[i];
    const isItem = s.type === 'content' || s.type === 'question';

    if (pageBreak && isItem && out.length > 1) {
      out.push(
        rtlPara({ children: [new TextRun({ break: 0 }), new PageBreak()] }),
      );
    } else if (compact && isItem && itemEmitted) {
      out.push(itemSeparatorParagraph());
    }

    const titleParas = await sectionTitleParagraphs(s);
    out.push(...titleParas);

    if (s.bodyHtml) {
      const blocks = parseHtmlToBlocks(s.bodyHtml);
      const paras = await blocksToParagraphs(blocks, {
        listLevel: 0,
        lists,
      });
      out.push(...paras);
    }

    if (s.type === 'question' && s.questionData) {
      const qParas = await questionExtraParagraphs(s.questionData, { lists });
      out.push(...qParas);
    }

    if (isItem) itemEmitted = true;
  }
  return out;
}

// Empty paragraph with a bottom border — renders as a horizontal rule
// between item sections in compact mode. The before/after spacing
// gives the line some breathing room without a heavy gap.
function itemSeparatorParagraph() {
  return new Paragraph({
    bidirectional: true,
    spacing: { before: 240, after: 240 },
    border: {
      bottom: { color: 'BBBBBB', size: 8, style: BorderStyle.SINGLE, space: 1 },
    },
  });
}

// Build the per-list level definitions. A single list type can nest up
// to 9 levels; each level is independent so a freshly-allocated ref's
// counter starts at 1 across every level.
function buildLevels(ordered) {
  return Array.from({ length: 9 }, (_, level) => ({
    level,
    // `start: 1` is implicit per OOXML, but stating it makes the
    // restart-from-1 contract explicit at the spot it matters.
    start: 1,
    format: ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
    text: ordered ? `%${level + 1}.` : '•',
    alignment: AlignmentType.RIGHT,
    style: {
      paragraph: {
        indent: {
          left: 720 + level * 360,
          hanging: ordered ? 360 : 240,
        },
      },
    },
  }));
}

export async function renderDocx(doc, opts = {}) {
  const lists = makeListAllocator();
  const paragraphs = await buildBody(doc, opts, lists);
  const numberingConfig = lists.entries().map(({ ref, ordered }) => ({
    reference: ref,
    levels: buildLevels(ordered),
  }));
  const document = new Document({
    creator: 'Grafitiyul OS',
    title: doc.title || 'Export',
    styles: {
      default: {
        document: {
          run: {
            // ascii=Latin, cs=complex script (Hebrew), hAnsi=high-ANSI.
            // Setting all three pins Arial as the chosen face regardless
            // of which side of bidi resolution Word lands on.
            font: { ascii: 'Arial', cs: 'Arial', hAnsi: 'Arial' },
            size: 22, // 11pt
            sizeComplexScript: 22,
          },
        },
      },
    },
    numbering: {
      // docx-package requires at least one config entry; supply a
      // hidden no-op when the document has no lists.
      config:
        numberingConfig.length > 0
          ? numberingConfig
          : [{ reference: '__noop__', levels: buildLevels(false) }],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1000, right: 1200, bottom: 1000, left: 1200 },
          },
        },
        children: paragraphs,
      },
    ],
  });
  return Packer.toBuffer(document);
}
