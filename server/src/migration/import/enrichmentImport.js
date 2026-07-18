// MIGRATION CONTENT ENRICHMENT — post-Wave-1 business content (owner, 2026-07-21).
// Fills the imported CRM records with the history that makes them usable:
//
//   1. Pipedrive NOTES → TimelineEntry kind 'note' on the deal (else contact,
//      else organization), original timestamp + author label, HTML sanitized.
//   2. Pipedrive ACTIVITIES:
//        done → TimelineEntry kind 'note', isSystem (historical evidence,
//               not editable), timestamped at completion.
//        open + deal is OPEN in GOS → a real active Task (approved rule D7a);
//        open otherwise → historical timeline evidence.
//      Person-subject activities import ONLY when they carry note content —
//      94k bare "call logged" rows would drown contact timelines for nothing.
//   3. Deal lead-source backfill: Deal.source (free text) + dealSourceId
//      (exact catalog label match). Fill-null-only — GOS edits are sacred.
//   4. תוכן הפנייה → one timeline note at the deal's original creation time.
//   5. Organization classification: סוג העסק → organizationTypeId (fill-null-
//      only, deterministic mapping table) + taxId (ח.פ) + card additions.
//   6. Tour card enrichment: Drive/Photos link, location, language, summary
//      fields, coordination notes — merged into the existing LegacyRecord
//      cardData, adding ONLY labels not already present.
//
// Idempotency: notes/activities/tasks are crosswalked (LegacyRecord unique on
// source triple); backfills only ever fill NULL fields; card merges only add
// missing labels. Rerun ⇒ zero writes. NOTHING here is destructive.
import crypto from 'node:crypto';

const t = (s) => String(s ?? '').trim();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const pid = (v) => (v && typeof v === 'object' ? v.value : v) ?? null;
// Pipedrive timestamps are UTC in "YYYY-MM-DD HH:MM:SS" form — parse them AS
// UTC (a bare space-form string would otherwise be read in the local zone).
export const pdIso = (s) => {
  if (!s) return null;
  const str = String(s);
  const d = new Date(/^\d{4}-\d{2}-\d{2} /.test(str) ? `${str.replace(' ', 'T')}Z` : /^\d{4}-\d{2}-\d{2}$/.test(str) ? `${str}T00:00:00Z` : str);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
export const canonicalJson = (obj) => JSON.stringify(obj, (key, value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  }
  return value;
});

// Minimal defensive sanitizer for imported Pipedrive HTML (notes render as
// rich HTML in NoteCard). Strips active content; keeps simple formatting.
export function sanitizeLegacyHtml(html) {
  let s = String(html ?? '');
  s = s.replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<(script|style|iframe|object|embed)\b[^>]*\/?>/gi, '');
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '');
  return s.trim();
}

export function htmlToPlain(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── 1) notes → timeline ───────────────────────────────────────────────────────
export function planNoteImport({ notes, dealXwalk, personXwalk, orgXwalk, existingNoteXwalk = new Map(), userName = new Map() }) {
  const payloads = [];
  const stats = { source: notes.length, create: 0, alreadyImported: 0, empty: 0, subjectDeal: 0, subjectContact: 0, subjectOrg: 0, noSubject: 0 };
  for (const n of [...notes].sort((a, b) => a.id - b.id)) {
    if (existingNoteXwalk.has(String(n.id))) { stats.alreadyImported += 1; continue; }
    const body = sanitizeLegacyHtml(n.content);
    if (!body) { stats.empty += 1; continue; }
    let subjectType = null, subjectId = null;
    const dealId = pid(n.deal_id);
    if (dealId != null && dealXwalk.has(String(dealId))) { subjectType = 'deal'; subjectId = dealXwalk.get(String(dealId)); stats.subjectDeal += 1; }
    else {
      const p = pid(n.person_id) != null ? personXwalk.get(String(pid(n.person_id))) : null;
      if (p?.entityType === 'Contact') { subjectType = 'contact'; subjectId = p.entityId; stats.subjectContact += 1; }
      else {
        const o = pid(n.org_id) != null ? orgXwalk.get(String(pid(n.org_id))) : null;
        if (o) { subjectType = 'organization'; subjectId = o; stats.subjectOrg += 1; }
      }
    }
    if (!subjectType) { stats.noSubject += 1; continue; }
    const author = userName.get(pid(n.user_id)) || null;
    payloads.push({
      sourceId: String(n.id), subjectType, subjectId,
      kind: 'note', isSystem: false,
      body,
      actorLabel: author ? `Pipedrive · ${author}` : 'ייבוא מ-Pipedrive',
      createdAt: pdIso(n.add_time),
    });
    stats.create += 1;
  }
  return { payloads, stats };
}

