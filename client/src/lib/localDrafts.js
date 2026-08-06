// THE local-draft storage engine — one implementation for every "unsaved text
// must survive navigation/refresh/browser restart" surface (note drafts,
// task drafts). A draft map lives under one localStorage key, entries keyed by
// subject (e.g. "deal:<id>"), capped so the map can never grow unbounded.
// Storage failures are silently non-fatal: drafts are a convenience layer,
// never a source of truth.
const CAP = 200;

export function readDraftMap(storageKey) {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || '{}') || {};
  } catch {
    return {};
  }
}

// value === null/undefined deletes the entry (an empty draft is not stored).
export function writeDraftEntry(storageKey, key, value) {
  try {
    const map = readDraftMap(storageKey);
    if (value === null || value === undefined) delete map[key];
    else map[key] = value;
    const keys = Object.keys(map);
    if (keys.length > CAP) for (const k of keys.slice(0, keys.length - CAP)) delete map[k];
    localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
