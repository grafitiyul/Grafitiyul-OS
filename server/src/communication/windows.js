// THE sending-window evaluator — pure core (unit-tested, injectable clock).
// All window times are ISRAEL LOCAL (Asia/Jerusalem); this module owns the
// DST-correct instant↔local mapping using the israelDate probing technique
// (no tz library).
//
// Precedence — deterministic, by design (documented product decision):
//   1. An active BLOCK exception matching the moment (global, or scoped to the
//      message's window) always wins — safety (Yom Kippur / closed dates)
//      defeats everything, including allow overrides.
//   2. A message NOT subject to a window sends at its computed time — only
//      global block exceptions can stop it.
//   3. An active ALLOW exception matching the moment (global or
//      window-scoped) permits sending outside the weekly rules.
//   4. Otherwise the window's weekly rules decide.
//
// A waiting delivery keeps its original intendedAt and gets effectiveAt =
// nextAllowedAt(...); the worker re-evaluates before every send, so exception
// edits made while a delivery waits are honored.

import { ISRAEL_TZ } from '../lib/israelDate.js';

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: ISRAEL_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Israel-local parts of a UTC instant: { date:"YYYY-MM-DD", weekday:0-6 (0=Sun), minutes }. */
export function israelParts(ms) {
  const parts = {};
  for (const p of partsFmt.formatToParts(new Date(ms))) parts[p.type] = p.value;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    date,
    weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/**
 * Israel local (dateStr, minuteOfDay) → UTC ms. DST-correct by probing the
 * two possible offsets (UTC+2 / UTC+3) and keeping the one that round-trips.
 * During the (non-existent) spring-forward hour, resolves to the closest
 * following real instant.
 */
export function israelLocalToMs(dateStr, minuteOfDay) {
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const mm = String(minuteOfDay % 60).padStart(2, '0');
  const asUtc = Date.parse(`${dateStr}T${hh}:${mm}:00Z`);
  for (const offsetH of [2, 3]) {
    const candidate = asUtc - offsetH * 3_600_000;
    const p = israelParts(candidate);
    if (p.date === dateStr && p.minutes === minuteOfDay) return candidate;
  }
  // Spring-forward gap — the +3 candidate lands after the jump; use it.
  return asUtc - 3 * 3_600_000;
}

export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? ''));
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 24 * 60 ? v : null;
}

// ── exceptions ───────────────────────────────────────────────────────────────

function exceptionMatches(exc, parts) {
  if (!exc || exc.active === false) return false;
  const from = exc.dateFrom;
  const to = exc.dateTo || exc.dateFrom;
  if (!from || parts.date < from || parts.date > to) return false;
  const start = exc.startTime ? parseHHMM(exc.startTime) : null;
  const end = exc.endTime ? parseHHMM(exc.endTime) : null;
  if (start != null && parts.minutes < start) return false;
  if (end != null && parts.minutes >= end) return false;
  return true;
}

// Exceptions relevant to a message: global (windowId null) always; window-
// scoped only when the message uses that window.
function relevantExceptions(exceptions, windowId) {
  return (exceptions || []).filter(
    (e) => e.windowId == null || (windowId != null && e.windowId === windowId),
  );
}

// ── weekly rules ─────────────────────────────────────────────────────────────

function ruleAllowsAt(rules, parts) {
  for (const rule of rules || []) {
    const days = Array.isArray(rule.days) ? rule.days : [];
    if (!days.includes(parts.weekday)) continue;
    const start = parseHHMM(rule.start);
    const end = parseHHMM(rule.end);
    if (start == null || end == null) continue;
    if (parts.minutes >= start && parts.minutes < end) return true;
  }
  return false;
}

// ── the evaluator ────────────────────────────────────────────────────────────

/**
 * Is sending allowed at `atMs` for this message policy?
 * policy: { windowEnabled, window: {id, rules} | null, exceptions: [...] }.
 * Returns { allowed, reason } — reason is a human-facing Hebrew explanation
 * when blocked/waiting ("which rule won").
 */
