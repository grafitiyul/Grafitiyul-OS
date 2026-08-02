// Communication Center API ("נוסחים למייל + WhatsApp").
// Mounted at /api/communication behind requireAdminAuth.
//
// Surface:
//   GET  /meta                    — catalogs the editor needs (triggers,
//                                   variables, condition fields, doc kinds,
//                                   WA accounts, windows, org taxonomy)
//   GET  /events                  — paginated management list (search incl. #N)
//   POST /events                  — create event (draft)
//   GET  /events/:id              — full event + messages + validation state
//   PUT  /events/:id              — update event config
//   POST /events/:id/activate|disable|archive|duplicate
//   DELETE /events/:id            — HARD delete (real delete, not archive).
//                                   Requires an identified admin session, is
//                                   refused once the event has send history, and
//                                   writes an audit row. See
//                                   src/communication/deleteEvent.js.
//   POST /events/:id/messages     — add message (draft; publicNumber = DB serial)
//   PUT  /messages/:id            — save draft (config + content; never touches
//                                   the published version)
//   POST /messages/:id/publish    — validate → freeze immutable version → live
//   POST /messages/:id/disable|enable|duplicate
//   GET  /messages/:id/versions   — immutable version history
//   POST /messages/:id/restore    — restore a version as the working draft
//   POST /messages/:id/translate  — AI Hebrew→English (draft-only, marked ai_draft)
//   POST /messages/:id/preview    — full production-resolver preview (no delivery)
//   POST /messages/:id/test-send  — explicit-destination test (logged, no timeline)
//   GET  /deliveries              — delivery log (filter by message/deal/status)
//   POST /deliveries/:id/cancel   — cancel a waiting delivery
//   CRUD /windows + /exceptions   — sending-window policies ("זמני שליחה")
//   GET  /wa-groups, /contacts-search, /staff-search — searchable selector data
//
// Versioning policy (documented product decision): a delivery FREEZES the
// message's published version at scheduling time. Later edits/publishes never
// silently change queued or sent communications.

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { parseListQuery } from './listPagination.js';
import { contactSearchWhere } from '../search/contactWhere.js';
import { phoneQuery } from '../search/phoneQuery.js';
import { bridgeUrlMap } from '../whatsapp/bridgeClient.js';
import { sendWhatsAppText, phoneToJid } from '../whatsapp/send.js';
import { callBridge } from '../whatsapp/bridgeClient.js';
import { sendCrmEmail } from '../email/simpleSend.js';
import {
  TIMING_UNITS, TIMING_MODES, ANCHOR_TYPES,
  EVENT_STATUSES, CHANNELS, AUDIENCE_TYPES,
} from '../communication/triggers.js';
// The COMPOSED catalog — built-in triggers plus one per registered automation.
// Reading the static list here would hide automation triggers from the picker
// and reject them as invalid on save.
import {
  allTriggers, allTriggerTypes, triggerByType, CATEGORY_LABELS, KIND_LABELS,
} from '../communication/triggerCatalog.js';
import { processTrigger } from '../communication/engine.js';
import { emitTimelineEvent, userOrigin } from '../timeline/events.js';
import { requireAdminUser } from '../auth.js';
import {
  loadDeletionState, evaluateDeletability, deleteCommunicationEvent,
} from '../communication/deleteEvent.js';
import { VARIABLES, VARIABLE_CATEGORIES, variablesForTrigger } from '../communication/variables.js';
import { CONDITION_FIELDS, CONDITION_OPS, ACTIVITY_TYPES, evaluateApplicability } from '../communication/conditions.js';
import { DOCUMENT_KINDS } from '../communication/documents.js';
import { validateMessageForPublish, validateEventForActivation } from '../communication/validation.js';
import { loadTriggerContext } from '../communication/context.js';
import { renderMessage } from '../communication/render.js';
import { parseHHMM } from '../communication/windows.js';
import { prepareMessageRun } from '../communication/prepare.js';
import { buildSyntheticContext } from '../communication/synthetic.js';
import { normalizeTokensToChips } from '../../../shared/variableTokens.mjs';
import { variableByKey } from '../communication/variables.js';
import { translateContent, translationConfigured } from '../communication/translate.js';
import { loadDocumentBytes } from '../communication/documents.js';
import { ACCOUNT_ORDER_BY } from '../whatsapp/senderAccount.js';

const router = Router();

const str = (v) => (v == null ? null : String(v).trim() || null);

// ── meta ─────────────────────────────────────────────────────────────────────

router.get('/meta', handle(async (_req, res) => {
  const [waAccounts, windows, orgTypes, orgSubtypes, products, variants, locations, dealSources] =
    await Promise.all([
      prisma.whatsAppAccount.findMany({ orderBy: ACCOUNT_ORDER_BY }),
      prisma.communicationSendingWindow.findMany({ orderBy: { sortOrder: 'asc' }, include: { exceptions: false } }),
      prisma.organizationType.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, label: true } }),
      prisma.organizationSubtype.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, label: true, organizationTypeId: true } }),
      prisma.product.findMany({ orderBy: { nameHe: 'asc' }, select: { id: true, nameHe: true } }),
      prisma.productVariant.findMany({ select: { id: true, product: { select: { nameHe: true } }, location: { select: { nameHe: true } } } }),
      prisma.location.findMany({ orderBy: { nameHe: 'asc' }, select: { id: true, nameHe: true } }),
      prisma.dealSource.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, label: true } }),
    ]);
  const envAccounts = Object.keys(bridgeUrlMap());
  const accountRows = waAccounts.map((a) => ({
    id: a.id, label: a.label, status: a.status, active: a.active, phoneJid: a.phoneJid,
  }));
  for (const id of envAccounts) {
    if (!accountRows.find((a) => a.id === id)) {
      accountRows.push({ id, label: id, status: 'unknown', active: true, phoneJid: null });
    }
  }
  res.json({
    triggers: allTriggers().map(({ type, labelHe, contexts, anchors, category, kind, hintHe, autId }) => ({
      type, labelHe, contexts, anchors, category, kind, hintHe, autId: autId || null,
    })),
    triggerCategories: CATEGORY_LABELS,
    triggerKinds: KIND_LABELS,
    timingUnits: TIMING_UNITS,
    timingModes: TIMING_MODES,
    anchorTypes: ANCHOR_TYPES,
    channels: CHANNELS,
    audienceTypes: AUDIENCE_TYPES,
    activityTypes: ACTIVITY_TYPES,
    conditionFields: Object.entries(CONDITION_FIELDS).map(([key, f]) => ({ key, labelHe: f.labelHe, ref: f.ref })),
    conditionOps: CONDITION_OPS,
    variables: VARIABLES.map(({ key, labelHe, labelEn, category, contexts }) => ({ key, labelHe, labelEn, category, contexts })),
    variableCategories: VARIABLE_CATEGORIES,
    documentKinds: DOCUMENT_KINDS.map(({ kind, labelHe, modes, contexts }) => ({ kind, labelHe, modes, contexts })),
    waAccounts: accountRows,
    windows,
    orgTypes,
    orgSubtypes,
    products,
    variants: variants.map((v) => ({ id: v.id, label: `${v.product?.nameHe || ''} — ${v.location?.nameHe || ''}` })),
    locations,
    dealSources,
    translationConfigured: translationConfigured(),
  });
}));

