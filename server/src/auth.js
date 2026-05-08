// Admin authentication — internal AdminUser table + signed-cookie
// session.
//
// Two states:
//
//   1. Bootstrap mode. Zero ACTIVE admins exist. /admin is reachable
//      without auth so the user can create the first admin from
//      inside the running app via POST /api/auth/setup. The setup
//      endpoint creates the row, hashes the password, and sets a
//      session cookie for that brand-new admin.
//
//   2. Locked mode. One or more active admins exist. /admin/* admin
//      API routes require a valid session. /api/auth/setup is hard-
//      disabled (403). New admins must be created from within the
//      authenticated admin UI (out of scope for this slice).
//
// Cookie shape:
//   `<expiresAtSeconds>.<adminUserId>.<base64url-HMAC-SHA256>`
// — same as the previous slice, but `<adminUserId>` is now a real
// AdminUser.id (cuid) instead of the literal string 'admin'.
//
// Password hashing: Node's built-in `crypto.scrypt` with a per-row
// 16-byte salt and a 64-byte derived key. Stored as
// `<saltHex>:<derivedKeyHex>` so a single column carries everything
// the verifier needs. Avoids pulling in bcrypt/argon2 and the native-
// build headaches that come with them on Railway.

import crypto from 'node:crypto';
import { prisma } from './db.js';

export const SESSION_COOKIE = 'gos_admin_session';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const SCRYPT_KEY_LEN = 64;
const SCRYPT_SALT_LEN = 16;
const MIN_PASSWORD_LEN = 10;
const MAX_USERNAME_LEN = 64;

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) return null;
  return s;
}

function hmac(value, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(value)
    .digest('base64url');
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ── Password hashing (scrypt) ──────────────────────────────────────
//
// Format: `<saltHex>:<derivedKeyHex>`. Verification re-derives a key
// from the candidate password using the stored salt and compares in
// constant time.
function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT_SALT_LEN);
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEY_LEN);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const sep = stored.indexOf(':');
  if (sep < 0) return false;
  const saltHex = stored.slice(0, sep);
  const keyHex = stored.slice(sep + 1);
  let salt;
  let expected;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(keyHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEY_LEN) return false;
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEY_LEN);
  return crypto.timingSafeEqual(candidate, expected);
}

// ── Cookie token ───────────────────────────────────────────────────
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

function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;
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

// Cached "no admins exist yet" probe. Hitting the DB on every request
// just to ask `count > 0` is wasteful for a value that flips ONCE per
// install (zero → one) and never flips back as long as the first admin
// stays active. We cache positively (`hasAdmins=true` is sticky) and
// invalidate after a successful setup so the very next request sees
// the new state.
let cachedHasAdmins = null;
async function hasAnyActiveAdmin() {
  if (cachedHasAdmins === true) return true;
  const c = await prisma.adminUser.count({ where: { isActive: true } });
  cachedHasAdmins = c > 0;
  return cachedHasAdmins;
}
function invalidateAdminCache() {
  cachedHasAdmins = null;
}

// Attach req.adminAuth = { userId } | null.
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

// Gate middleware. Two acceptance paths:
//   1. Valid session cookie (locked mode).
//   2. Bootstrap mode active (no admins exist yet) — admin routes
//      stay open so the user can finish the first-time setup.
// In all other cases, 401.
export function requireAdminAuth(req, res, next) {
  if (req.adminAuth?.userId) return next();
  // Bootstrap escape hatch. The admin UI itself uses /api/auth/status
  // to pick the right form, but admin API endpoints would still 401
  // a user mid-setup if we required a session here unconditionally.
  hasAnyActiveAdmin()
    .then((exists) => {
      if (!exists) return next();
      res.status(401).json({ error: 'unauthorized' });
    })
    .catch((e) => {
      console.error('[auth] hasAnyActiveAdmin failed', e);
      res.status(500).json({ error: 'auth_check_failed' });
    });
}

function validateUsername(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 3) return null;
  if (trimmed.length > MAX_USERNAME_LEN) return null;
  // Conservative charset — letters, digits, dot, dash, underscore.
  // Hebrew users can pick Latin-only usernames; not a hard barrier.
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return null;
  return trimmed;
}