// ── 2) activities → timeline evidence / active tasks ──────────────────────────
export function planActivityImport({
  activities, dealXwalk, personXwalk, orgXwalk,
  openDealGosIds = new Set(),          // GOS deal ids whose status is 'open'
  existingActivityXwalk = new Map(),
  userName = new Map(), typeLabel = new Map(),
  taskOwnerUserId,                     // the AdminUser who owns imported active tasks
}) {
  const timeline = [];
  const tasks = [];
  const stats = {
    source: activities.length, alreadyImported: 0,
    doneTimeline: 0, openTimeline: 0, activeTasks: 0,
    personNoNote: 0, noSubject: 0,
    subjectDeal: 0, subjectContact: 0, subjectOrg: 0,
  };
  for (const a of [...activities].sort((x, y) => x.id - y.id)) {
    if (existingActivityXwalk.has(String(a.id))) { stats.alreadyImported += 1; continue; }
    const done = a.done === true || a.done === 1;
    const note = sanitizeLegacyHtml(a.note);
    let subjectType = null, subjectId = null, gosDealId = null;
    const dealId = pid(a.deal_id);
    if (dealId != null && dealXwalk.has(String(dealId))) { subjectType = 'deal'; subjectId = gosDealId = dealXwalk.get(String(dealId)); }
    else {
      const p = pid(a.person_id) != null ? personXwalk.get(String(pid(a.person_id))) : null;
      if (p?.entityType === 'Contact') { subjectType = 'contact'; subjectId = p.entityId; }
      else {
        const o = pid(a.org_id) != null ? orgXwalk.get(String(pid(a.org_id))) : null;
        if (o) { subjectType = 'organization'; subjectId = o; }
      }
    }
    if (!subjectType) { stats.noSubject += 1; continue; }
    // Person/org-level bare rows (no content) are deliberately NOT imported —
    // tens of thousands of empty "call" logs would bury the contact timeline.
    if (subjectType !== 'deal' && !note) { stats.personNoNote += 1; continue; }
    if (subjectType === 'deal') stats.subjectDeal += 1; else if (subjectType === 'contact') stats.subjectContact += 1; else stats.subjectOrg += 1;

    const label = typeLabel.get(a.type) || a.type || 'פעילות';
    const author = userName.get(pid(a.user_id) ?? pid(a.assigned_to_user_id)) || null;
    const subject = t(a.subject);

    if (!done && gosDealId && openDealGosIds.has(gosDealId)) {
      // A still-open activity on a LIVE deal → a real GOS task (rule D7a).
      tasks.push({
        sourceId: String(a.id), dealId: gosDealId,
        title: subject || label,
        dueDate: pdIso(a.due_date) || pdIso(a.add_time),
        dueTime: a.due_time ? String(a.due_time).slice(0, 5) : null,
        notes: htmlToPlain(note) || null,
        ownerUserId: taskOwnerUserId,
        createdAt: pdIso(a.add_time),
      });
      stats.activeTasks += 1;
      continue;
    }
    const when = done
      ? (a.marked_as_done_time || a.due_date || a.add_time)
      : (a.due_date || a.add_time);
    const header = done ? `${label}${subject ? ` · ${subject}` : ''}` : `משימה פתוחה (לא הושלמה) · ${label}${subject ? ` · ${subject}` : ''}`;
    timeline.push({
      sourceId: String(a.id), subjectType, subjectId,
      kind: 'note', isSystem: true,
      body: `<div><b>${escapeHtml(header)}</b></div>${note ? `<div>${note}</div>` : ''}`,
      actorLabel: author ? `Pipedrive · ${author}` : 'ייבוא: פעילות מ-Pipedrive',
      createdAt: pdIso(when),
    });
    done ? (stats.doneTimeline += 1) : (stats.openTimeline += 1);
  }
  return { timeline, tasks, stats };
}

