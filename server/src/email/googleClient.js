import crypto from 'node:crypto';
import { cryptoConfigured, decryptToken, encryptToken } from './tokenCrypto.js';

// Google OAuth 2.0 + Gmail REST, hand-rolled over global fetch — no googleapis
// SDK (same lean-dependency approach as the iCount port and the WhatsApp
// bridge client).
//
// Scope history (product decision, explicit): the module launched read-only
// (gmail.readonly + gmail.send) during the Make/Pipedrive transition. Now that
// GOS is the primary email workspace, the requested scope is gmail.modify —
// full read/write EXCEPT permanent deletion (delete stays out by design).
// Accounts connected under the old scopes keep syncing (their tokens stay
// valid) but Gmail-write actions are gated per-account until a re-consent
// reconnect grants gmail.modify (see accountHasModifyScope).

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

export const GMAIL_SCOPES = [
  'openid',
  'email',
  'profile',
  GMAIL_MODIFY_SCOPE,
  'https://www.googleapis.com/auth/gmail.send',
];

// Does THIS account's granted-scopes snapshot include gmail.modify? Accounts
// connected before the scope upgrade return false until reconnected.
export function accountHasModifyScope(account) {
  return String(account?.scopes || '').includes('gmail.modify');
}

export function emailIntegrationConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) && cryptoConfigured();
}

export function missingEmailConfig() {
  const missing = [];
  if (!process.env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (!cryptoConfigured()) missing.push('EMAIL_TOKEN_KEY');
  return missing;
}

export function buildAuthUrl({ redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    // offline + consent → Google returns a refresh_token (required; without
    // `prompt=consent` re-connecting an already-authorized account omits it).
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(form) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`google token endpoint ${res.status}: ${body.error || ''} ${body.error_description || ''}`.trim());
    err.status = res.status;
    err.code = body.error || 'token_error';
    throw err;
  }
  return body;
}

export function exchangeCode({ code, redirectUri }) {
  return tokenRequest({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
}

export function refreshAccessToken(refreshToken) {
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
}

// The id_token arrives directly from Google's token endpoint over TLS, so its
// payload can be trusted without signature verification (standard practice for
// the code-exchange response; we never accept id_tokens from elsewhere).
export function decodeIdToken(idToken) {
  try {
    const payload = String(idToken).split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// ── Signed OAuth `state` (CSRF guard on the callback) ────────────────────────
// HMAC over a nonce+timestamp with SESSION_SECRET — no server-side state store.

export function mintOAuthState() {
  const payload = `${Date.now()}.${crypto.randomBytes(8).toString('base64url')}`;
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyOAuthState(state, maxAgeMs = 15 * 60_000) {
  const parts = String(state || '').split('.');
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expect = crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(payload).digest('base64url');
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const ts = Number(parts[0]);
  return Number.isFinite(ts) && Date.now() - ts <= maxAgeMs;
}

// ── Fresh access token for an account (auto-refresh + persist) ───────────────

const EXPIRY_SLACK_MS = 2 * 60_000;

export async function getFreshAccessToken(client, account) {
  const notExpired =
    account.accessTokenEnc &&
    account.accessTokenExpiresAt &&
    new Date(account.accessTokenExpiresAt).getTime() - Date.now() > EXPIRY_SLACK_MS;
  if (notExpired) return decryptToken(account.accessTokenEnc);

  const refreshToken = decryptToken(account.refreshTokenEnc);
  if (!refreshToken) {
    const err = new Error('account has no refresh token (disconnected)');
    err.code = 'not_connected';
    throw err;
  }
  const fresh = await refreshAccessToken(refreshToken);
  const expiresAt = new Date(Date.now() + (Number(fresh.expires_in) || 3600) * 1000);
  await client.emailAccount.update({
    where: { id: account.id },
    data: { accessTokenEnc: encryptToken(fresh.access_token), accessTokenExpiresAt: expiresAt },
  });
  // Keep the in-memory row coherent for the caller's continued use.
  account.accessTokenEnc = encryptToken(fresh.access_token);
  account.accessTokenExpiresAt = expiresAt;
  return fresh.access_token;
}

// ── Gmail REST wrapper ────────────────────────────────────────────────────────
// One retry after a forced refresh on 401 (revocations surface as a thrown
// 'not_connected'/401 the worker turns into syncStatus='error').

export async function gmailFetch(client, account, path, { method = 'GET', query, body } = {}) {
  let token = await getFreshAccessToken(client, account);
  for (let attempt = 0; ; attempt += 1) {
    const url = new URL(`${GMAIL_BASE}${path}`);
    for (const [k, v] of Object.entries(query || {})) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, item);
      else url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt === 0) {
      // Force-refresh once (expiry clock skew / revoked access token).
      await client.emailAccount.update({
        where: { id: account.id },
        data: { accessTokenEnc: null, accessTokenExpiresAt: null },
      });
      account.accessTokenEnc = null;
      account.accessTokenExpiresAt = null;
      token = await getFreshAccessToken(client, account);
      continue;
    }
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`gmail ${method} ${path} → ${res.status}: ${payload?.error?.message || ''}`.trim());
      err.status = res.status;
      err.reason = payload?.error?.errors?.[0]?.reason || null;
      throw err;
    }
    return payload;
  }
}

export const gmail = {
  getProfile: (client, account) => gmailFetch(client, account, '/profile'),
  listMessages: (client, account, query) => gmailFetch(client, account, '/messages', { query }),
  getMessage: (client, account, id, format = 'full') =>
    gmailFetch(client, account, `/messages/${id}`, { query: { format } }),
  listHistory: (client, account, query) => gmailFetch(client, account, '/history', { query }),
  getAttachment: (client, account, messageId, attachmentId) =>
    gmailFetch(client, account, `/messages/${messageId}/attachments/${attachmentId}`),
  // Label writes (gmail.modify scope). Thread-level = every message in the
  // conversation (Gmail's own archive/mark-read semantics).
  modifyThread: (client, account, gmailThreadId, { addLabelIds, removeLabelIds }) =>
    gmailFetch(client, account, `/threads/${gmailThreadId}/modify`, {
      method: 'POST',
      body: { ...(addLabelIds?.length ? { addLabelIds } : {}), ...(removeLabelIds?.length ? { removeLabelIds } : {}) },
    }),
  modifyMessage: (client, account, gmailMessageId, { addLabelIds, removeLabelIds }) =>
    gmailFetch(client, account, `/messages/${gmailMessageId}/modify`, {
      method: 'POST',
      body: { ...(addLabelIds?.length ? { addLabelIds } : {}), ...(removeLabelIds?.length ? { removeLabelIds } : {}) },
    }),
  sendRaw: (client, account, raw, threadId) =>
    gmailFetch(client, account, '/messages/send', {
      method: 'POST',
      body: threadId ? { raw, threadId } : { raw },
    }),
};
