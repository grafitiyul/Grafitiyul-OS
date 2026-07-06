import crypto from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// CRM Task Types (configuration, ordered) — the catalog behind the Deal task
// composer. Types are NOT hard-coded in the UI: the composer renders whatever
// active types exist here. Same shape as the other CRM settings catalogs
// (sortOrder + isActive + reorder + lazy default seed).
//
// A 'whatsapp' channel type drives the WhatsApp-task flow (message text + sender
// account + a linked scheduled message). Everything else is a plain task.

const router = Router();

// Seeded defaults (spec §3). isSystem protects them from deletion (they can
// still be renamed / re-iconed / deactivated / reordered).
const DEFAULT_TYPES = [
  { key: 'first_call', nameHe: 'שיחה ראשונית', icon: 'phone', defaultText: 'שיחה ראשונית' },
  { key: 'missed_call', nameHe: 'שיחה שלא נענתה', icon: 'phone-missed', defaultText: 'שיחה שלא נענתה' },
  { key: 'collection', nameHe: 'גבייה', icon: 'money', defaultText: 'גבייה' },
  { key: 'follow_up', nameHe: 'פולואפ', icon: 'refresh', defaultText: 'פולואפ' },
  {
    key: 'whatsapp',
    nameHe: 'ווטסאפ',
    icon: 'whatsapp',
    defaultText: 'ווטסאפ',
    channel: 'whatsapp',
    defaultTime: '10:00',
    requiresTime: true,
  },
];

const OFFSET_TYPES = ['today', 'tomorrow', 'days_from_now', 'none'];
const CHANNELS = ['none', 'whatsapp'];

function slugifyKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function ensureSeeded() {
  const count = await prisma.taskType.count();
  if (count > 0) return;
  await prisma.$transaction(
    DEFAULT_TYPES.map((t, i) =>
      prisma.taskType.create({ data: { ...t, isSystem: true, sortOrder: i } }),
    ),
  );
}

function cleanTimeOrNull(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : null;
}

// GET /api/task-types?activeOnly=1 — lazy-seeds defaults on first call.
router.get(
  '/',
  handle(async (req, res) => {
    await ensureSeeded();
    const where = req.query.activeOnly === '1' ? { isActive: true } : {};
    const types = await prisma.taskType.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { nameHe: 'asc' }],
    });
    res.json(types);
  }),
);

// Reorder — before '/:id'.
router.put(
  '/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x) => typeof x === 'string')
      : [];
    if (!ids.length) return res.json({ ok: true });
    await prisma.$transaction(
      ids.map((id, i) =>
        prisma.taskType.update({ where: { id }, data: { sortOrder: i } }),
      ),
    );
    res.json({ ok: true });
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const b = req.body || {};
    const nameHe = String(b.nameHe || '').trim();
    if (!nameHe) return res.status(400).json({ error: 'name_required' });
    const channel = CHANNELS.includes(b.channel) ? b.channel : 'none';
    const offsetType = OFFSET_TYPES.includes(b.defaultDueOffsetType)
      ? b.defaultDueOffsetType
      : 'today';
    const key =
      slugifyKey(b.key) || slugifyKey(nameHe) || `type_${crypto.randomBytes(4).toString('hex')}`;
    const last = await prisma.taskType.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    try {
      const created = await prisma.taskType.create({
        data: {
          key,
          nameHe,
          icon: String(b.icon || 'check').slice(0, 40),
          color: b.color ? String(b.color).slice(0, 40) : null,
          defaultText: b.defaultText != null ? String(b.defaultText).slice(0, 300) : null,
          defaultDueOffsetType: offsetType,
          defaultDueOffsetDays: Number(b.defaultDueOffsetDays) || 0,
          defaultTime: cleanTimeOrNull(b.defaultTime),
          requiresTime: !!b.requiresTime,
          channel,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
      });
      res.status(201).json(created);
    } catch (e) {
      if (e.code === 'P2002') return res.status(409).json({ error: 'key_exists' });
      throw e;
    }
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const b = req.body || {};
    const data = {};
    if (b.nameHe !== undefined) {
      const n = String(b.nameHe).trim();
      if (!n) return res.status(400).json({ error: 'name_required' });
      data.nameHe = n;
    }
    if (b.icon !== undefined) data.icon = String(b.icon || 'check').slice(0, 40);
    if (b.color !== undefined) data.color = b.color ? String(b.color).slice(0, 40) : null;
    if (b.defaultText !== undefined)
      data.defaultText = b.defaultText != null ? String(b.defaultText).slice(0, 300) : null;
    if (b.defaultDueOffsetType !== undefined) {
      if (!OFFSET_TYPES.includes(b.defaultDueOffsetType))
        return res.status(400).json({ error: 'invalid_offset_type' });
      data.defaultDueOffsetType = b.defaultDueOffsetType;
    }
    if (b.defaultDueOffsetDays !== undefined)
      data.defaultDueOffsetDays = Number(b.defaultDueOffsetDays) || 0;
    if (b.defaultTime !== undefined) data.defaultTime = cleanTimeOrNull(b.defaultTime);
    if (b.requiresTime !== undefined) data.requiresTime = !!b.requiresTime;
    if (b.channel !== undefined) {
      if (!CHANNELS.includes(b.channel)) return res.status(400).json({ error: 'invalid_channel' });
      data.channel = b.channel;
    }
    if (b.isActive !== undefined) data.isActive = !!b.isActive;
    if (b.sortOrder !== undefined) data.sortOrder = Number(b.sortOrder) || 0;
    const updated = await prisma.taskType.update({ where: { id: req.params.id }, data });
    res.json(updated);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    const t = await prisma.taskType.findUnique({
      where: { id: req.params.id },
      select: { id: true, isSystem: true },
    });
    if (!t) return res.status(404).json({ error: 'not_found' });
    // System defaults are protected — deactivate instead of deleting so existing
    // task history (Task.taskTypeId) never loses its type meaning.
    if (t.isSystem) return res.status(409).json({ error: 'system_type_protected' });
    try {
      await prisma.taskType.delete({ where: { id: t.id } });
      res.status(204).end();
    } catch (e) {
      // Task.taskTypeId is ON DELETE SET NULL, so this shouldn't 2003; keep the
      // guard for safety.
      if (e.code === 'P2003' || e.code === 'P2014')
        return res.status(409).json({ error: 'type_in_use' });
      throw e;
    }
  }),
);

export default router;