// ── 3+4) deal backfill: lead source + inquiry-content note ────────────────────
export function planDealBackfill({
  deals, fieldKeys, sourceOptionLabel = new Map(), // enum option id → label
  dealSourceIdByLabel = new Map(),                 // normalized label → DealSource.id
  gosDeals = new Map(),                            // orderNo → { id, source, dealSourceId }
  existingInquiryXwalk = new Map(),
}) {
  // Normalize before catalog match: Pipedrive labels often carry a trailing
  // " - <option id>" suffix; a few English aliases map to their Hebrew rows.
  const ALIASES = { whatsapp: 'וואטספ', google: 'גוגל', fb: 'פייסבוק', ig: 'אינסטגרם', 'לקוח/ה חוזרת': 'לקוח/ה חוזר/ת' };
  const norm = (s) => {
    const base = t(s).toLowerCase().replace(/\s*-\s*\d+$/, '');
    return (ALIASES[base] || base).toLowerCase();
  };
  const updates = [];
  const inquiryNotes = [];
  const stats = { withSourceText: 0, setSource: 0, matchedCatalog: 0, setDealSourceId: 0, skippedGosEdited: 0, inquiryNotes: 0, inquiryAlready: 0, unmatchedLabels: new Map() };
  for (const d of [...deals].sort((a, b) => a.id - b.id)) {
    const gos = gosDeals.get(d.id);
    if (!gos) continue;
    const freeText = t(d[fieldKeys.sourceText] ?? '');
    const enumLabel = d[fieldKeys.sourceEnum] != null ? sourceOptionLabel.get(String(pid(d[fieldKeys.sourceEnum]))) || null : null;
    const sourceValue = freeText || enumLabel || '';
    const set = {};
    if (sourceValue) {
      stats.withSourceText += 1;
      if (gos.source == null) { set.source = sourceValue; stats.setSource += 1; }
      else stats.skippedGosEdited += 1;
    }
    const catalogId = enumLabel ? dealSourceIdByLabel.get(norm(enumLabel)) : (freeText ? dealSourceIdByLabel.get(norm(freeText)) : null);
    if (enumLabel || freeText) {
      if (catalogId) {
        stats.matchedCatalog += 1;
        if (gos.dealSourceId == null) { set.dealSourceId = catalogId; stats.setDealSourceId += 1; }
      } else {
        const key = norm(enumLabel || freeText);
        stats.unmatchedLabels.set(key, (stats.unmatchedLabels.get(key) || 0) + 1);
      }
    }
    if (Object.keys(set).length) updates.push({ orderNo: d.id, dealId: gos.id, set });

    const inquiry = t(d[fieldKeys.inquiryContent] ?? '');
    if (inquiry) {
      if (existingInquiryXwalk.has(String(d.id))) stats.inquiryAlready += 1;
      else {
        inquiryNotes.push({
          sourceId: String(d.id), subjectType: 'deal', subjectId: gos.id,
          kind: 'note', isSystem: true,
          body: `<div><b>תוכן הפנייה המקורית</b></div><div>${escapeHtml(inquiry).replace(/\n/g, '<br>')}</div>`,
          actorLabel: 'ייבוא: תוכן הפנייה',
          createdAt: pdIso(d.add_time),
        });
        stats.inquiryNotes += 1;
      }
    }
  }
  stats.unmatchedLabels = Object.fromEntries([...stats.unmatchedLabels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20));
  return { updates, inquiryNotes, stats };
}

// ── 5) organization classification + card additions ───────────────────────────
// Deterministic mapping: Pipedrive "סוג העסק" label → GOS OrganizationType label.
// "לא עסק-לקוח פרטי" deliberately maps to NO type (a private customer recorded
// as an org is not a business classification). Unknown values are NOT guessed —
// they surface in stats.unmappedValues for review and stay on the card.
export const ORG_TYPE_MAPPING = {
  'עסקים וחברות קטנות': 'חברות וארגונים',
  'תאגידים וחברות גדולות, גופים ממשלתיים': 'חברות וארגונים',
  'בית ספר/ עמותה/ מוסד חינוך': 'בתי ספר',
  'בית ספר - תלמידים': 'בתי ספר',
  'בית ספר - מורות': 'בתי ספר',
  'סוכנויות נסיעות ותיירות': 'סוכנויות תיירות ונסיעות',
  'חברות הפקה ואירועים': 'חברות הפקה ואירועים',
  'עמותות': 'עמותות',
  'אוניברטיסאות / מכללות': 'אוניבסיטאות / מכללות',
  'לא עסק-לקוח פרטי': null,
};

