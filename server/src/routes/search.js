// Global admin search. Mounted admin-only (requireAdminAuth) in index.js —
// this router carries no auth of its own, per the project's mount-site
// convention.

import { Router } from 'express';
import { handle } from '../asyncHandler.js';
import { search, CATEGORIES, DEFAULT_CATEGORY } from '../search/searchService.js';
import { loadPeek, PEEK_TYPES } from '../search/peek.js';

const router = Router();

// Hover payload for a nested entity reference on a result row. A pure read —
// pointing at a name never opens, marks, links or writes anything.
router.get(
  '/peek',
  handle(async (req, res) => {
    const type = String(req.query.type ?? '');
    const id = String(req.query.id ?? '');
    if (!PEEK_TYPES.includes(type) || !id) return res.status(400).json({ error: 'bad_request' });
    const data = await loadPeek(type, id);
    if (!data) return res.status(404).json({ error: 'not_found' });
    res.set('Cache-Control', 'no-store');
    return res.json(data);
  }),
);

router.get(
  '/',
  handle(async (req, res) => {
    const q = String(req.query.q ?? '');
    const raw = String(req.query.category ?? DEFAULT_CATEGORY);
    const category = raw === 'all' || CATEGORIES.includes(raw) ? raw : DEFAULT_CATEGORY;

    const started = Date.now();
    const result = await search({ q, category });
    res.json({ ...result, tookMs: Date.now() - started });
  }),
);

export default router;
