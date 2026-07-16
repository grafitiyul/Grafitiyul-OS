// Saved Views + last-selected view — mounted admin-only (requireAdminAuth) in
// index.js, per the project's mount-site convention.
//
// THIN CALLER: every permission/validation rule lives in views/savedViewsCore.js
// (pure, unit-tested). This file owns only Prisma calls and HTTP translation.
//
// A view stores the CANONICAL filter object verbatim — the same shape the grid
// query, the counts endpoint and the URL speak — so chips remain the ONE
// time-navigation concept and a view simply remembers which chip was active.
// The '$me' sentinel inside filters.ownerIds is resolved CLIENT-side to the
// signed-in admin, which is what makes shared/system views like "השיחות שלי"
// portable across users; the server stores it opaquely.

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { SORTABLE_KEYS } from '../tasks/taskQuery.js';
import {
  validateViewInput, canEditView, viewsWhere, sortViews, VIEW_MODULES,
} from '../views/savedViewsCore.js';

const router = Router();

// ── Seeded system views (crm_tasks) ──────────────────────────────────────────
// Code-owned; visible to everyone, editable by nobody. Seeded once (count===0,
// same lazy pattern as taskTypes.js). typeKeys reference REAL seeded TaskType
// keys only — a view pointing at a nonexistent type would render an empty grid
// and read as a bug. (The wishlist's "תיאום סיורים" view is deliberately absent
// until such a type exists; adding a system view is one entry here.)
const baseFilters = {
  window: 'today', rangeFrom: null, rangeTo: null,
  typeKeys: [], ownerIds: [], priorities: [], stageIds: [], status: 'open',
};
const DEFAULT_SORT = [{ key: 'dueDate', dir: 'asc' }];
const SYSTEM_VIEWS = [
  { key: 'overdue', name: 'באיחור', icon: '🔴', sortOrder: 1, filters: { ...baseFilters, window: 'overdue' } },
  { key: 'today', name: 'היום', icon: '📅', sortOrder: 2, filters: { ...baseFilters } },
  { key: 'my_calls', name: 'השיחות שלי', icon: '📞', sortOrder: 3, filters: { ...baseFilters, typeKeys: ['first_call', 'missed_call'], ownerIds: ['$me'] } },
  { key: 'collection', name: 'גבייה', icon: '💰', sortOrder: 4, filters: { ...baseFilters, typeKeys: ['collection'] } },
  { key: 'high_priority', name: 'עדיפות גבוהה', icon: '🎯', sortOrder: 5, filters: { ...baseFilters, priorities: ['high'] } },
  { key: 'whatsapp_followup', name: 'מעקב WhatsApp', icon: '📱', sortOrder: 6, filters: { ...baseFilters, typeKeys: ['whatsapp'] } },
];

let seeded = false;
async function ensureSeeded() {
  if (seeded) return;
  const count = await prisma.savedView.count({ where: { module: 'crm_tasks', scope: 'system' } });
  if (count === 0) {
    await prisma.$transaction(
      SYSTEM_VIEWS.map((v) =>
        prisma.savedView.create({
          data: { module: 'crm_tasks', scope: 'system', ownerUserId: null, sort: DEFAULT_SORT, ...v },
        }),
      ),
    );
  }
  seeded = true;
}

function requireModule(req, res) {
  const module = String(req.query.module || req.body?.module || '');
  if (!VIEW_MODULES.includes(module)) {
    res.status(400).json({ error: 'invalid_module' });
    return null;
  }
  return module;
}

const lastViewKey = (module) => `${module}.lastView`;

function toClient(view, userId) {
  return {
    id: view.id,
    key: view.key,
    name: view.name,
    icon: view.icon,
    scope: view.scope,
    filters: view.filters,
    sort: view.sort,
    columns: view.columns,
    // Convenience only — the write routes enforce it regardless.
    editable: canEditView(view, userId),
  };
}

// GET /api/saved-views?module=crm_tasks → { views, lastSelectedId }
router.get(
  '/',
  handle(async (req, res) => {
    const module = requireModule(req, res);
    if (!module) return;
    await ensureSeeded();
    const userId = req.adminAuth?.userId || null;
    const [views, last] = await Promise.all([
      prisma.savedView.findMany({ where: viewsWhere(module, userId) }),
      userId
        ? prisma.userUiState.findUnique({ where: { userId_key: { userId, key: lastViewKey(module) } } })
        : null,
    ]);
    res.json({
      views: sortViews(views).map((v) => toClient(v, userId)),
      lastSelectedId: last?.value?.viewId ?? null,
    });
  }),
);

// POST /api/saved-views — create a personal or shared view.
router.post(
  '/',
  handle(async (req, res) => {
    const module = requireModule(req, res);
    if (!module) return;
    const userId = req.adminAuth?.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const v = validateViewInput(req.body, { sortableKeys: SORTABLE_KEYS });
    if (!v.ok) return res.status(400).json({ error: v.error });
    const view = await prisma.savedView.create({
      data: { module, ownerUserId: userId, ...v.data },
    });
    res.status(201).json(toClient(view, userId));
  }),
);

// PUT /api/saved-views/:id — owner-only; system views are immutable.
router.put(
  '/:id',
  handle(async (req, res) => {
    const userId = req.adminAuth?.userId;
    const view = await prisma.savedView.findUnique({ where: { id: req.params.id } });
    if (!view) return res.status(404).json({ error: 'not_found' });
    if (!canEditView(view, userId)) {
      return res.status(403).json({ error: view.scope === 'system' ? 'system_view_protected' : 'not_owner' });
    }
    const v = validateViewInput(req.body, { sortableKeys: SORTABLE_KEYS, partial: true });
    if (!v.ok) return res.status(400).json({ error: v.error });
    if (!Object.keys(v.data).length) return res.status(400).json({ error: 'nothing_to_update' });
    const updated = await prisma.savedView.update({ where: { id: view.id }, data: v.data });
    res.json(toClient(updated, userId));
  }),
);

// DELETE /api/saved-views/:id — owner-only; system views are immutable.
router.delete(
  '/:id',
  handle(async (req, res) => {
    const userId = req.adminAuth?.userId;
    const view = await prisma.savedView.findUnique({ where: { id: req.params.id } });
    if (!view) return res.status(404).json({ error: 'not_found' });
    if (!canEditView(view, userId)) {
      return res.status(403).json({ error: view.scope === 'system' ? 'system_view_protected' : 'not_owner' });
    }
    await prisma.savedView.delete({ where: { id: view.id } });
    res.json({ ok: true });
  }),
);

// PUT /api/saved-views/select/state — remember the user's last-selected view
// for a module, CROSS-DEVICE (which is exactly why this is server state and not
// localStorage). viewId null clears the selection. The path has TWO segments so
// the one-segment PUT /:id above can never shadow it, whatever the declaration
// order.
router.put(
  '/select/state',
  handle(async (req, res) => {
    const module = requireModule(req, res);
    if (!module) return;
    const userId = req.adminAuth?.userId;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const viewId = req.body?.viewId ? String(req.body.viewId) : null;
    if (viewId) {
      const view = await prisma.savedView.findUnique({ where: { id: viewId } });
      // Selecting a view you cannot see (someone else's personal view) is refused.
      if (!view || (view.scope === 'personal' && view.ownerUserId !== userId)) {
        return res.status(404).json({ error: 'not_found' });
      }
    }
    const key = lastViewKey(module);
    await prisma.userUiState.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, value: { viewId } },
      update: { value: { viewId } },
    });
    res.json({ ok: true, viewId });
  }),
);

export default router;
