// Admin authentication.
//
// Single-user, env-driven login. The point isn't multi-tenant SaaS auth —
// it's "keep the admin UI behind a credential gate" without dragging in a
// session store, JWT library, or DB migrations. The shape is:
//
//   * Credentials live in env vars (ADMIN_USERNAME, ADMIN_PASSWORD).
//   * On successful POST /api/auth/login, we set an HMAC-signed cookie:
//
//       gos_admin_session = <expiresAt>.<userId>.<base64url-HMAC>
//
//     The signature covers `<expiresAt>.<userId>` and is verified on
//     every request via SESSION_SECRET. No server-side state — restart
//     the process and existing sessions remain valid until expiry. The
//     userId is currently always 'admin'; the field is reserved for a
//     future multi-user model.
//   * Cookie flags: HttpOnly (no JS access), SameSite=Lax (CSRF safe
//     for top-level navigation; the admin UI doesn't use cross-site
//     POSTs), Secure when NODE_ENV=production (HTTPS-only at Railway).
//   * No dotenv-fallback magic for credentials. If env vars are
//     missing, login is hard-disabled — the route returns 500 with a
//     clear message rather than silently letting anyone in.

import crypto from 'node:crypto';

export const SESSION_COOKIE = 'gos_admin_session';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) return null;
  return s;
}

function getCredentials() {
  const u = process.env.ADMIN_USERNAME;
  const p = process.env.ADMIN_PASSWORD;
  if (!u || !p) return null;
  return { username: u, password: p };
}

function hmac(value, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(value)
    .digest('base64url');
}

function constantTimeEqual(a, b) {
  // Length-aware constant-time comparison. Returning early on length
  // mismatch is fine — the lengths themselves are not secret in our
  // scenario (HMAC outputs are fixed-length, env-string lengths are
  // also not sensitive).
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ── Cookie shape ──────────────────────────────────────────────────
//
// `<expiresAtSeconds>.<userId>.<signature>`
//
// expiresAtSeconds — Unix seconds. Server compares to current time.
// userId           — ASCII identifier (currently always 'admin').
// signature        — HMAC-SHA256 of `<expiresAtSeconds>.<userId>`.
function buildToken(userId, ttlSeconds, secret) {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${expiresAt}.${userId}`;
  const sig = hmac(payload, secret);
  return `${payload}.${sig}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [expStr, userId, sig] = parts;
  const expected = hmac(`${expStr}.${userId}`, secret);
  if (!constantTimeEqual(sig, expected)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return null;
  if (exp < Math.floor(Date.now() / 1000)) return null;
  return { userId };
}

// Tiny cookie parser — no extra dep. Express doesn't ship one in v4
// without `cookie-parser`, but we only need to read ONE cookie value.
function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;
  // Cookie header format: `a=1; b=2; c=3`
  const parts = header.split(';');
  for (const raw of parts) {
    const trimmed = raw.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq);
    if (k !== name) continue;
    const v = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  return null;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${DEFAULT_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

// Attach req.adminAuth = { userId } | null on every request. Kept
// separate from the gate so login/status endpoints can inspect it
// without first failing the gate.
export function attachAuth(req, _res, next) {
  const secret = getSecret();
  if (!secret) {
    req.adminAuth = null;
    return next();
  }
  const token = readCookie(req, SESSION_COOKIE);
  req.adminAuth = verifyToken(token, secret);
  next();
}

// Gate middleware — requires a valid session. JSON-only response so
// the SPA can branch on 401 without parsing HTML.
export function requireAdminAuth(req, res, next) {
  if (req.adminAuth?.userId) return next();
  res.status(401).json({ error: 'unauthorized' });
}

// ── Routes ────────────────────────────────────────────────────────
//
// Mounted at /api/auth/* in index.js.
//
//   POST   /login    { username, password } → 200 { authenticated, username }
//   POST   /logout                          → 204
//   GET    /status                          → 200 { authenticated, username? }
//
// Login deliberately does NOT distinguish "wrong username" from "wrong
// password" in its error string — both return the same 401 message.
export function buildAuthRoutes(express) {
  const router = express.Router();

  router.post('/login', (req, res) => {
    const secret = getSecret();
    const creds = getCredentials();
    if (!secret) {
      return res.status(500).json({
        error: 'auth_misconfigured',
        message: 'SESSION_SECRET is not configured on the server.',
      });
    }
    if (!creds) {
      return res.status(500).json({
        error: 'auth_misconfigured',
        message:
          'ADMIN_USERNAME / ADMIN_PASSWORD are not configured on the server.',
      });
    }
    const username = String(req.body?.username || '');
    const password = String(req.body?.password || '');
    const okU = constantTimeEqual(username, creds.username);
    const okP = constantTimeEqual(password, creds.password);
    if (!okU || !okP) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const token = buildToken('admin', DEFAULT_TTL_SECONDS, secret);
    setSessionCookie(res, token);
    res.json({ authenticated: true, username: creds.username });
  });

  router.post('/logout', (_req, res) => {
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.get('/status', (req, res) => {
    const creds = getCredentials();
    if (req.adminAuth?.userId) {
      return res.json({
        authenticated: true,
        username: creds?.username || req.adminAuth.userId,
        configured: !!creds && !!getSecret(),
      });
    }
    res.json({
      authenticated: false,
      configured: !!creds && !!getSecret(),
    });
  });

  return router;
}
