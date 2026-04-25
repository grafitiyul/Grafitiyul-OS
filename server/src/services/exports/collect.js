// Export collection — turns a procedures entity (item / folder / flow)
// into the unified ExportDocument model.
//
// One source of truth for ordering, hierarchy, and include filters. The
// DOCX and print-HTML renderers consume this same shape, so the two
// formats can never drift on what they show or in what order.
//
// ExportDocument:
//   {
//     title:    string                // root H1
//     sections: ExportSection[]
//   }
//
// ExportSection:
//   {
//     type:    'folder' | 'group' | 'content' | 'question'
//     depth:   number                  // 0 = top-level under root
//     title?:  string                  // omitted ⇒ render body only
//                                       // (single-item exports)
//     titleIsHtml?: boolean            // item titles carry HTML
//     bodyHtml?:    string             // content.body or question.questionText
//     questionData?: {
//       options:           string[]
//       allowTextAnswer:   boolean
//       requirement:       string
//       requirementLabel:  string
//     }
//   }
//
// Heading mapping in renderers:
//   document.title             → H1
//   folder/group at depth 0    → H2
//   folder/group at depth ≥ 1  → H3
//   content/question (any d)   → H4 (skipped if section.title is omitted)

import { prisma } from '../../db.js';

// Hebrew labels mirror client/src/lib/questionRequirement.js.
const REQUIREMENT_LABELS = Object.freeze({
  optional: 'לא חובה',
  choice: 'חובה לבחור אפשרות',
  text: 'חובה לכתוב טקסט',
  any: 'אחד מהשניים — בחירה או טקסט',
  both: 'גם בחירה וגם טקסט',
});

function requirementLabel(req) {
  return REQUIREMENT_LABELS[req] || REQUIREMENT_LABELS.optional;
}

// Strip HTML to plain text. Used for document `title` (which becomes the
// docx core title and the page <title>) — those need plain strings.
function htmlToPlain(html) {
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

// ── Item collectors ────────────────────────────────────────────────

function contentItemSection(item, { depth, omitTitle = false }) {
  return {
    type: 'content',
    depth,
    title: omitTitle ? undefined : item.title || '',
    titleIsHtml: true,
    bodyHtml: item.body || '',
  };
}

function questionItemSection(item, { depth, omitTitle = false }) {
  const options = Array.isArray(item.options) ? item.options : [];
  return {
    type: 'question',
    depth,
    title: omitTitle ? undefined : item.title || '',
    titleIsHtml: true,
    bodyHtml: item.questionText || '',
    questionData: {
      options,
      allowTextAnswer: !!item.allowTextAnswer,
      requirement: item.requirement || 'optional',
      requirementLabel: requirementLabel(item.requirement || 'optional'),
    },
  };
}

// ── Public API ─────────────────────────────────────────────────────

// Single content item → document with one body-only section.
export async function collectContentItem(id, options = {}) {
  const { includeContent = true } = options;
  const item = await prisma.contentItem.findUnique({ where: { id } });
  if (!item) return null;
  const sections = includeContent
    ? [contentItemSection(item, { depth: 0, omitTitle: true })]
    : [];
  return {
    title: htmlToPlain(item.title) || '(ללא כותרת)',
    sections,
  };
}

// Single question item → document with one body-only section.
export async function collectQuestionItem(id, options = {}) {
  const { includeQuestions = true } = options;
  const item = await prisma.questionItem.findUnique({ where: { id } });
  if (!item) return null;
  const sections = includeQuestions
    ? [questionItemSection(item, { depth: 0, omitTitle: true })]
    : [];
  return {
    title: htmlToPlain(item.title) || '(ללא כותרת)',
    sections,
  };
}

// Folder → recursive document. Sub-folders become section headings;
// the root folder itself contributes only the document title (it would
// be redundant as a section since H1 already names it).
export async function collectFolder(folderId, options = {}) {
  const { includeContent = true, includeQuestions = true } = options;

  // Pull every folder + item once. Bank-scale (hundreds of folders /
  // thousands of items) doesn't justify a recursive CTE here — the
  // tree walk is O(n) over already-loaded rows.
  const [allFolders, allContent, allQuestions, root] = await Promise.all([
    prisma.itemBankFolder.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    includeContent
      ? prisma.contentItem.findMany({
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        })
      : Promise.resolve([]),
    includeQuestions
      ? prisma.questionItem.findMany({
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        })
      : Promise.resolve([]),
    prisma.itemBankFolder.findUnique({ where: { id: folderId } }),
  ]);
  if (!root) return null;

  const childFoldersByParent = new Map();
  for (const f of allFolders) {
    const key = f.parentId || null;
    if (!childFoldersByParent.has(key)) childFoldersByParent.set(key, []);
    childFoldersByParent.get(key).push(f);
  }
  const itemsByFolder = new Map();
  for (const c of allContent) {
    const key = c.folderId || null;
    if (!itemsByFolder.has(key)) itemsByFolder.set(key, []);
    itemsByFolder.get(key).push({ ...c, _kind: 'content' });
  }
  for (const q of allQuestions) {
    const key = q.folderId || null;
    if (!itemsByFolder.has(key)) itemsByFolder.set(key, []);
    itemsByFolder.get(key).push({ ...q, _kind: 'question' });
  }
  // Mixed content+question lists need to be re-sorted by sortOrder so
  // the document order matches what the bank UI shows.
  for (const arr of itemsByFolder.values()) {
    arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  const sections = [];

  function walk(parentId, depth) {
    // Items live IN this folder (parentId == folder of items).
    const items = itemsByFolder.get(parentId) || [];
    for (const it of items) {
      if (it._kind === 'content') {
        sections.push(contentItemSection(it, { depth }));
      } else {
        sections.push(questionItemSection(it, { depth }));
      }
    }
    // Sub-folders.
    const subs = childFoldersByParent.get(parentId) || [];
    for (const sub of subs) {
      sections.push({
        type: 'folder',
        depth,
        title: sub.name || '',
        titleIsHtml: false,
      });
      walk(sub.id, depth + 1);
    }
  }
  walk(root.id, 0);

  return {
    title: root.name || '(תיקייה)',
    sections,
  };
}

// Flow → walks the flow tree. Groups become folder-like sections.
export async function collectFlow(flowId, options = {}) {
  const { includeContent = true, includeQuestions = true } = options;
  const flow = await prisma.flow.findUnique({
    where: { id: flowId },
    include: {
      nodes: { include: { contentItem: true, questionItem: true } },
    },
  });
  if (!flow) return null;

  const nodes = flow.nodes || [];
  const childrenByParent = new Map();
  for (const n of nodes) {
    const key = n.parentId || null;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(n);
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  const sections = [];

  function walk(parentId, depth) {
    const kids = childrenByParent.get(parentId) || [];
    for (const n of kids) {
      if (n.kind === 'group') {
        sections.push({
          type: 'group',
          depth,
          title: n.groupTitle || '(קבוצה ללא שם)',
          titleIsHtml: false,
        });
        walk(n.id, depth + 1);
      } else if (n.kind === 'content' && includeContent && n.contentItem) {
        sections.push(contentItemSection(n.contentItem, { depth }));
      } else if (n.kind === 'question' && includeQuestions && n.questionItem) {
        sections.push(questionItemSection(n.questionItem, { depth }));
      }
    }
  }
  walk(null, 0);

  return {
    title: flow.title || '(זרימה ללא שם)',
    sections,
  };
}

// Re-export the plain-text helper so renderers can derive page <title>
// values from item HTML without duplicating the regex.
export { htmlToPlain };