export function planOrgEnrichment({
  orgs, orgFieldKeys, orgOptionLabel = new Map(),
  typeIdByLabel = new Map(),           // GOS OrganizationType label → id
  orgXwalk = new Map(), gosOrgs = new Map(), // entityId → { organizationTypeId, taxId }
  existingCards = new Map(),           // entityId → cardData array (org LegacyRecord)
}) {
  const updates = [];
  const cardMerges = [];
  const stats = { classified: 0, setType: 0, keptGosType: 0, privateCustomer: 0, unmappedValues: {}, setTaxId: 0, cardLabelsAdded: 0 };
  for (const o of [...orgs].sort((a, b) => a.id - b.id)) {
    const entityId = orgXwalk.get(String(o.id));
    if (!entityId) continue;
    const gos = gosOrgs.get(entityId);
    if (!gos) continue;
    const set = {};
    const rawType = o[orgFieldKeys.bizType] != null ? orgOptionLabel.get(String(pid(o[orgFieldKeys.bizType]))) || null : null;
    if (rawType) {
      const target = ORG_TYPE_MAPPING[rawType];
      if (target === undefined) stats.unmappedValues[rawType] = (stats.unmappedValues[rawType] || 0) + 1;
      else if (target === null) stats.privateCustomer += 1;
      else {
        const typeId = typeIdByLabel.get(target);
        if (typeId) {
          stats.classified += 1;
          if (gos.organizationTypeId == null) { set.organizationTypeId = typeId; stats.setType += 1; }
          else stats.keptGosType += 1;
        }
      }
    }
    const taxId = t(o[orgFieldKeys.taxId] ?? '');
    if (taxId && gos.taxId == null) { set.taxId = taxId; stats.setTaxId += 1; }
    if (Object.keys(set).length) updates.push({ entityId, set });

    // card additions — only labels missing from the existing card
    const cardAdds = [];
    const existing = new Set((existingCards.get(entityId) || []).map((c) => c.label));
    const addCard = (label, value) => { const v = t(String(value ?? '')); if (v && !existing.has(label)) cardAdds.push({ label, value: v.slice(0, 500) }); };
    if (rawType) addCard('סוג העסק (מקור)', rawType);
    addCard('iCount ID (מערכת קודמת)', o[orgFieldKeys.icountId]);
    if (o[orgFieldKeys.payTerms] != null) addCard('תנאי תשלום (מקור)', orgOptionLabel.get(String(pid(o[orgFieldKeys.payTerms]))) || pid(o[orgFieldKeys.payTerms]));
    if (o[orgFieldKeys.payMethod] != null) addCard('אמצעי תשלום (מקור)', orgOptionLabel.get(String(pid(o[orgFieldKeys.payMethod]))) || pid(o[orgFieldKeys.payMethod]));
    addCard('קישור קבוע לטופס הזמנה', o[orgFieldKeys.orderFormLink]);
    if (cardAdds.length) { cardMerges.push({ entityId, adds: cardAdds }); stats.cardLabelsAdded += cardAdds.length; }
  }
  return { updates, cardMerges, stats };
}

// ── 6) tour card enrichment (merge-only additions to existing cardData) ───────
const TOUR_CARD_FIELDS = [
  ['לינק לתיקייה בדרייב', 'תמונות/דרייב (מערכת קודמת)'],
  ['מיקום טקסט', 'מיקום (מקור)'],
  ['עיר', 'עיר (מקור)'],
  ['שפת הדרכת הסיור', 'שפת הדרכה (מקור)'],
  ['סוג פעילות', 'סוג פעילות (מקור)'],
  ['איך היה הסיור', 'איך היה הסיור (סיכום מדריך)'],
  ['משהו חיובי שהיה/ משהו שקרה במהלך הסיור', 'משהו חיובי (סיכום מדריך)'],
  ['משהו מיוחד/ ייחודי לקבוצה שהייתה, קצת עליהם', 'על הקבוצה (סיכום מדריך)'],
  ['האם היו אירועים חריגים שכדאי שנדע עליהם', 'אירועים חריגים (סיכום מדריך)'],
  ['הצעות כלליות לשימור/שיפור', 'הצעות לשימור/שיפור (סיכום מדריך)'],
  ['הערות משיחת תיאום סיור', 'הערות משיחת תיאום'],
];
const PART_CARD_FIELDS = [
  ['קצת על הקבוצה', 'על הקבוצה (תיאום)'],
  ['מידע חשוב על הלקוח', 'מידע חשוב על הלקוח (תיאום)'],
  ['הערות משיחת תאום סיור', 'הערות משיחת תיאום'],
  ['מגבלות שצריך לדעת עליהן', 'מגבלות'],
  ['שביעות רצון מהפעילות', 'משוב: שביעות רצון מהפעילות'],
  ['שביעות רצון מהשירות לפני הפעילות', 'משוב: שביעות רצון מהשירות'],
];
const first = (v) => (Array.isArray(v) ? v[0] : v);