// variables filtered per trigger (editor menu)
router.get('/variables', handle(async (req, res) => {
  const trigger = triggerByType(String(req.query.trigger || ''));
  const list = trigger ? variablesForTrigger(trigger.contexts) : VARIABLES;
  res.json(list.map(({ key, labelHe, labelEn, category }) => ({ key, labelHe, labelEn, category })));
}));

// ── events list (the main screen) ────────────────────────────────────────────

router.get('/events', handle(async (req, res) => {
  const { page, pageSize, skip, take, search } = parseListQuery(req.query);
  const where = {};
  const status = str(req.query.status);
  const trigger = str(req.query.trigger);
  const channel = str(req.query.channel);
  // ARCHIVED events are retired: a message that will never be sent again is
  // noise on the operator's main screen, and three of them were sitting there
  // named "[הוסר] …" after the Manager Reports migration.
  //
  // "כל הסטטוסים" therefore means every LIVE status, not literally every row.
  // Asking for archived explicitly still returns them — the status dropdown
  // offers it, and that is the audit view. The rows are never deleted.
  if (status) where.status = status;
  else where.status = { not: 'archived' };
  if (trigger) where.triggerType = trigger;
  if (channel) where.messages = { some: { channel } };
  if (search) {
    const numMatch = /^#?(\d+)$/.exec(search);
    if (numMatch) {
      where.messages = { some: { publicNumber: Number(numMatch[1]) } };
    } else {
      where.OR = [
        { internalName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { messages: { some: { internalName: { contains: search, mode: 'insensitive' } } } },
      ];
    }
  }
  const sortKey = String(req.query.sort || 'updatedAt:desc').split(':');
  const SORTS = { updatedAt: 'updatedAt', createdAt: 'createdAt', internalName: 'internalName', status: 'status', triggerType: 'triggerType' };
  const orderBy = [{ [SORTS[sortKey[0]] || 'updatedAt']: sortKey[1] === 'asc' ? 'asc' : 'desc' }, { id: 'desc' }];

  const [total, rows] = await Promise.all([
    prisma.communicationEvent.count({ where }),
    prisma.communicationEvent.findMany({
      where, orderBy, skip, take,
      include: {
        messages: {
          orderBy: { publicNumber: 'asc' },
          select: {
            id: true, publicNumber: true, internalName: true, channel: true, status: true,
            audienceType: true, waAccountId: true, waDestinationType: true,
            windowEnabled: true, sendingWindowId: true, languagePolicy: true,
            publishedVersionId: true, draftContent: true, updatedAt: true,
          },
        },
        _count: { select: { deliveries: true } },
      },
    }),
  ]);
  res.json({
    rows: rows.map((e) => ({
      ...e,
      messages: e.messages.map((m) => ({
        ...m,
        languageState: languageState(m),
        draftContent: undefined,
      })),
    })),
    total, page, pageSize,
  });
}));

function languageState(message) {
  const d = message.draftContent || {};
  const has = (c) => !!String(c?.body ?? '').replace(/<[^>]*>/g, '').trim();
  return {
    he: has(d.he) ? 'complete' : 'missing',
    en: has(d.en) ? (d.enState === 'ai_draft' ? 'ai_draft' : 'complete') : 'missing',
  };
}

// ── event CRUD ───────────────────────────────────────────────────────────────

const EVENT_FIELDS = (b) => ({
  ...(b.internalName !== undefined ? { internalName: String(b.internalName || '').trim() } : {}),
  ...(b.description !== undefined ? { description: str(b.description) } : {}),
  ...(b.triggerType !== undefined ? { triggerType: String(b.triggerType) } : {}),
  ...(b.anchorType !== undefined ? { anchorType: String(b.anchorType) } : {}),
  ...(b.timingMode !== undefined ? { timingMode: String(b.timingMode) } : {}),
  ...(b.timingAmount !== undefined ? { timingAmount: b.timingAmount == null ? null : Number(b.timingAmount) } : {}),
  ...(b.timingUnit !== undefined ? { timingUnit: str(b.timingUnit) } : {}),
  ...(b.activityMode !== undefined ? { activityMode: String(b.activityMode) } : {}),
  ...(b.activityTypes !== undefined ? { activityTypes: (b.activityTypes || []).filter((t) => ACTIVITY_TYPES.includes(t)) } : {}),
  ...(b.orgTypeIds !== undefined ? { orgTypeIds: (b.orgTypeIds || []).map(String) } : {}),
  ...(b.orgSubtypeIds !== undefined ? { orgSubtypeIds: (b.orgSubtypeIds || []).map(String) } : {}),
  ...(b.conditions !== undefined ? { conditions: Array.isArray(b.conditions) ? b.conditions : [] } : {}),
});

function validateEventInput(b) {
  if (b.triggerType !== undefined && !allTriggerTypes().includes(b.triggerType)) return 'invalid_trigger';
  if (b.anchorType !== undefined && !ANCHOR_TYPES.includes(b.anchorType)) return 'invalid_anchor';
  if (b.timingMode !== undefined && !TIMING_MODES.includes(b.timingMode)) return 'invalid_timing_mode';
  if (b.timingUnit !== undefined && b.timingUnit != null && !TIMING_UNITS.includes(b.timingUnit)) return 'invalid_timing_unit';
  if (b.activityMode !== undefined && !['all', 'include', 'exclude'].includes(b.activityMode)) return 'invalid_activity_mode';
  return null;
}

router.post('/events', handle(async (req, res) => {
  const b = req.body || {};
  if (!String(b.internalName || '').trim()) return res.status(400).json({ error: 'name_required' });
  if (!allTriggerTypes().includes(b.triggerType)) return res.status(400).json({ error: 'invalid_trigger' });
  const err = validateEventInput(b);
  if (err) return res.status(400).json({ error: err });
  const event = await prisma.communicationEvent.create({
    data: { ...EVENT_FIELDS(b), status: 'draft', createdById: req.adminAuth?.userId || null },
  });
  res.status(201).json(event);
}));

async function loadEvent(id) {
  return prisma.communicationEvent.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { publicNumber: 'asc' }, include: { sendingWindow: { select: { id: true, name: true } } } },
    },
  });
}