export function evaluateAt(policy, atMs) {
  const parts = israelParts(atMs);
  const windowId = policy.windowEnabled ? (policy.window?.id ?? null) : null;
  const excs = relevantExceptions(policy.exceptions, windowId);

  const block = excs.find((e) => e.kind === 'block' && exceptionMatches(e, parts));
  if (block) return { allowed: false, reason: `חסימה מפורשת: ${block.label}` };

  if (!policy.windowEnabled) return { allowed: true, reason: null };
  if (!policy.window) {
    // Windowed but no window selected — configuration error; fail closed.
    return { allowed: false, reason: 'לא נבחר חלון שליחה' };
  }

  const allow = excs.find((e) => e.kind === 'allow' && exceptionMatches(e, parts));
  if (allow) return { allowed: true, reason: `אושר חריגה: ${allow.label}` };

  if (ruleAllowsAt(policy.window.rules, parts)) return { allowed: true, reason: null };
  return { allowed: false, reason: `מחוץ לחלון השליחה "${policy.window.name || ''}"` };
}

const SCAN_DAYS = 62; // config errors surface as waiting_window with a reason,
                      // never an unbounded scan.

/**
 * The next instant ≥ fromMs at which evaluateAt(...) allows sending, or null
 * when none exists within the scan horizon. Minute resolution.
 */
export function nextAllowedAt(policy, fromMs) {
  if (evaluateAt(policy, fromMs).allowed) return fromMs;
  const startParts = israelParts(fromMs);
  for (let d = 0; d < SCAN_DAYS; d++) {
    // Walk each Israel calendar day, collecting candidate opening minutes.
    const day = new Date(`${startParts.date}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + d);
    const dateStr = day.toISOString().slice(0, 10);
    const weekday = day.getUTCDay();
    const startMinute = d === 0 ? startParts.minutes : 0;

    const candidates = new Set();
    if (policy.windowEnabled && policy.window) {
      for (const rule of policy.window.rules || []) {
        const days = Array.isArray(rule.days) ? rule.days : [];
        if (!days.includes(weekday)) continue;
        const s = parseHHMM(rule.start);
        if (s != null) candidates.add(Math.max(s, startMinute));
      }
    }
    const windowId = policy.windowEnabled ? (policy.window?.id ?? null) : null;
    for (const exc of relevantExceptions(policy.exceptions, windowId)) {
      if (exc.kind !== 'allow' || exc.active === false) continue;
      if (dateStr < exc.dateFrom || dateStr > (exc.dateTo || exc.dateFrom)) continue;
      const s = exc.startTime ? parseHHMM(exc.startTime) : 0;
      if (s != null) candidates.add(Math.max(s, startMinute));
    }
    // Block-exception END minutes are also candidates (a block may lift
    // mid-open-window), for windowed AND unwindowed messages alike.
    for (const exc of relevantExceptions(policy.exceptions, windowId)) {
      if (exc.kind !== 'block' || exc.active === false) continue;
      if (dateStr < exc.dateFrom || dateStr > (exc.dateTo || exc.dateFrom)) continue;
      const e = exc.endTime ? parseHHMM(exc.endTime) : null;
      if (e != null) candidates.add(Math.max(e, startMinute));
    }
    if (!policy.windowEnabled) candidates.add(startMinute); // only blocks stop it

    for (const minute of [...candidates].sort((a, b) => a - b)) {
      if (minute >= 24 * 60) continue;
      const ms = israelLocalToMs(dateStr, minute);
      if (ms < fromMs) continue;
      if (evaluateAt(policy, ms).allowed) return ms;
    }
  }
  return null;
}

/** Load a message's full window policy from the DB (worker + preview share this). */
export async function loadWindowPolicy(client, message) {
  const window = message.windowEnabled && message.sendingWindowId
    ? await client.communicationSendingWindow.findUnique({ where: { id: message.sendingWindowId } })
    : null;
  const exceptions = await client.communicationWindowException.findMany({ where: { active: true } });
  return {
    windowEnabled: !!message.windowEnabled,
    window: window ? { id: window.id, name: window.name, rules: window.rules || [] } : null,
    exceptions,
  };
}
