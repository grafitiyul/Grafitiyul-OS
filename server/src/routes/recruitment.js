import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { handle } from '../asyncHandler.js';

// Mock-backed recruitment source endpoints. Recruitment is source of truth
// for GUIDES and (eventually) TRAINING MATERIALS — it does NOT model
// teams. These endpoints are a read-only projection of the upstream data,
// consumed by the import endpoints on /api/people/import (and later, when
// training-material sync is wired, /api/training-materials/import).
//
// When live sync lands, the JSON-file load below is replaced by an HTTP
// call to the recruitment backend. The shape contract stays the same, so
// no downstream code needs to change.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_PATH = path.resolve(__dirname, '../data/recruitment.mock.json');

async function readSnapshot() {
  const raw = await fs.readFile(MOCK_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  return {
    people: Array.isArray(parsed.people) ? parsed.people : [],
    trainingMaterials: Array.isArray(parsed.trainingMaterials)
      ? parsed.trainingMaterials
      : [],
  };
}

// Exported so import endpoints in people.js (and later training-materials)
// can reuse the same source without duplicating file-read logic.
export async function getRecruitmentSnapshot() {
  return readSnapshot();
}

const router = Router();

router.get(
  '/people',
  handle(async (_req, res) => {
    const snap = await readSnapshot();
    res.json(snap.people);
  }),
);

// Placeholder — training-material import UI is not built yet. Endpoint
// exists so the contract is discoverable once the feature lands.
router.get(
  '/training-materials',
  handle(async (_req, res) => {
    const snap = await readSnapshot();
    res.json(snap.trainingMaterials);
  }),
);

// Full snapshot — useful for the Import dialog to preview before pulling.
router.get(
  '/',
  handle(async (_req, res) => {
    res.json(await readSnapshot());
  }),
);

export default router;
