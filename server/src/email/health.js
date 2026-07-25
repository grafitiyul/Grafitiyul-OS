import { prisma } from '../db.js';
import {
  gmail,
  accountHasCalendarScope,
  accountHasModifyScope,
  sanitizeAuthError,
  isInvalidGrant,
} from './googleClient.js';
import { gcal } from '../tours/calendar/googleCalendar.js';

// Read-only connection health check for the shared org Google account.
//
// Gmail AND the Calendar sync run off ONE refresh token, so this probes both
// sides and reports each independently. It NEVER sends mail or creates/edits
// calendar events — it only refreshes the access token and does a read probe
// (Gmail profile, Calendar events.list maxResults=1). Every failure is stored
// and returned as sanitized Hebrew; raw Google/Cloudflare bodies never leak.
//
// Clients are injectable (gmailClient/calClient/db) for tests.

// Parse the space-separated scope snapshot into a clean list for display.
export function parseScopes(scopes) {
  return String(scopes || '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Human-facing scope labels (business language, not raw URLs).
const SCOPE_LABELS = [
  { match: 'gmail.modify', label: 'קריאה וכתיבה ב-Gmail' },
  { match: 'gmail.send', label: 'שליחת מיילים' },
  { match: 'gmail.readonly', label: 'קריאת מיילים' },
  { match: 'calendar.events', label: 'ניהול אירועי יומן' },
];
export function describeScopes(scopes) {
  const list = parseScopes(scopes);
  const out = [];
  for (const { match, label } of SCOPE_LABELS) {
    if (list.some((s) => s.includes(match))) out.push(label);
  }
  return out;
}

// Run the read-only probes and persist the verdict. Returns a sanitized DTO
// (safe to send to the admin UI). deps let tests inject fakes.
export async function runHealthCheck(account, deps = {}) {
  const db = deps.db || prisma;
  const gmailClient = deps.gmail || gmail;
  const calClient = deps.gcal || gcal;

  const result = {
    accountId: account.id,
    emailAddress: account.emailAddress,
    gmail: { ok: false, error: null },
    calendar: { ok: false, error: null, scopeGranted: accountHasCalendarScope(account) },
    hasModifyScope: accountHasModifyScope(account),
    needsReconnect: false,
  };

  if (!account.refreshTokenEnc) {
    const err = { code: 'not_connected' };
    result.gmail.error = sanitizeAuthError(err);
    result.calendar.error = result.calendar.scopeGranted ? sanitizeAuthError(err) : null;
    result.needsReconnect = true;
    result.healthState = 'disconnected';
    await db.emailAccount.update({
      where: { id: account.id },
      data: { healthState: 'disconnected', lastAuthError: sanitizeAuthError(err), lastAuthErrorAt: new Date() },
    });
    return result;
  }

  const now = new Date();
  const patch = {};

  // ── Gmail probe ────────────────────────────────────────────────────────────
  try {
    const profile = await gmailClient.getProfile(db, account);
    result.gmail.ok = true;
    result.gmail.address = profile?.emailAddress || account.emailAddress;
    patch.lastGmailCheckAt = now;
  } catch (e) {
    result.gmail.error = sanitizeAuthError(e);
    if (isInvalidGrant(e)) result.needsReconnect = true;
  }

  // ── Calendar probe (only if the scope was granted) ──────────────────────────
  if (result.calendar.scopeGranted) {
    try {
      const meta = await calClient.probe(db, account);
      result.calendar.ok = true;
      result.calendar.timeZone = meta?.timeZone || null;
      patch.lastCalendarCheckAt = now;
    } catch (e) {
      result.calendar.error = sanitizeAuthError(e);
      if (isInvalidGrant(e)) result.needsReconnect = true;
    }
  } else {
    result.calendar.error = 'לחשבון אין הרשאת יומן — יש להתחבר מחדש כדי להפעיל סנכרון יומן';
  }

  // ── Persist an authoritative healthState ────────────────────────────────────
  // reconnect_required wins (a dead token breaks everything); else connected if
  // Gmail is reachable; else a transient error (token fine, provider hiccup).
  let healthState;
  if (result.needsReconnect) {
    healthState = 'reconnect_required';
    patch.lastAuthError = 'ההרשאה ב-Google בוטלה או פגה — יש להתחבר מחדש';
    patch.lastAuthErrorAt = now;
  } else if (result.gmail.ok) {
    healthState = 'connected';
    patch.lastAuthError = null;
    patch.lastAuthErrorAt = null;
  } else {
    healthState = 'error';
    patch.lastAuthError = result.gmail.error;
    patch.lastAuthErrorAt = now;
  }
  patch.healthState = healthState;
  result.healthState = healthState;

  await db.emailAccount.update({ where: { id: account.id }, data: patch });
  return result;
}