export function planTourCardEnrichment({ tourRecords, participantRecords = [], tourXwalk = new Map(), existingCards = new Map() }) {
  const merges = [];
  const stats = { toursTouched: 0, labelsAdded: 0, participantBlocks: 0 };
  const partsByTour = new Map();
  for (const pr of participantRecords) {
    const master = Array.isArray(pr.fields?.['שם סיור']) ? pr.fields['שם סיור'][0] : null;
    if (!master) continue;
    if (!partsByTour.has(master)) partsByTour.set(master, []);
    partsByTour.get(master).push(pr);
  }
  for (const r of tourRecords) {
    const entityId = tourXwalk.get(r.id);
    if (!entityId) continue;
    const existing = new Set((existingCards.get(entityId) || []).map((c) => c.label));
    const adds = [];
    const add = (label, value) => {
      const v = t(String(first(value) ?? ''));
      if (v && v !== '[object Object]' && !existing.has(label) && !adds.some((a) => a.label === label)) adds.push({ label, value: v.slice(0, 1000) });
    };
    for (const [src, label] of TOUR_CARD_FIELDS) add(label, r.fields?.[src]);
    for (const pr of (partsByTour.get(r.id) || []).sort((a, b) => a.id.localeCompare(b.id))) {
      const dealNo = t(String(first(pr.fields?.['פייפ דיל ID']) ?? ''));
      const prefix = dealNo ? `דיל ${dealNo} · ` : '';
      let added = false;
      for (const [src, label] of PART_CARD_FIELDS) {
        const v = t(String(first(pr.fields?.[src]) ?? ''));
        const full = `${prefix}${label}`;
        if (v && v !== '[object Object]' && !existing.has(full) && !adds.some((a) => a.label === full)) { adds.push({ label: full, value: v.slice(0, 1000) }); added = true; }
      }
      if (added) stats.participantBlocks += 1;
    }
    if (adds.length) { merges.push({ entityId, sourceRecId: r.id, adds }); stats.toursTouched += 1; stats.labelsAdded += adds.length; }
  }
  return { merges, stats };
}

// ── hash + gates ──────────────────────────────────────────────────────────────
export function buildEnrichmentPlan(sections) {
  const c = canonicalJson(sections);
  return { ...sections, payloadHash: sha256(c), payloadBytes: c.length };
}

export function checkEnrichmentGates({ plan, expectHash }) {
  const failures = [];
  if (!expectHash) failures.push('expect-hash חסר');
  else if (plan.payloadHash !== expectHash) failures.push(`hash שונה מהמאושר (${plan.payloadHash.slice(0, 16)}… ≠ ${String(expectHash).slice(0, 16)}…)`);
  const all = [...plan.notes.payloads, ...plan.activities.timeline, ...plan.dealBackfill.inquiryNotes];
  if (all.some((p) => !p.subjectId || !p.createdAt)) failures.push('נמצא payload ללא subject או ללא זמן מקור');
  if (plan.activities.tasks.some((x) => !x.ownerUserId || !x.dueDate)) failures.push('משימה ללא בעלים או תאריך יעד');
  return { ok: failures.length === 0, failures };
}