router.get('/events/:id', handle(async (req, res) => {
  const event = await loadEvent(req.params.id);
  if (!event) return res.status(404).json({ error: 'not_found' });
  // Per-message validation state → editor inline warnings.
  const messages = [];
  for (const m of event.messages) {
    messages.push({
      ...m,
      languageState: languageState(m),
      validationErrors: await validateMessageForPublish(m, event),
    });
  }
  // Deletion verdict from the SAME evaluator the DELETE guard uses, so the
  // editor's "מחק" affordance can never promise something the API refuses.
  const deletionState = await loadDeletionState(prisma, event.id);
  res.json({
    ...event,
    messages,
    activationErrors: validateEventForActivation(event),
    deletion: evaluateDeletability(deletionState),
  });
}));

router.put('/events/:id', handle(async (req, res) => {
  const b = req.body || {};
  const err = validateEventInput(b);
  if (err) return res.status(400).json({ error: err });
  try {
    const event = await prisma.communicationEvent.update({
      where: { id: req.params.id },
      data: { ...EVENT_FIELDS(b), updatedById: req.adminAuth?.userId || null },
    });
    res.json(event);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'not_found' });
    throw e;
  }
}));

router.post('/events/:id/activate', handle(async (req, res) => {
  const event = await loadEvent(req.params.id);
  if (!event) return res.status(404).json({ error: 'not_found' });
  const errors = validateEventForActivation(event);
  if (errors.length) return res.status(422).json({ error: 'validation_failed', errors });
  const updated = await prisma.communicationEvent.update({
    where: { id: event.id },
    data: { status: 'active', updatedById: req.adminAuth?.userId || null },
  });
  res.json(updated);
}));

router.post('/events/:id/disable', handle(async (req, res) => {
  const updated = await prisma.communicationEvent.update({
    where: { id: req.params.id },
    data: { status: 'disabled', updatedById: req.adminAuth?.userId || null },
  }).catch(() => null);
  if (!updated) return res.status(404).json({ error: 'not_found' });
  res.json(updated);
}));

router.post('/events/:id/archive', handle(async (req, res) => {
  const updated = await prisma.communicationEvent.update({
    where: { id: req.params.id },
    data: { status: 'archived', updatedById: req.adminAuth?.userId || null },
  }).catch(() => null);
  if (!updated) return res.status(404).json({ error: 'not_found' });
  res.json(updated);
}));

// HARD delete — deliberately a real delete, not a status change. Archive and
// disable above remain available and unchanged; this is the third, irreversible
// option. requireAdminUser (not the ordinary requireAdminAuth) because an
// irreversible delete needs a named actor for the audit row.
router.delete('/events/:id', requireAdminUser, handle(async (req, res) => {
  const origin = await userOrigin(req.adminAuth.userId);
  const { status, body } = await deleteCommunicationEvent(prisma, { id: req.params.id, origin });
  res.status(status).json(body);
}));

// Duplicate: new event (draft) + duplicated messages — each duplicate gets a
// NEW publicNumber from the sequence (numbers are never reused) and starts as
// an unpublished draft.
router.post('/events/:id/duplicate', handle(async (req, res) => {
  const event = await loadEvent(req.params.id);
  if (!event) return res.status(404).json({ error: 'not_found' });
  const copy = await prisma.$transaction(async (tx) => {
    const created = await tx.communicationEvent.create({
      data: {
        internalName: `${event.internalName} (עותק)`,
        description: event.description,
        status: 'draft',
        triggerType: event.triggerType,
        anchorType: event.anchorType,
        timingMode: event.timingMode,
        timingAmount: event.timingAmount,
        timingUnit: event.timingUnit,
        activityMode: event.activityMode,
        activityTypes: event.activityTypes,
        orgTypeIds: event.orgTypeIds,
        orgSubtypeIds: event.orgSubtypeIds,
        conditions: event.conditions ?? undefined,
        createdById: req.adminAuth?.userId || null,
      },
    });
    for (const m of event.messages) {
      await tx.communicationMessage.create({ data: duplicateMessageData(m, created.id) });
    }
    return created;
  });
  res.status(201).json(copy);
}));

