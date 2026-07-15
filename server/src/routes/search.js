// Global admin search. Mounted admin-only (requireAdminAuth) in index.js —
// this router carries no auth of its own, per the project's mount-site
// convention.

import { Router } from 'express';
import { handle } from '../asyncHandler.js';
import { search, CATEGORIES, DEFAULT_CATEGORY } from '../search/searchService.js';

const router = Router();

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
