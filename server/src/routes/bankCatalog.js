import { createRequire } from 'node:module';
import { Router } from 'express';
import { handle } from '../asyncHandler.js';

// Israeli bank catalog — static bundled data (see israelBanks.json's _readme
// for the maintenance strategy). Public: bank codes/names are public
// knowledge, and both the admin UI and the token-gated guide portal consume
// the same list. /api is globally no-store, so an updated deploy is visible
// immediately.

const require = createRequire(import.meta.url);
const catalog = require('../catalog/israelBanks.json');

const router = Router();

router.get(
  '/',
  handle(async (_req, res) => {
    res.json({ banks: catalog.banks });
  }),
);

export default router;