function duplicateMessageData(m, eventId) {
  return {
    eventId,
    internalName: m.internalName ? `${m.internalName} (עותק)` : null,
    channel: m.channel,
    status: 'draft',
    audienceType: m.audienceType,
    audienceContactId: m.audienceContactId,
    audiencePersonRefId: m.audiencePersonRefId,
    waAccountId: m.waAccountId,
    waDestinationType: m.waDestinationType,
    waGroupChatId: m.waGroupChatId,
    windowEnabled: m.windowEnabled,
    sendingWindowId: m.sendingWindowId,
    languagePolicy: m.languagePolicy,
    fallbackLanguage: m.fallbackLanguage,
    attachments: m.attachments ?? undefined,
    draftContent: m.draftContent ?? undefined,
  };
}

// ── messages ─────────────────────────────────────────────────────────────────

// Draft normalization — the ONE storage representation: recognized raw
// {{tokens}} in body HTML become canonical chip nodes at save time (unknown
// tokens stay visible for flagging). Published versions are never rewritten;
// the renderer stays backward-compatible with historical raw tokens.
function normalizeDraftContent(draft) {
  const label = (key) => variableByKey(key)?.labelHe || null;
  const norm = (c) => (c ? { ...c, body: normalizeTokensToChips(c.body || '', label) } : c);
  return { ...draft, he: norm(draft.he), en: norm(draft.en) };
}

const MESSAGE_FIELDS = (b) => ({
  ...(b.internalName !== undefined ? { internalName: str(b.internalName) } : {}),
  ...(b.status !== undefined && ['draft', 'active', 'disabled'].includes(b.status) ? {} : {}),
  ...(b.audienceType !== undefined ? { audienceType: String(b.audienceType) } : {}),
  ...(b.audienceContactId !== undefined ? { audienceContactId: str(b.audienceContactId) } : {}),
  ...(b.audiencePersonRefId !== undefined ? { audiencePersonRefId: str(b.audiencePersonRefId) } : {}),
  ...(b.waAccountId !== undefined ? { waAccountId: str(b.waAccountId) } : {}),
  ...(b.waDestinationType !== undefined ? { waDestinationType: str(b.waDestinationType) } : {}),
  ...(b.waGroupChatId !== undefined ? { waGroupChatId: str(b.waGroupChatId) } : {}),
  ...(b.windowEnabled !== undefined ? { windowEnabled: !!b.windowEnabled } : {}),
  ...(b.sendingWindowId !== undefined ? { sendingWindowId: str(b.sendingWindowId) } : {}),
  ...(b.languagePolicy !== undefined && ['auto', 'he_only', 'en_only'].includes(b.languagePolicy) ? { languagePolicy: b.languagePolicy } : {}),
  ...(b.fallbackLanguage !== undefined && ['he', 'en'].includes(b.fallbackLanguage) ? { fallbackLanguage: b.fallbackLanguage } : {}),
  ...(b.attachments !== undefined ? { attachments: Array.isArray(b.attachments) ? b.attachments : [] } : {}),
  ...(b.draftContent !== undefined ? { draftContent: normalizeDraftContent(b.draftContent || {}) } : {}),
});

router.post('/events/:id/messages', handle(async (req, res) => {
  const event = await prisma.communicationEvent.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!event) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  if (!CHANNELS.includes(b.channel)) return res.status(400).json({ error: 'invalid_channel' });
  if (b.audienceType !== undefined && !AUDIENCE_TYPES.includes(b.audienceType)) {
    return res.status(400).json({ error: 'invalid_audience' });
  }
  const message = await prisma.communicationMessage.create({
    data: {
      eventId: event.id,
      channel: b.channel,
      status: 'draft',
      ...MESSAGE_FIELDS(b),
      createdById: req.adminAuth?.userId || null,
    },
  });
  res.status(201).json(message);
}));

router.put('/messages/:id', handle(async (req, res) => {
  const b = req.body || {};
  if (b.audienceType !== undefined && !AUDIENCE_TYPES.includes(b.audienceType)) {
    return res.status(400).json({ error: 'invalid_audience' });
  }
  if (b.waDestinationType !== undefined && b.waDestinationType != null && !['private', 'group'].includes(b.waDestinationType)) {
    return res.status(400).json({ error: 'invalid_destination' });
  }
  try {
    const message = await prisma.communicationMessage.update({
      where: { id: req.params.id },
      data: { ...MESSAGE_FIELDS(b), updatedById: req.adminAuth?.userId || null },
      include: { event: true },
    });
    res.json({
      ...message,
      languageState: languageState(message),
      validationErrors: await validateMessageForPublish(message, message.event),
      event: undefined,
    });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'not_found' });
    throw e;
  }
}));

// Publish: validate → freeze an immutable version → point live at it.
router.post('/messages/:id/publish', handle(async (req, res) => {
  const message = await prisma.communicationMessage.findUnique({
    where: { id: req.params.id },
    include: { event: true },
  });
  if (!message) return res.status(404).json({ error: 'not_found' });
  const errors = await validateMessageForPublish(message, message.event);
  if (errors.length) return res.status(422).json({ error: 'validation_failed', errors });

  const draft = message.draftContent || {};
  const updated = await prisma.$transaction(async (tx) => {
    const last = await tx.communicationMessageVersion.aggregate({
      where: { messageId: message.id }, _max: { versionNo: true },
    });
    const version = await tx.communicationMessageVersion.create({
      data: {
        messageId: message.id,
        versionNo: (last._max.versionNo || 0) + 1,
        content: {
          he: draft.he || null,
          en: draft.en || null,
          enState: draft.enState || null,
          attachments: message.attachments || [],
          channelConfig: {
            channel: message.channel,
            audienceType: message.audienceType,
            waAccountId: message.waAccountId,
            waDestinationType: message.waDestinationType,
            waGroupChatId: message.waGroupChatId,
            languagePolicy: message.languagePolicy,
            fallbackLanguage: message.fallbackLanguage,
            windowEnabled: message.windowEnabled,
            sendingWindowId: message.sendingWindowId,
          },
        },
        note: str(req.body?.note),
        createdById: req.adminAuth?.userId || null,
      },
    });
    return tx.communicationMessage.update({
      where: { id: message.id },
      data: { publishedVersionId: version.id, status: 'active', updatedById: req.adminAuth?.userId || null },
    });
  });
  res.json(updated);
}));