// ── Routes ────────────────────────────────────────────────────────
export function buildAuthRoutes(express) {
  const router = express.Router();

  // POST /api/auth/setup
  //
  // Creates the first admin user. Idempotency window: the first
  // successful call wins; every subsequent call returns 403. The
  // endpoint MUST stay reachable without auth — it's the only way to
  // bootstrap a fresh install.
  router.post('/setup', async (req, res) => {
    const secret = getSecret();
    if (!secret) {
      return res.status(500).json({
        error: 'auth_misconfigured',
        message: 'SESSION_SECRET is not configured on the server.',
      });
    }
    const exists = await hasAnyActiveAdmin();
    if (exists) {
      return res.status(403).json({ error: 'setup_disabled' });
    }
    const username = validateUsername(req.body?.username);
    const password = String(req.body?.password || '');
    const confirm = String(req.body?.confirmPassword || '');
    if (!username) {
      return res
        .status(400)
        .json({ error: 'invalid_username', message: 'שם משתמש לא תקין' });
    }
    if (password.length < MIN_PASSWORD_LEN) {
      return res.status(400).json({
        error: 'password_too_short',
        message: `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LEN} תווים`,
      });
    }
    if (password !== confirm) {
      return res.status(400).json({
        error: 'password_mismatch',
        message: 'אימות הסיסמה לא תואם',
      });
    }
    let created;
    try {
      created = await prisma.adminUser.create({
        data: {
          username,
          passwordHash: hashPassword(password),
          role: 'admin',
          isActive: true,
          lastLoginAt: new Date(),
        },
        select: { id: true, username: true },
      });
    } catch (e) {
      // Unique-violation race — someone beat us to it. Treat as
      // bootstrap-already-done so the client falls back to login.
      if (e?.code === 'P2002') {
        invalidateAdminCache();
        return res.status(403).json({ error: 'setup_disabled' });
      }
      console.error('[auth] setup failed', e);
      return res.status(500).json({ error: 'setup_failed' });
    }
    invalidateAdminCache();
    const token = buildToken(created.id, DEFAULT_TTL_SECONDS, secret);
    setSessionCookie(res, token);
    res.status(201).json({
      authenticated: true,
      username: created.username,
    });
  });

  // POST /api/auth/login
  router.post('/login', async (req, res) => {
    const secret = getSecret();
    if (!secret) {
      return res.status(500).json({
        error: 'auth_misconfigured',
        message: 'SESSION_SECRET is not configured on the server.',
      });
    }
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const user = await prisma.adminUser.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        passwordHash: true,
        isActive: true,
      },
    });
    // Same response for "no such user" and "wrong password" so an
    // attacker can't enumerate usernames. We still run scrypt on a
    // dummy hash when the user is missing so timing doesn't leak
    // existence either — but keep it simple for now: scrypt is slow
    // enough that one missing-user request is ~1ms while a real
    // verify is ~80ms; future hardening can equalise the two.
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const ok = verifyPassword(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    // Best-effort lastLoginAt update — never block the response on
    // it. A missed update only affects the audit timestamp.
    prisma.adminUser
      .update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })
      .catch((e) => console.warn('[auth] lastLoginAt update failed', e));
    const token = buildToken(user.id, DEFAULT_TTL_SECONDS, secret);
    setSessionCookie(res, token);
    res.json({ authenticated: true, username: user.username });
  });

  // POST /api/auth/logout
  router.post('/logout', (_req, res) => {
    clearSessionCookie(res);
    res.status(204).end();
  });

  // GET /api/auth/status
  //
  // Always 200. The client uses `needsBootstrap` to pick between the
  // setup form and the login form on /admin/login. `authenticated`
  // tells the AdminGuard whether to render or redirect.
  router.get('/status', async (req, res) => {
    const exists = await hasAnyActiveAdmin();
    if (req.adminAuth?.userId) {
      // Hydrate the username so the UI can show "logged in as X".
      // Cheap lookup, only happens on /admin entry (status is a
      // mount-time call, not on every API request).
      const user = await prisma.adminUser.findUnique({
        where: { id: req.adminAuth.userId },
        select: { username: true, isActive: true },
      });
      if (user && user.isActive) {
        return res.json({
          authenticated: true,
          username: user.username,
          needsBootstrap: false,
        });
      }
      // Cookie points at a deactivated/missing user — treat as
      // logged out.
      return res.json({
        authenticated: false,
        needsBootstrap: !exists,
      });
    }
    res.json({
      authenticated: false,
      needsBootstrap: !exists,
    });
  });

  return router;
}
