import crypto from 'node:crypto';
import { prisma } from '../db.js';

// Service identity for EXTERNAL consumer systems (Challenge, Recruitment).
//
// The boundary this enforces: those systems get an authenticated, workspace-
// scoped HTTP API and nothing else — never database credentials, never R2
// credentials, never a raw object URL. Everything they can reach is decided
// here, server-side.
//
// Only the HASH of a token is stored. The plaintext is shown once at creation
// and is unrecoverable afterwards, so reading the database cannot yield a
// working credential.

const TOKEN_BYTES = 32;

export function generateToken() {
  return `gos_ct_${crypto.randomBytes(TOKEN_BYTES).toString('base64url')}`;
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

export async function createServiceToken(client, { workspaceId, label, canRead = true, canWrite = false, canUpload = false, canTranscribe = false, createdById = null }) {
  const token = generateToken();
  const row = await client.contentServiceToken.create({
    data: {
      workspaceId,
      label: String(label || '').trim() || 'service',
      tokenHash: hashToken(token),
      canRead,
      canWrite,
      canUpload,
      canTranscribe,
      createdById,
    },
  });
  // The ONLY moment the plaintext exists. Callers must surface it now or it is
  // gone for good.
  return { id: row.id, token, label: row.label };
}

export async function revokeServiceToken(client, id) {
  return client.contentServiceToken.updateMany({
    where: { id, status: 'active' },
    data: { status: 'revoked', revokedAt: new Date() },
  });
}

function readBearer(req) {
  const raw = req.get?.('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

/**
 * Express middleware. Resolves the caller's workspace from the token and
 * attaches `req.contentAuth = { workspaceId, workspace, grants }`.
 *
 * Failures are a flat 401 with no detail: distinguishing "unknown token" from
 * "revoked token" would confirm to a prober that a credential once existed.
 */
export function requireServiceToken(req, res, next) {
  const token = readBearer(req);
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  prisma.contentServiceToken
    .findUnique({ where: { tokenHash: hashToken(token) }, include: { workspace: true } })
    .then(async (row) => {
      if (!row || row.status !== 'active' || !row.workspace?.active) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      req.contentAuth = {
        tokenId: row.id,
        workspaceId: row.workspaceId,
        workspace: row.workspace,
        grants: {
          canRead: row.canRead,
          canWrite: row.canWrite,
          canUpload: row.canUpload,
          canTranscribe: row.canTranscribe,
        },
      };
      // Best-effort last-used stamp; never blocks or fails the request.
      prisma.contentServiceToken
        .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
      next();
    })
    .catch(() => res.status(401).json({ error: 'unauthorized' }));
}

export function requireGrant(grant) {
  return (req, res, next) => {
    if (!req.contentAuth?.grants?.[grant]) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

/**
 * The workspace filter every consumer query MUST carry.
 *
 * The primary (GOS) workspace sees everything — it is the owning tenant, the
 * same convention Challenge uses for its primary workspace. Every other
 * workspace sees ONLY items explicitly granted to it: a missing
 * LibraryItemWorkspace row means no access, never implicit access.
 */
export function workspaceScopeWhere(contentAuth) {
  if (contentAuth?.workspace?.isPrimary) return {};
  return { workspaces: { some: { workspaceId: contentAuth.workspaceId } } };
}
