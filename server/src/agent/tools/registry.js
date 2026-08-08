// THE agent tool registry — actions the agent may eventually PROPOSE.
//
// The invariant this file exists to enforce: THE AI NEVER WRITES TO PRISMA.
// A tool is a thin, audited wrapper that invokes a CANONICAL APPLICATION
// SERVICE — the same function the admin UI calls. Reproducing a service's
// implementation here would create a second writer with its own bugs and its
// own validation gaps, which is exactly what the project rules forbid.
//
// Every tool declares:
//   key            stable machine key, stored on proposals
//   labelHe        what the operator calls it
//   purposeHe      what it does, in one plain sentence
//   readWrite      'read' | 'write'
//   risk           'low' | 'medium' | 'high'
//   maxMode        code-level authority ceiling (same meaning as capabilities)
//   schema         JSON Schema for the input
//   preview(input, ctx) → { whatHappens, whatChanges } — shown BEFORE approval
//   invoke(input, ctx)  → executes via the canonical service; null = declared
//                         but not executable yet (an honest "not built", never
//                         a silent no-op)
//
// V1 wires exactly ONE write tool. The rest are declared so the permission
// architecture, the preview contract and the audit shape are proven by real
// usage rather than by a comment promising they would work.

import { prisma } from '../../db.js';
import { israelToday, addDays, startOfDayUtc } from '../../lib/israelDate.js';

const TOOLS = new Map();

function register(key, def) {
  if (TOOLS.has(key)) throw new Error(`agent tool already registered: ${key}`);
  if (!def.labelHe || !def.purposeHe) throw new Error(`agent tool ${key} is undocumented`);
  TOOLS.set(key, { key, invoke: null, ...def });
}

// ── The one wired write tool ────────────────────────────────────────────────

register('create_followup_task', {
  labelHe: 'פתיחת משימת מעקב',
  purposeHe: 'פותח משימה לצוות לחזור ללקוח — לא שולח שום דבר ללקוח.',
  readWrite: 'write',
  risk: 'low',
  maxMode: 'approval',
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short Hebrew task title.' },
      inDays: { type: 'integer', description: 'Days from today for the due date (0-30).' },
    },
    required: ['title', 'inDays'],
    additionalProperties: false,
  },
  preview(input, ctx) {
    const days = clampDays(input?.inDays);
    return {
      whatHappens: `תיפתח משימה חדשה: "${String(input?.title || '').slice(0, 120)}"`,
      whatChanges: [
        `משימה חדשה על דיל #${ctx?.dealOrderNo ?? '—'}`,
        `תאריך יעד: בעוד ${days} ימים`,
        'שום הודעה לא נשלחת ללקוח',
      ],
    };
  },
  async invoke(input, ctx, db = prisma) {
    if (!ctx?.dealId) return { ok: false, reason: 'no_deal' };
    const title = String(input?.title || '').trim().slice(0, 200);
    if (!title) return { ok: false, reason: 'empty_title' };

    // The canonical follow-up task type. No type → an honest skip, never an
    // invented type row: TaskType is operator-configured business vocabulary.
    const type = await db.taskType.findFirst({
      where: { key: 'follow_up', isActive: true },
      select: { id: true, nameHe: true },
    });
    if (!type) return { ok: false, reason: 'no_follow_up_type' };

    const owner = await resolveOwner(db, ctx.dealId);
    if (!owner) return { ok: false, reason: 'no_owner' };

    const dueDate = startOfDayUtc(addDays(israelToday(), clampDays(input?.inDays)));
    const task = await db.task.create({
      data: {
        dealId: ctx.dealId,
        taskTypeId: type.id,
        title,
        dueDate,
        status: 'open',
        ownerUserId: owner,
        createdByUserId: ctx.actorId || null,
      },
      select: { id: true },
    });
    return { ok: true, taskId: task.id };
  },
});

// ── Declared, deliberately NOT executable in V1 ─────────────────────────────
// Present so the authority matrix, the preview contract and the operator's
// mental model are complete. `invoke: null` makes an attempt fail loudly with
// `tool_not_implemented` rather than appearing to work.