router.post('/messages/:id/disable', handle(async (req, res) => {
  const updated = await prisma.communicationMessage.update({
    where: { id: req.params.id },
    data: { status: 'disabled', updatedById: req.adminAuth?.userId || null },
  }).catch(() => null);
  if (!updated) return res.status(404).json({ error: 'not_found' });
  res.json(updated);
}));

router.post('/messages/:id/enable', handle(async (req, res) => {
  const message = await prisma.communicationMessage.findUnique({ where: { id: req.params.id } });
  if (!message) return res.status(404).json({ error: 'not_found' });
  if (!message.publishedVersionId) return res.status(422).json({ error: 'not_published' });
  const updated = await prisma.communicationMessage.update({
    where: { id: message.id },
    data: { status: 'active', updatedById: req.adminAuth?.userId || null },
  });
  res.json(updated);
}));

router.post('/messages/:id/duplicate', handle(async (req, res) => {
  const message = await prisma.communicationMessage.findUnique({ where: { id: req.params.id } });
  if (!message) return res.status(404).json({ error: 'not_found' });
  const copy = await prisma.communicationMessage.create({
    data: { ...duplicateMessageData(message, message.eventId), createdById: req.adminAuth?.userId || null },
  });
  res.status(201).json(copy);
}));

router.delete('/messages/:id', handle(async (req, res) => {
  // Deleting is allowed only for never-published drafts; anything live is
  // disabled/archived instead (history + delivery audit stay intact).
  const message = await prisma.communicationMessage.findUnique({ where: { id: req.params.id } });
  if (!message) return res.status(404).json({ error: 'not_found' });
  if (message.publishedVersionId) return res.status(422).json({ error: 'published_message_cannot_be_deleted' });
  await prisma.communicationMessage.delete({ where: { id: message.id } });
  res.json({ ok: true });
}));

router.get('/messages/:id/versions', handle(async (req, res) => {
  const versions = await prisma.communicationMessageVersion.findMany({
    where: { messageId: req.params.id },
    orderBy: { versionNo: 'desc' },
  });
  const message = await prisma.communicationMessage.findUnique({
    where: { id: req.params.id }, select: { publishedVersionId: true },
  });
  res.json(versions.map((v) => ({ ...v, isPublished: v.id === message?.publishedVersionId })));
}));

router.post('/messages/:id/restore', handle(async (req, res) => {
  const version = await prisma.communicationMessageVersion.findUnique({
    where: { id: String(req.body?.versionId || '') },
  });
  if (!version || version.messageId !== req.params.id) return res.status(404).json({ error: 'not_found' });
  const c = version.content || {};
  const updated = await prisma.communicationMessage.update({
    where: { id: req.params.id },
    data: {
      draftContent: { he: c.he || null, en: c.en || null, enState: c.enState || null },
      attachments: c.attachments ?? undefined,
      updatedById: req.adminAuth?.userId || null,
    },
  });
  res.json(updated);
}));

// ── AI translation (draft-only, never auto-published) ────────────────────────

router.post('/messages/:id/translate', handle(async (req, res) => {
  const message = await prisma.communicationMessage.findUnique({ where: { id: req.params.id } });
  if (!message) return res.status(404).json({ error: 'not_found' });
  const draft = message.draftContent || {};
  if (!String(draft.he?.body || '').trim()) return res.status(422).json({ error: 'hebrew_content_required' });
  try {
    const result = await translateContent({
      subject: draft.he?.subject || '',
      body: draft.he?.body || '',
      channel: message.channel,
      tone: str(req.body?.tone),
    });
    const updated = await prisma.communicationMessage.update({
      where: { id: message.id },
      data: {
        draftContent: {
          ...draft,
          en: { subject: result.subject, body: result.body },
          enState: 'ai_draft',
        },
        updatedById: req.adminAuth?.userId || null,
      },
    });
    res.json({ ...updated, languageState: languageState(updated) });
  } catch (err) {
    if (err.code === 'translation_not_configured') return res.status(422).json({ error: err.code });
    if (err.code === 'translation_tokens_changed') return res.status(422).json({ error: err.code, detail: err.detail });
    // 422 (not 502) — Cloudflare replaces 502/504 with its own HTML page and
    // the client would lose the structured error (project caching/CF rule).
    if (err.code === 'translation_failed') return res.status(422).json({ error: err.code, detail: err.detail });
    throw err;
  }
}));

// ── simulator / preview — ONE dry-run pipeline (prepare.js), two context
//    modes. NEVER creates a delivery, timeline entry or any business record.
//    mode 'real': read-only canonical context (the same loader real triggers
//    use). mode 'synthetic': user-entered test fields shaped into the same
//    context object, then the identical pipeline. `draftOverride` lets the
//    editor simulate unsaved content without persisting it.

async function simulateHandler(req, res) {
  const message = await prisma.communicationMessage.findUnique({
    where: { id: req.params.id }, include: { event: true, sendingWindow: true },
  });
  if (!message) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  const mode = b.mode === 'synthetic' ? 'synthetic' : 'real';

  let ctx;
  if (mode === 'synthetic') {
    ctx = buildSyntheticContext(b.fields || {});
  } else {
    const { dealId = null, sessionId = null } = b;
    if (!dealId && !sessionId) return res.status(400).json({ error: 'context_required' });
    ctx = await loadTriggerContext({ dealId, sessionId });
    if (dealId && !ctx.deal) return res.status(404).json({ error: 'deal_not_found' });
  }

  const draft = b.draftOverride && typeof b.draftOverride === 'object'
    ? normalizeDraftContent(b.draftOverride)
    : (message.draftContent || {});
  const result = await prepareMessageRun({
    message,
    event: message.event,
    versionContent: { ...draft, attachments: message.attachments || [] },
    ctx,
    language: b.language === 'en' || b.language === 'he' ? b.language : null,
    // Sample trigger payload (e.g. tour_datetime_changed prev/new values) so
    // change/action variables can be simulated through the same override path.
    triggerData: b.triggerData && typeof b.triggerData === 'object' ? b.triggerData : null,
  });
  res.json({ mode, ...result });
}

