import { useCallback, useEffect, useState } from 'react';

// UI MODE for the Deal workspace — how the operator has arranged their tools,
// as distinct from anything about a Deal.
//
// The problem: the record drawer renders <DealDetail key={dealId}>, so pressing
// Next fully REMOUNTS the workspace. That is deliberate (a new record must not
// inherit the previous one's loaded data), but it also reset every local UI
// flag: an operator working a task queue with the WhatsApp panel open had to
// reopen it on every single deal.
//
// The rule this encodes:
//
//   UI MODE follows the operator.   DEAL DATA follows the deal.
//
// So a mode is keyed by the MODE, never by the record — "the WhatsApp panel is
// open" is one fact about how this person is working, not a fact about deal
// #27431. Anything deal-specific (drafts, unsaved fields, loaded rows) stays
// keyed to its deal and is untouched by this module: WhatsApp composer drafts,
// for instance, live under `accountId:chatId` in drafts.js and cannot follow a
// navigation even in principle.
//
// Scope is the TAB (sessionStorage): it survives the remount and a same-tab
// reload, which is what "carry my layout forward while I work" means, and it
// does not silently redecorate every future session from one click last week.
// (Sizes that the operator drags deliberately — the dock width — keep their own
// global localStorage preference; that is a setting, not a mode.)

const PREFIX = 'gos-workspace-mode:';

// In-memory mirror so a remount reads the current value synchronously, and so
// the modes still work when storage is unavailable (private mode, quota).
const cache = new Map();
const listeners = new Map(); // key -> Set<fn>

function read(key, fallback) {
  if (cache.has(key)) return cache.get(key);
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw != null) {
      const value = JSON.parse(raw);
      cache.set(key, value);
      return value;
    }
  } catch {
    /* storage unavailable — the in-memory mirror still carries the mode */
  }
  return fallback;
}

export function getViewMode(key, fallback = false) {
  return read(key, fallback);
}

export function setViewMode(key, value) {
  if (cache.get(key) === value) return;
  cache.set(key, value);
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* non-fatal */
  }
  for (const fn of listeners.get(key) || []) fn(value);
}

/** For tests: forget every remembered mode. */
export function resetViewModes() {
  cache.clear();
  try {
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith(PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    /* non-fatal */
  }
}

/**
 * useState, except the value outlives the component.
 * Drop-in for a `useState` that was resetting on every drawer navigation.
 */
export function useViewMode(key, fallback = false) {
  const [value, setLocal] = useState(() => read(key, fallback));

  useEffect(() => {
    // Two workspaces can be mounted at once (a page behind an open drawer);
    // both must agree about the mode.
    const set = listeners.get(key) || new Set();
    set.add(setLocal);
    listeners.set(key, set);
    setLocal(read(key, fallback));
    return () => {
      set.delete(setLocal);
      if (set.size === 0) listeners.delete(key);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = useCallback(
    (next) => setViewMode(key, typeof next === 'function' ? next(read(key, fallback)) : next),
    [key, fallback],
  );

  return [value, set];
}

// The modes the Deal workspace carries across record navigation. Named here so
// the set is reviewable in one place rather than spelled as loose strings.
export const VIEW_MODE = {
  // The Deal's internal WhatsApp panel (WhatsAppDock) — open or closed.
  whatsappDock: 'deal.whatsappDock',
  // Mobile: which tab of the Deal workspace is showing.
  dealMobileTab: 'deal.mobileTab',
};

// NOT here, on purpose:
//   * the workspace side panels (open/collapsed + widths) — WorkspaceLayout
//     already persists those under its own storageKey, so they survive the
//     remount without this module;
//   * the dock's WIDTH — a deliberate global preference, not a session mode;
//   * anything deal-specific: composer drafts (keyed accountId:chatId), unsaved
//     field edits, loaded rows. Those must never follow a navigation.