// ── executor ──────────────────────────────────────────────────────────────────
export async function executeEnrichment(prisma, plan, { batchId, snapshotId, chunk = 500, log = () => {}, checkpoint = async () => {} } = {}) {
  const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
  const counters = { timeline: 0, tasks: 0, dealUpdates: 0, orgUpdates: 0, cardMerges: 0 };

  // timeline entries (notes + activity evidence + inquiry notes) — crosswalked
  const timelineItems = [
    ...plan.notes.payloads.map((p) => ({ ...p, xType: 'note' })),
    ...plan.activities.timeline.map((p) => ({ ...p, xType: 'activity' })),
    ...plan.dealBackfill.inquiryNotes.map((p) => ({ ...p, xType: 'deal_inquiry' })),
  ];
  for (const slice of chunks(timelineItems, chunk)) {
    const rows = [], xrows = [];
    for (const p of slice) {
      const id = crypto.randomUUID();
      rows.push({
        id, subjectType: p.subjectType, subjectId: p.subjectId,
        kind: p.kind, isSystem: p.isSystem, body: p.body,
        actorType: 'import', actorLabel: p.actorLabel,
        createdAt: new Date(p.createdAt),
      });
      xrows.push({ sourceSystem: 'pipedrive', sourceType: p.xType, sourceId: p.sourceId, entityType: 'TimelineEntry', entityId: id, importBatchId: batchId, snapshotId });
    }
    await prisma.$transaction([
      prisma.timelineEntry.createMany({ data: rows }),
      prisma.legacyRecord.createMany({ data: xrows, skipDuplicates: true }),
    ]);
    counters.timeline += slice.length;
    await checkpoint(counters);
    if (counters.timeline % 10000 < chunk) log(`  ✓ timeline ${counters.timeline}/${timelineItems.length}`);
  }
  log(`  ✓ timeline total ${counters.timeline}`);

  // active tasks — crosswalked
  for (const slice of chunks(plan.activities.tasks, chunk)) {
    const rows = [], xrows = [];
    for (const x of slice) {
      const id = crypto.randomUUID();
      rows.push({
        id, dealId: x.dealId, title: x.title.slice(0, 200) || 'משימה מיובאת',
        dueDate: new Date(x.dueDate), dueTime: x.dueTime,
        notes: x.notes, ownerUserId: x.ownerUserId,
        status: 'open', channel: 'none',
        ...(x.createdAt ? { createdAt: new Date(x.createdAt) } : {}),
      });
      xrows.push({ sourceSystem: 'pipedrive', sourceType: 'activity', sourceId: x.sourceId, entityType: 'Task', entityId: id, importBatchId: batchId, snapshotId });
    }
    await prisma.$transaction([
      prisma.task.createMany({ data: rows }),
      prisma.legacyRecord.createMany({ data: xrows, skipDuplicates: true }),
    ]);
    counters.tasks += slice.length;
  }
  log(`  ✓ tasks ${counters.tasks}`);

  // deal field backfill (fill-null-only was decided at PLAN time from live values)
  for (const slice of chunks(plan.dealBackfill.updates, 100)) {
    await prisma.$transaction(slice.map((u) => prisma.deal.update({ where: { id: u.dealId }, data: u.set })));
    counters.dealUpdates += slice.length;
  }
  log(`  ✓ deal backfills ${counters.dealUpdates}`);

  // org updates + card merges
  for (const slice of chunks(plan.orgs.updates, 100)) {
    await prisma.$transaction(slice.map((u) => prisma.organization.update({ where: { id: u.entityId }, data: u.set })));
    counters.orgUpdates += slice.length;
  }
  const mergeCard = async (entityType, entityId, adds) => {
    const rec = await prisma.legacyRecord.findFirst({ where: { entityType, entityId }, orderBy: { id: 'asc' } });
    if (!rec) return false;
    const existing = new Set((rec.cardData || []).map((c) => c.label));
    const fresh = adds.filter((a) => !existing.has(a.label));
    if (!fresh.length) return false;
    await prisma.legacyRecord.update({ where: { id: rec.id }, data: { cardData: [...(rec.cardData || []), ...fresh] } });
    return true;
  };
  for (const m of plan.orgs.cardMerges) { if (await mergeCard('Organization', m.entityId, m.adds)) counters.cardMerges += 1; }
  for (const m of plan.tourCards.merges) { if (await mergeCard('TourEvent', m.entityId, m.adds)) counters.cardMerges += 1; }
  log(`  ✓ org updates ${counters.orgUpdates} · card merges ${counters.cardMerges}`);
  return counters;
}