router.post('/messages/:id/simulate', handle(simulateHandler));
// Back-compat alias — the old preview endpoint rides the same dry-run service.
router.post('/messages/:id/preview', handle(simulateHandler));

// ── test send (explicit destination only; internal log, no timeline) ─────────

router.post('/messages/:id/test-send', handle(async (req, res) => {
  const message = await prisma.communicationMessage.findUnique({
    where: { id: req.params.id }, include: { event: true },
  });
  if (!message) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  const { dealId = null, sessionId = null } = b;
  const language = b.language === 'en' ? 'en' : 'he';

  // Context: synthetic simulator fields, a real read-only record, or none.
  // Either way the rendering path is the canonical one; only the DESTINATION
  // below is the explicit test destination.
  const ctx = b.synthetic && typeof b.synthetic === 'object'
    ? buildSyntheticContext(b.synthetic)
    : (dealId || sessionId) ? await loadTriggerContext({ dealId, sessionId }) : {};
  const rendered = await renderMessage({
    message,
    versionContent: { ...(message.draftContent || {}), attachments: message.attachments || [] },
    language,
    ctx,
  });
  if (rendered.error === 'no_content') return res.status(422).json({ error: 'no_content' });

  let destination = null;
  let status = 'sent';
  let error = null;
  try {
    if (message.channel === 'whatsapp') {
      const testAccountId = str(b.testAccountId) || message.waAccountId;
      if (!testAccountId) return res.status(400).json({ error: 'test_account_required' });
      const body = `🧪 *בדיקה — Communication Center*\n\n${rendered.body || ''}`;
      if (str(b.testGroupChatId)) {
        const chat = await prisma.whatsAppChat.findUnique({
          where: { id: b.testGroupChatId },
          select: { externalChatId: true, accountId: true, type: true, groupSubject: true },
        });
        if (!chat || chat.type !== 'group') return res.status(400).json({ error: 'test_group_invalid' });
        if (chat.accountId !== testAccountId) return res.status(400).json({ error: 'test_group_wrong_account' });
        destination = `group:${chat.groupSubject || chat.externalChatId}`;
        await callBridge(testAccountId, '/send', {
          method: 'POST', timeoutMs: 25_000,
          body: { jid: chat.externalChatId, text: body, idempotencyKey: `gos-commtest-${message.id}-${Date.now()}` },
        });
      } else if (str(b.testPhone)) {
        destination = `phone:${b.testPhone}`;
        await sendWhatsAppText(b.testPhone, body, {
          accountId: testAccountId,
          idempotencyKey: `gos-commtest-${message.id}-${Date.now()}`,
        });
      } else {
        return res.status(400).json({ error: 'test_destination_required' });
      }
      // Attach-mode documents are exercised too — the point of a test send.
      for (const doc of rendered.attachments || []) {
        const bytes = await loadDocumentBytes(doc);
        if (!bytes) continue;
        const jid = str(b.testGroupChatId)
          ? (await prisma.whatsAppChat.findUnique({ where: { id: b.testGroupChatId }, select: { externalChatId: true } }))?.externalChatId
          : phoneToJid(b.testPhone);
        if (!jid) continue;
        await callBridge(testAccountId, '/send-media', {
          method: 'POST', timeoutMs: 90_000,
          body: {
            jid, mediaBase64: bytes.buffer.toString('base64'), mimeType: bytes.mimeType,
            fileName: bytes.filename, kind: 'document',
            idempotencyKey: `gos-commtest-${message.id}-${Date.now()}-doc`,
          },
        });
      }
    } else {
      if (!str(b.testEmail)) return res.status(400).json({ error: 'test_destination_required' });
      destination = `email:${b.testEmail}`;
      const attachments = [];
      for (const doc of rendered.attachments || []) {
        const bytes = await loadDocumentBytes(doc);
        if (bytes) attachments.push({ filename: bytes.filename, mimeType: bytes.mimeType, contentBase64: bytes.buffer.toString('base64') });
      }
      await sendCrmEmail({
        to: b.testEmail,
        subject: `[בדיקה] ${rendered.subject || ''}`,
        bodyHtml: rendered.body || null,
        attachments: attachments.length ? attachments : null,
        // deliberately NOT linked to a deal/contact — a test is not customer history
      });
    }
  } catch (err) {
    status = 'failed';
    error = String(err?.code || err?.message || err).slice(0, 200);
  }

  await prisma.communicationTestSend.create({
    data: {
      messageId: message.id,
      channel: message.channel,
      destination: destination || 'unknown',
      language,
      status,
      error,
      createdById: req.adminAuth?.userId || null,
    },
  });
  // 422 (not 502) — see the Cloudflare note above: a 5xx here would surface as
  // Cloudflare's HTML error page instead of the structured failure reason.
  if (status === 'failed') return res.status(422).json({ error: 'test_send_failed', detail: error });
  res.json({ ok: true, destination });
}));

// ── explicit business actions that INVOKE the Communication Center ───────────