register('send_payment_link', {
  labelHe: 'שליחת קישור תשלום',
  purposeHe: 'שולח ללקוח קישור תשלום אישי.',
  readWrite: 'write',
  risk: 'high',
  maxMode: 'approval',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  preview: () => ({
    whatHappens: 'יישלח ללקוח קישור תשלום אישי',
    whatChanges: ['הודעת ווטסאפ יוצאת ללקוח', 'קישור התשלום של הדיל ננעל לשימוש'],
  }),
});

register('send_quote', {
  labelHe: 'שליחת הצעת מחיר',
  purposeHe: 'שולח ללקוח את הצעת המחיר האחרונה שהופקה.',
  readWrite: 'write',
  risk: 'high',
  maxMode: 'approval',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  preview: () => ({
    whatHappens: 'תישלח ללקוח הצעת המחיר האחרונה שהופקה',
    whatChanges: ['הודעת ווטסאפ יוצאת ללקוח', 'ההצעה נרשמת כנשלחה'],
  }),
});

register('update_participants', {
  labelHe: 'עדכון מספר משתתפים',
  purposeHe: 'מעדכן את מספר המשתתפים בדיל.',
  readWrite: 'write',
  risk: 'high',
  maxMode: 'approval',
  schema: {
    type: 'object',
    properties: { participants: { type: 'integer' } },
    required: ['participants'],
    additionalProperties: false,
  },
  preview: (input) => ({
    whatHappens: `מספר המשתתפים יעודכן ל-${input?.participants ?? '?'}`,
    whatChanges: ['נתוני הדיל', 'עלול להשפיע על תמחור ועל שיבוץ מדריכים'],
  }),
});

// ── helpers ─────────────────────────────────────────────────────────────────

function clampDays(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 2;
  return Math.min(30, Math.max(0, Math.round(n)));
}

async function resolveOwner(db, dealId) {
  const deal = await db.deal.findUnique({ where: { id: dealId }, select: { ownerUserId: true } });
  if (deal?.ownerUserId) {
    const owner = await db.adminUser.findUnique({
      where: { id: deal.ownerUserId }, select: { id: true, isActive: true },
    });
    if (owner?.isActive) return owner.id;
  }
  const fallback = await db.adminUser.findFirst({
    where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true },
  });
  return fallback?.id || null;
}

// ── read API ────────────────────────────────────────────────────────────────

export function toolDef(key) {
  return TOOLS.get(key) || null;
}

export function listTools() {
  return [...TOOLS.values()].map(({ invoke, preview, ...rest }) => ({
    ...rest,
    implemented: typeof invoke === 'function',
  }));
}

export function isKnownTool(key) {
  return TOOLS.has(key);
}

/** Operator-readable preview of a proposed action, built before any approval. */
export function previewAction(key, input, ctx) {
  const def = TOOLS.get(key);
  if (!def) return null;
  let body = { whatHappens: def.purposeHe, whatChanges: [] };
  try {
    if (typeof def.preview === 'function') body = def.preview(input, ctx) || body;
  } catch { /* a broken preview must never hide the action */ }
  return {
    toolKey: key,
    labelHe: def.labelHe,
    risk: def.risk,
    readWrite: def.readWrite,
    implemented: typeof def.invoke === 'function',
    ...body,
  };
}

/**
 * Execute a tool. Called ONLY from an explicit, authenticated operator approval
 * — never from the runner, and never from the model.
 */
export async function invokeTool(key, input, ctx, db = prisma) {
  const def = TOOLS.get(key);
  if (!def) return { ok: false, reason: 'unknown_tool' };
  if (typeof def.invoke !== 'function') return { ok: false, reason: 'tool_not_implemented' };
  try {
    return await def.invoke(input, ctx, db);
  } catch (err) {
    return { ok: false, reason: 'tool_failed', detail: String(err?.message || err).slice(0, 300) };
  }
}
