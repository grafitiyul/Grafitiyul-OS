import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { handle } from '../asyncHandler.js';

// Mock-backed recruitment source endpoints. These stand in for the real
// recruitment system API until live sync is wired. The management system
// NEVER uses these endpoints as its write-side source of truth — they're
// read-only projections of the upstream data, consumed by the import
// endpoints on /api/teams/import and /api/people/import.
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
    teams: Array.isArray(parsed.teams) ? parsed.teams : [],
    people: Array.isArray(parsed.people) ? parsed.people : [],
  };
}

// Exported so the import endpoints in teams.js / people.js can reuse the
// same source without duplicating the file-read logic.
export async function getRecruitmentSnapshot() {
  return readSnapshot();
}

const router = Router();

router.get(
  '/teams',
  handle(async (_req, res) => {
    const snap = await readSnapshot();
    res.json(snap.teams);
  }),
);

router.get(
  '/people',
  handle(async (_req, res) => {
    const snap = await readSnapshot();
    res.json(snap.people);
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
