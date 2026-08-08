// Active configuration + content-addressed snapshots.
//
// "Which rules were active when this historical answer was generated" must stay
// answerable forever, and configuration must be editable without rewriting
// history. Rather than three parallel version tables, the ACTIVE configuration
// (approved knowledge + playbook + style + capability modes + prompt version) is
// serialized deterministically, hashed, and frozen into one AgentConfigSnapshot.
//
// Same configuration → same hash → the existing row is reused. The table
// therefore grows only when an operator actually changes something, and every
// run carries one FK that reconstructs its exact governing rules.
//
// This is also what makes archive-instead-of-delete safe (§28): archiving a
// knowledge item removes it from FUTURE snapshots, while every historical
// snapshot keeps its own frozen copy.

import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { listCapabilities, clampMode } from './capabilities/registry.js';
import { PROMPT_VERSION } from './prompts/version.js';

export const SETTINGS_ID = 'singleton';

const DEFAULT_SETTINGS = Object.freeze({
  id: SETTINGS_ID,
  enabled: false,
  provider: 'anthropic',
  model: 'claude-opus-5',
  effort: 'medium',
  includeGroups: false,
  maxMessageAgeMinutes: 180,
  recentMessageCount: 20,
  maxRunsPerSweep: 10,
});

/** Read the singleton settings row, materializing defaults when absent. */
export async function loadSettings(db = prisma) {
  const row = await db.agentSettings.findUnique({ where: { id: SETTINGS_ID } });
  return row || { ...DEFAULT_SETTINGS, updatedAt: null, updatedById: null };
}

export async function saveSettings(patch, { db = prisma, actorId = null } = {}) {
  const data = {};
  if (typeof patch.enabled === 'boolean') data.enabled = patch.enabled;
  if (typeof patch.model === 'string' && patch.model.trim()) data.model = patch.model.trim();
  if (['low', 'medium', 'high', 'xhigh', 'max'].includes(patch.effort)) data.effort = patch.effort;
  if (typeof patch.includeGroups === 'boolean') data.includeGroups = patch.includeGroups;
  for (const [key, min, max] of [
    ['maxMessageAgeMinutes', 5, 10_080],
    ['recentMessageCount', 4, 60],
    ['maxRunsPerSweep', 1, 100],
  ]) {
    const v = Number(patch[key]);
    if (Number.isFinite(v)) data[key] = Math.min(max, Math.max(min, Math.round(v)));
  }
  data.updatedById = actorId;
  return db.agentSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { ...DEFAULT_SETTINGS, ...data },
    update: data,
  });
}

/**
 * The capability matrix as the operator sees it: every CODE definition, merged
 * with its stored mode, clamped to the code ceiling. Reading from the registry
 * (not the table) is what guarantees a stale row can never surface a capability
 * that no longer exists.
 */
export async function loadCapabilityMatrix(db = prisma) {
  const rows = await db.agentCapabilityState.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return listCapabilities().map((def) => {
    const stored = byKey.get(def.key) || null;
    const requested = stored?.mode || def.defaultMode;
    return {
      ...def,
      mode: clampMode(def.key, requested) || def.defaultMode,
      conditions: stored?.conditions || null,
      isConfigured: !!stored,
      updatedAt: stored?.updatedAt || null,
    };
  });
}

/** Map<key, {mode, conditions}> — the shape the authority resolver consumes. */
export async function loadStoredModes(db = prisma) {
  const matrix = await loadCapabilityMatrix(db);
  return new Map(matrix.map((c) => [c.key, { mode: c.mode, conditions: c.conditions }]));
}

/** Load everything the prompt is built from. Approved rows only. */
export async function loadActiveConfig(db = prisma) {
  const [knowledge, playbook, style, matrix] = await Promise.all([
    db.agentKnowledgeItem.findMany({
      where: { status: 'approved', archivedAt: null },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, title: true, body: true, category: true, language: true,
        scope: true, updatedAt: true,
      },
    }),
    db.agentPlaybookRule.findMany({
      where: { status: 'approved', archivedAt: null },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, title: true, whenText: true, thenText: true, category: true,
        language: true, scope: true, priority: true, updatedAt: true,
      },
    }),
    db.agentStyleProfile.findMany({
      where: { status: 'approved', archivedAt: null },
      orderBy: [{ language: 'asc' }, { audience: 'asc' }],
      select: {
        id: true, key: true, name: true, language: true, audience: true,
        rules: true, isDefault: true, updatedAt: true,
      },
    }),
    loadCapabilityMatrix(db),
  ]);
  return {
    knowledge,
    playbook,
    style,
    capabilities: matrix.map((c) => ({ key: c.key, mode: c.mode, conditions: c.conditions })),
    promptVersion: PROMPT_VERSION,
  };
}

// Deterministic serialization: key order is fixed by construction above and
// JSON.stringify preserves insertion order for plain objects, so an unchanged
// configuration always hashes identically. Dates are normalized to ISO so a
// Prisma Date instance and a replayed string agree.
function stableString(config) {
  return JSON.stringify(config, (_k, v) => (v instanceof Date ? v.toISOString() : v));
}

export function hashConfig(config) {
  return crypto.createHash('sha256').update(stableString(config)).digest('hex');
}

/**
 * Freeze the active configuration, reusing the identical existing snapshot.
 * Returns { id, hash, config }.
 */
export async function ensureConfigSnapshot(db = prisma) {
  const config = await loadActiveConfig(db);
  const hash = hashConfig(config);
  const existing = await db.agentConfigSnapshot.findUnique({
    where: { hash },
    select: { id: true, hash: true },
  });
  if (existing) return { ...existing, config };

  const itemCounts = {
    knowledge: config.knowledge.length,
    playbook: config.playbook.length,
    style: config.style.length,
  };
  try {
    const created = await db.agentConfigSnapshot.create({
      data: { hash, payload: config, itemCounts },
      select: { id: true, hash: true },
    });
    return { ...created, config };
  } catch (err) {
    // Lost the unique race against a concurrent run — the winner's row is
    // exactly what we wanted anyway.
    if (err?.code === 'P2002') {
      const row = await db.agentConfigSnapshot.findUnique({
        where: { hash }, select: { id: true, hash: true },
      });
      if (row) return { ...row, config };
    }
    throw err;
  }
}