// "שלח הצעת מחיר" — the canonical explicit quote-send action. The Communication
// Center is the sending authority: this creates deliveries for every active
// published message on active quote_send events (the worker then performs the
// real sends; nothing is recorded as sent before a channel adapter succeeds).
// The named QuoteDocument is frozen onto the deliveries (triggerData override)
// so the exact immutable public link is what ships — never "whatever is
// latest", never a regenerated artifact. No configured event ⇒ an explicit
// admin-facing 422, never a silent fallback to hardcoded text.
router.post('/actions/send-quote', handle(async (req, res) => {
  const b = req.body || {};
  const dealId = str(b.dealId);
  const quoteDocumentId = str(b.quoteDocumentId);
  if (!dealId || !quoteDocumentId) return res.status(400).json({ error: 'deal_and_quote_required' });

  const doc = await prisma.quoteDocument.findUnique({
    where: { id: quoteDocumentId },
    select: { id: true, dealId: true, status: true, publicToken: true, versionNo: true, language: true, offerId: true },
  });
  if (!doc || doc.dealId !== dealId) return res.status(404).json({ error: 'quote_not_found' });
  if (doc.status === 'draft') return res.status(409).json({ error: 'quote_not_produced' });

  // Configured-event gate BEFORE firing — the admin must see the true state.
  const configured = await prisma.communicationEvent.count({
    where: {
      triggerType: 'quote_send',
      status: 'active',
      messages: { some: { status: 'active', publishedVersionId: { not: null } } },
    },
  });
  if (configured === 0) {
    return res.status(422).json({
      error: 'no_quote_send_event',
      message: 'לא מוגדר אירוע "שליחת הצעת מחיר" פעיל עם מסרים מפורסמים במרכז התקשורת',
    });
  }

  const initiatedAt = new Date().toISOString();
  const result = await processTrigger({
    type: 'quote_send',
    dealId,
    // A deliberate RE-SEND is a new business action — the trigger ref is
    // unique per invocation (idempotency still guards replays of the same
    // invocation via the created rows themselves).
    triggerRef: `${dealId}:${doc.id}:${Date.parse(initiatedAt)}`,
    data: {
      quoteDocumentId: doc.id,
      publicToken: doc.publicToken,
      versionNo: doc.versionNo,
      quoteLanguage: doc.language || null,
      initiatedByUserId: req.adminAuth?.userId || null,
      initiatedAt,
    },
  });

  // Invocation audit on the Deal (NOT a "sent" record — deliveries record the
  // actual sends only after the channel adapter succeeds).
  await emitTimelineEvent(prisma, {
    subjectType: 'deal',
    subjectId: dealId,
    kind: 'quote',
    data: {
      event: 'quote_send_invoked',
      via: 'communication_center',
      quoteDocumentId: doc.id,
      versionNo: doc.versionNo,
      publicToken: doc.publicToken,
      deliveriesCreated: result.created,
    },
    origin: await userOrigin(req.adminAuth?.userId),
  }).catch(() => {});

  res.json({ ok: true, created: result.created });
}));

// ── deliveries (log + admin actions) ─────────────────────────────────────────

router.get('/deliveries', handle(async (req, res) => {
  const { page, pageSize, skip, take } = parseListQuery({ page: req.query.page || '1', pageSize: req.query.pageSize });
  const where = {};
  if (str(req.query.messageId)) where.messageId = req.query.messageId;
  if (str(req.query.eventId)) where.eventId = req.query.eventId;
  if (str(req.query.dealId)) where.dealId = req.query.dealId;
  if (str(req.query.status)) where.status = req.query.status;
  if (/^#?\d+$/.test(String(req.query.number || ''))) {
    where.messageNumber = Number(String(req.query.number).replace('#', ''));
  }
  const [total, rows] = await Promise.all([
    prisma.communicationDelivery.count({ where }),
    prisma.communicationDelivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip, take,
      include: {
        message: { select: { internalName: true, publicNumber: true } },
        event: { select: { internalName: true, triggerType: true } },
      },
    }),
  ]);
  // Deal orderNo lookups for display links.
  const dealIds = [...new Set(rows.map((r) => r.dealId).filter(Boolean))];
  const deals = dealIds.length
    ? await prisma.deal.findMany({ where: { id: { in: dealIds } }, select: { id: true, orderNo: true, title: true } })
    : [];
  const dealMap = new Map(deals.map((d) => [d.id, d]));
  res.json({
    rows: rows.map((r) => ({ ...r, deal: r.dealId ? dealMap.get(r.dealId) || null : null })),
    total, page, pageSize,
  });
}));

router.post('/deliveries/:id/cancel', handle(async (req, res) => {
  // Guarded updateMany — a delivery being sent right now returns a conflict
  // instead of pretending (the scheduledWorker race-safety convention).
  const updated = await prisma.communicationDelivery.updateMany({
    where: {
      id: req.params.id,
      status: { in: ['scheduled', 'waiting_window', 'waiting_dependency', 'failed'] },
    },
    data: { status: 'cancelled', cancelledAt: new Date(), waitReason: 'בוטל ידנית' },
  });
  if (updated.count === 0) return res.status(409).json({ error: 'not_cancellable' });
  res.json({ ok: true });
}));

// ── sending windows ("זמני שליחה") ────────────────────────────────────────────

function validateRules(rules) {
  if (!Array.isArray(rules)) return 'invalid_rules';
  for (const r of rules) {
    const days = Array.isArray(r.days) ? r.days : [];
    if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'invalid_rule_days';
    const s = parseHHMM(r.start);
    const e = parseHHMM(r.end);
    if (s == null || e == null || e <= s) return 'invalid_rule_times';
  }
  return null;
}

router.get('/windows', handle(async (_req, res) => {
  const [windows, exceptions] = await Promise.all([
    prisma.communicationSendingWindow.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { messages: true } } },
    }),
    prisma.communicationWindowException.findMany({ orderBy: { dateFrom: 'desc' } }),
  ]);
  res.json({ windows, exceptions });
}));

router.post('/windows', handle(async (req, res) => {
  const b = req.body || {};
  if (!String(b.name || '').trim()) return res.status(400).json({ error: 'name_required' });
  const err = validateRules(b.rules || []);
  if (err) return res.status(400).json({ error: err });
  const window = await prisma.communicationSendingWindow.create({
    data: {
      name: String(b.name).trim(),
      description: str(b.description),
      rules: b.rules || [],
      isDefault: !!b.isDefault,
      sortOrder: Number(b.sortOrder) || 0,
    },
  });
  res.status(201).json(window);
}));

