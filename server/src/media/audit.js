import crypto from 'node:crypto';

// Audit trail for gallery access-surface changes and for every PUBLIC mutation.
//
// Privacy stance: we keep enough provenance to investigate abuse (was this the
// same visitor? how many uploads in an hour?) and nothing more. Abuse
// correlation only ever needs EQUALITY between visitors, and a hash preserves
// equality — so storing a raw IP address would buy nothing and retain personal
// data for no reason.
//
// The salt is per-deployment and secret. Without one we store NULL rather than
// an unsalted hash: an unsalted IPv4 hash is trivially reversible by brute
// force (the whole space is 2^32), so it would be personal data wearing a
// disguise. A missing salt must degrade to "no correlation", never to "false
// privacy".

const SALT = process.env.MEDIA_AUDIT_IP_SALT || '';

export function hashIp(ip) {
  const raw = String(ip || '').trim();
  if (!raw || !SALT) return null;
  return crypto.createHash('sha256').update(`${SALT}:${raw}`).digest('hex').slice(0, 32);
}

/** Client IP as Express sees it behind the Railway proxy. */
export function requestIp(req) {
  return req?.ip || req?.socket?.remoteAddress || null;
}

// User-Agent is truncated: the long tail carries no investigative value and
// unbounded client-controlled strings do not belong in a database column.
const UA_MAX = 200;

/**
 * Record one auditable action. NEVER throws into the caller — an audit write
 * failing must not fail a customer's upload. It logs and moves on, because a
 * refused upload is a worse outcome than a missing audit row.
 */
export async function recordGalleryAudit(
  client,
  { galleryId, action, actorType, linkId = null, actorId = null, mediaId = null, req = null, detail = null },
  { log = console } = {},
) {
  try {
    if (!galleryId || !action) return null;
    return await client.galleryAudit.create({
      data: {
        galleryId,
        action,
        actorType,
        linkId,
        actorId,
        mediaId,
        ipHash: req ? hashIp(requestIp(req)) : null,
        userAgent: req ? String(req.get?.('user-agent') || '').slice(0, UA_MAX) || null : null,
        detail: detail || undefined,
      },
    });
  } catch (e) {
    log.warn?.(`[media-audit] could not record ${action}: ${e?.message || e}`);
    return null;
  }
}

export const GALLERY_AUDIT_ACTIONS = Object.freeze({
  upload: 'upload',
  delete: 'delete',
  edit: 'edit',
  downloadAll: 'download_all',
  linkRotated: 'link_rotated',
  linkDisabled: 'link_disabled',
  linkEnabled: 'link_enabled',
  permissionsChanged: 'permissions_changed',
});
