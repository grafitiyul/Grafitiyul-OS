// ExportDocument → .docx Buffer.
//
// Hebrew is handled via paragraph-level `bidirectional: true` plus
// right alignment by default. The `docx` package emits proper RTL
// runs natively when those are set, so no extra bidi shaping is
// required at this layer.

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

// docx v9 numbering reference. Two pre-defined concrete numberings (one
// for ul, one for ol) wired up at Document creation. Indentation steps
// per nesting level.
const UL_REF = 'gosUl';
const OL_REF = 'gosOl';

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

// Map raw run marks to docx TextRun props.
function runProps(run) {
  return {
    text: run.text,
    bold: !!run.bold,
    italics: !!run.italic,
    underline: run.underline ? {} : undefined,
    strike: !!run.strike,
  };
}

// Build a sequence of TextRun / ExternalHyperlink children for a run list.
async function buildInlineChildren(runs) {
  const out = [];
  for (const r of runs) {
    if (r.kind === 'lineBreak') {
      out.push(new TextRun({ break: 1 }));
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
        out.push(new TextRun({ text: `[${r.alt}]`, italics: true }));
      }
      continue;
    }
    if (r.kind === 'mediaPlaceholder') {
      const text = r.href ? `[${r.label}: ${r.href}]` : `[${r.label}]`;
      out.push(new TextRun({ text, italics: true }));
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
async function blocksToParagraphs(blocks, opts = {}) {
  const out = [];
  for (const b of blocks) {
    await pushBlock(b, out, { listLevel: 0, listRef: null, ...opts });
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
          children: [new TextRun({ text: `[${b.alt}]`, italics: true })],
        }),
      );
    }
    return;
  }
  if (b.type === 'video' || b.type === 'embed') {
    const text = b.src ? `[${b.label}: ${b.src}]` : `[${b.label}]`;
    out.push(
      rtlPara({ children: [new TextRun({ text, italics: true })] }),
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
      // Indent the resulting paragraphs.
      for (const p of inner) {
        // docx Paragraph is immutable post-construct; rebuild with indent.
        // Easier: emit a fresh para with the same text props would require
        // round-tripping. We push as-is and rely on visual italic via
        // marks. Quotes are rare in procedure content.
        out.push(p);
      }
    }
    return;
  }
  if (b.type === 'list') {
    const ref = b.ordered ? OL_REF : UL_REF;
    for (const item of b.items || []) {
      const children = await buildInlineChildren(item.runs || []);
      out.push(
        rtlPara({
          children,
          numbering: { reference: ref, level: ctx.listLevel },
        }),
      );
      if (item.children?.length) {
        for (const childBlock of item.children) {
          await pushBlock(childBlock, out, {
            ...ctx,
            listLevel: Math.min(ctx.listLevel + 1, 8),
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
    children: [new TextRun({ text, bold: true })],
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

async function questionExtraParagraphs(qd) {
  const out = [];
  if (qd.options && qd.options.length > 0) {
    out.push(
      rtlPara({
        children: [new TextRun({ text: 'אפשרויות:', bold: true })],
        spacing: { before: 120, after: 60 },
      }),
    );
    qd.options.forEach((opt) => {
      out.push(
        rtlPara({
          children: [new TextRun({ text: String(opt) })],
          numbering: { reference: UL_REF, level: 0 },
        }),
      );
    });
  }
  if (qd.allowTextAnswer) {
    out.push(
      rtlPara({
        children: [
          new TextRun({ text: 'שדה טקסט חופשי: ', bold: true }),
          new TextRun({ text: 'מופעל' }),
        ],
        spacing: { before: 60 },
      }),
    );
  }
  out.push(
    rtlPara({
      children: [
        new TextRun({ text: 'דרישה: ', bold: true }),
        new TextRun({ text: qd.requirementLabel || qd.requirement || '' }),
      ],
      spacing: { after: 120 },
    }),
  );
  return out;
}

// Build all paragraphs for a document. `pagination`:
//   'compact'        — sections flow continuously
//   'page-per-item'  — page break before each content/question section
async function buildBody(doc, opts) {
  const out = [];
  out.push(titleParagraph(doc.title || '', HeadingLevel.HEADING_1));

  const pageBreak = opts.pagination === 'page-per-item';

  for (let i = 0; i < doc.sections.length; i++) {
    const s = doc.sections[i];
    const isItem = s.type === 'content' || s.type === 'question';

    if (pageBreak && isItem && out.length > 1) {
      out.push(
        rtlPara({ children: [new TextRun({ break: 0 }), new PageBreak()] }),
      );
    }

    const titleParas = await sectionTitleParagraphs(s);
    out.push(...titleParas);

    if (s.bodyHtml) {
      const blocks = parseHtmlToBlocks(s.bodyHtml);
      const paras = await blocksToParagraphs(blocks);
      out.push(...paras);
    }

    if (s.type === 'question' && s.questionData) {
      const qParas = await questionExtraParagraphs(s.questionData);
      out.push(...qParas);
    }
  }
  return out;
}

export async function renderDocx(doc, opts = {}) {
  const paragraphs = await buildBody(doc, opts);
  const document = new Document({
    creator: 'Grafitiyul OS',
    title: doc.title || 'Export',
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: 22 }, // 11pt
        },
      },
    },
    numbering: {
      config: [
        {
          reference: UL_REF,
          levels: [
            ...Array.from({ length: 9 }, (_, level) => ({
              level,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.RIGHT,
              style: {
                paragraph: {
                  indent: { left: 720 + level * 360, hanging: 240 },
                },
              },
            })),
          ],
        },
        {
          reference: OL_REF,
          levels: [
            ...Array.from({ length: 9 }, (_, level) => ({
              level,
              format: LevelFormat.DECIMAL,
              text: `%${level + 1}.`,
              alignment: AlignmentType.RIGHT,
              style: {
                paragraph: {
                  indent: { left: 720 + level * 360, hanging: 360 },
                },
              },
            })),
          ],
        },
      ],
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
