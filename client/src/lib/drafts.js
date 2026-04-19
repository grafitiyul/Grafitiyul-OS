// Draft persistence abstraction for unsaved edits in item editors (and
// anywhere else a user can lose in-progress work).
//
// V1 backend: localStorage. Async-by-construction so the backend can be
// swapped for a server-side store (POST/GET /api/drafts/...) without any
// caller change. Callers always await the promise returned by save/load/
// clear — they never read window.localStorage directly.
//
// Data shape (single row per draftKey):
//   {
//     draftKey:  'contentItem:<id>' | 'contentItem:new' | 'questionItem:<id>' | ...
//     data:      arbitrary JSON — whatever the editor wants to restore
//     savedAt:   ISO timestamp
//     baseSavedAt: server-side updatedAt at the time the editor was opened
//                  (used to detect "your draft is older than the server's
//                   saved copy — server wins" on a future migration)
//   }
//
// The `backend` indirection lets a future revision swap localStorage for a
// server endpoint without touching any editor. All public functions are
// async and side-effect-free on errors.

const STORAGE_PREFIX = 'gos.draft.v1.';
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — cull stale drafts on load.

// ── Backend interface ────────────────────────────────────────────────────────
//
// Implement this interface to swap backends. Contract:
//   save(key, value)   → Promise<void>
//   load(key)          → Promise<value | null>
//   clear(key)         → Promise<void>
//   list()             → Promise<Array<{ key, savedAt, data }>>  (optional; used by future recovery UI)

const localStorageBackend = {
  async save(key, value) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        STORAGE_PREFIX + key,
        JSON.stringify(value),
      );
    } catch {
      /* quota exceeded / private mode — drafts are best-effort */
    }
  },
  async load(key) {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Cull stale entries — prevents old drafts lingering forever.
      if (parsed?.savedAt) {
        const age = Date.now() - new Date(parsed.savedAt).getTime();
        if (age > DRAFT_TTL_MS) {
          window.localStorage.removeItem(STORAGE_PREFIX + key);
          return null;
        }
      }
      return parsed;
    } catch {
      return null;
    }
  },
  async clear(key) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(STORAGE_PREFIX + key);
    } catch {
      /* ignore */
    }
  },
  async list() {
    if (typeof window === 'undefined') return [];
    const out = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        out.push({
          key: key.slice(STORAGE_PREFIX.length),
          savedAt: parsed?.savedAt,
          data: parsed?.data,
        });
      } catch {
        /* skip */
      }
    }
    return out;
  },
};

let backend = localStorageBackend;

// Tests / future server backend can swap this. Keep the default behavior.
export function setDraftsBackend(nextBackend) {
  backend = nextBackend;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Save a draft. `baseSavedAt` is the server's updatedAt at the time the
 * editor was opened; passing it lets future backends detect staleness.
 */
export async function saveDraft(draftKey, data, baseSavedAt = null) {
  const payload = {
    draftKey,
    data,
    savedAt: new Date().toISOString(),
    baseSavedAt: baseSavedAt || null,
  };
  await backend.save(draftKey, payload);
}

/** Load a draft by key. Returns null if none / expired / parse error. */
export async function loadDraft(draftKey) {
  return backend.load(draftKey);
}

/** Clear a draft (typically after a successful server save). */
export async function clearDraft(draftKey) {
  await backend.clear(draftKey);
}

/** List all currently-held drafts — intended for a future recovery surface. */
export async function listDrafts() {
  return backend.list();
}

// ── Debounced writer — convenience for editors ──────────────────────────────

/**
 * Returns { save(data), flush(), cancel() } for debounced draft writes.
 * `wait` defaults to 600ms. Call save() from onChange; flush() before
 * navigation-critical actions if you want to guarantee the latest write.
 */
export function makeDebouncedDraftSaver(draftKey, baseSavedAt = null, wait = 600) {
  let timer = null;
  let pending = null;
  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending == null) return;
    const data = pending;
    pending = null;
    await saveDraft(draftKey, data, baseSavedAt);
  };
  return {
    save(data) {
      pending = data;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, wait);
    },
    flush,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

// ── Key helpers (kept centralised so tests / future backends agree) ─────────

export const draftKeys = {
  contentItem: (id) => `contentItem:${id || 'new'}`,
  questionItem: (id) => `questionItem:${id || 'new'}`,
};