router.put('/windows/:id', handle(async (req, res) => {
  const b = req.body || {};
  if (b.rules !== undefined) {
    const err = validateRules(b.rules);
    if (err) return res.status(400).json({ error: err });
  }
  const window = await prisma.communicationSendingWindow.update({
    where: { id: req.params.id },
    data: {
      ...(b.name !== undefined ? { name: String(b.name).trim() } : {}),
      ...(b.description !== undefined ? { description: str(b.description) } : {}),
      ...(b.rules !== undefined ? { rules: b.rules } : {}),
      ...(b.active !== undefined ? { active: !!b.active } : {}),
      ...(b.isDefault !== undefined ? { isDefault: !!b.isDefault } : {}),
      ...(b.sortOrder !== undefined ? { sortOrder: Number(b.sortOrder) || 0 } : {}),
    },
  }).catch(() => null);
  if (!window) return res.status(404).json({ error: 'not_found' });
  res.json(window);
}));

router.delete('/windows/:id', handle(async (req, res) => {
  const inUse = await prisma.communicationMessage.count({ where: { sendingWindowId: req.params.id } });
  if (inUse > 0) return res.status(422).json({ error: 'window_in_use', count: inUse });
  await prisma.communicationSendingWindow.delete({ where: { id: req.params.id } }).catch(() => null);
  res.json({ ok: true });
}));

router.post('/window-exceptions', handle(async (req, res) => {
  const b = req.body || {};
  if (!['block', 'allow'].includes(b.kind)) return res.status(400).json({ error: 'invalid_kind' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.dateFrom || ''))) return res.status(400).json({ error: 'invalid_date' });
  if (b.dateTo != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.dateTo))) return res.status(400).json({ error: 'invalid_date' });
  if (!String(b.label || '').trim()) return res.status(400).json({ error: 'label_required' });
  const exception = await prisma.communicationWindowException.create({
    data: {
      windowId: str(b.windowId),
      kind: b.kind,
      label: String(b.label).trim(),
      dateFrom: b.dateFrom,
      dateTo: str(b.dateTo),
      startTime: str(b.startTime),
      endTime: str(b.endTime),
    },
  });
  res.status(201).json(exception);
}));

router.put('/window-exceptions/:id', handle(async (req, res) => {
  const b = req.body || {};
  const exception = await prisma.communicationWindowException.update({
    where: { id: req.params.id },
    data: {
      ...(b.label !== undefined ? { label: String(b.label).trim() } : {}),
      ...(b.active !== undefined ? { active: !!b.active } : {}),
      ...(b.dateFrom !== undefined ? { dateFrom: String(b.dateFrom) } : {}),
      ...(b.dateTo !== undefined ? { dateTo: str(b.dateTo) } : {}),
      ...(b.startTime !== undefined ? { startTime: str(b.startTime) } : {}),
      ...(b.endTime !== undefined ? { endTime: str(b.endTime) } : {}),
      ...(b.windowId !== undefined ? { windowId: str(b.windowId) } : {}),
      ...(b.kind !== undefined && ['block', 'allow'].includes(b.kind) ? { kind: b.kind } : {}),
    },
  }).catch(() => null);
  if (!exception) return res.status(404).json({ error: 'not_found' });
  res.json(exception);
}));

router.delete('/window-exceptions/:id', handle(async (req, res) => {
  await prisma.communicationWindowException.delete({ where: { id: req.params.id } }).catch(() => null);
  res.json({ ok: true });
}));

// ── searchable-selector data ─────────────────────────────────────────────────

router.get('/wa-groups', handle(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const accountId = str(req.query.accountId);
  const rows = await prisma.whatsAppChat.findMany({
    where: {
      type: 'group',
      providerDeletedAt: null,
      hiddenAt: null,
      ...(accountId ? { accountId } : {}),
      ...(q ? { groupSubject: { contains: q, mode: 'insensitive' } } : {}),
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 30,
    select: {
      id: true, accountId: true, groupSubject: true, profilePictureUrl: true,
      lastMessageAt: true, externalChatId: true,
      account: { select: { label: true, status: true } },
    },
  });
  res.json(rows.map((c) => ({
    id: c.id,
    subject: c.groupSubject || 'קבוצה ללא שם',
    accountId: c.accountId,
    accountLabel: c.account?.label || c.accountId,
    accountStatus: c.account?.status || 'unknown',
    avatar: c.profilePictureUrl,
    lastMessageAt: c.lastMessageAt,
  })));
}));

router.get('/contacts-search', handle(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const { where } = await contactSearchWhere(q, phoneQuery(q), prisma, { includeLegacy: false });
  const rows = await prisma.contact.findMany({
    where,
    take: 20,
    include: { phones: { where: { isPrimary: true }, take: 1 }, emails: { where: { isPrimary: true }, take: 1 } },
    orderBy: [{ lastNameHe: 'asc' }, { firstNameHe: 'asc' }],
  });
  res.json(rows.map((c) => ({
    id: c.id,
    name: `${c.firstNameHe} ${c.lastNameHe}`.trim() || `${c.firstNameEn} ${c.lastNameEn}`.trim(),
    phone: c.phones[0]?.value || null,
    email: c.emails[0]?.value || null,
    contactNo: c.contactNo,
  })));
}));

router.get('/staff-search', handle(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = await prisma.personRef.findMany({
    where: {
      status: 'active',
      ...(q ? { displayName: { contains: q, mode: 'insensitive' } } : {}),
    },
    orderBy: { displayName: 'asc' },
    take: 30,
    select: { id: true, displayName: true, phone: true, email: true },
  });
  res.json(rows.map((p) => ({ id: p.id, name: p.displayName, phone: p.phone, email: p.email })));
}));

// deals search for preview/test context selection
router.get('/deals-search', handle(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const orderNo = /^\d+$/.test(q) && Number(q) <= 2147483647 ? Number(q) : null;
  const rows = await prisma.deal.findMany({
    where: {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        ...(orderNo != null ? [{ orderNo }] : []),
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: 15,
    select: { id: true, orderNo: true, title: true, status: true, activityType: true, tourDate: true },
  });
  res.json(rows);
}));

export default router;
