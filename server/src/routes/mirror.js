// Legacy Mirror — the inbound webhook endpoints.
//
// Deliberately thin, exactly like the ingress endpoints: authenticate, identify
// the entity, hand the raw payload to the shared pipeline. No merging, no
// business logic, no ownership decisions here.
//
// Mounted BEFORE the global express.json so the raw body is captured for HMAC
// verification — a re-serialized req.body cannot reproduce the provider's bytes.
//
// Response policy: once the payload is durably received we answer 200 even if
// processing failed. The event is persisted and the retry worker owns it;
// telling Pipedrive to redeliver something we already hold only creates noise.
// Non-200 is reserved for authentication failures and unconfigured sources —
// neither of which a redelivery would fix.

import express, { Router } from 'express';
import { handle } from '../asyncHandler.js';
import { prisma } from '../db.js';
import { ingestMirror, receive } from '../mirror/pipeline.js';
import { entityForPipedriveObject } from '../mirror/sources/pipedriveMirror.js';
import { mirrorAdapterFactory } from '../mirror/adapters.js';
import { safeEqual } from '../ingress/signature.js';
import { mirrorMode } from '../mirror/config.js';

const router = Router();

const capture = (req, _res, buf) => { req.rawBody = buf; };
router.use(express.json({ limit: '2mb', verify: capture }));
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const secret = () => String(process.env.MIRROR_PIPEDRIVE_WEBHOOK_SECRET || '').trim();
// The canonical phase flags, NOT the legacy single switch. Gating this route on
// MIRROR_ENABLED meant that in Phase D (capture+apply, MIRROR_ENABLED unset) every
// webhook took the buffer-only branch and was never processed inline — it worked
// only because the retry worker eventually drained it, one poll interval late.
// mirrorMode() keeps the route and the pipeline on the same definition of "live".
const processingLive = () => mirrorMode().apply;

/**
 * Pipedrive webhooks authenticate with HTTP Basic (username/password set when
 * the subscription is created). We compare the whole header in constant time
 * through the shared helper rather than parsing and comparing parts, so the
 * check cannot be weakened by accident.
 */
function authorized(req) {
  const expected = secret();
  if (!expected) return false;
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const password = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : decoded;
  return safeEqual(password, expected);
}

// Pipedrive's own change id, when present, is the most precise version marker
// available; the payload hash is the fallback.
function versionOf(body) {
  return String(
    body?.meta?.timestamp
    ?? body?.meta?.change_source_version
    ?? body?.current?.update_time
    ?? '',
  ) || null;
}

router.post(
  '/pipedrive',
  handle(async (req, res) => {
    if (!secret()) {
      console.error('[mirror:pipedrive] rejected — MIRROR_PIPEDRIVE_WEBHOOK_SECRET is not set');
      return res.status(503).json({ error: 'not_configured' });
    }
    if (!authorized(req)) {
      console.error('[mirror:pipedrive] rejected — bad credentials');
      return res.status(401).json({ error: 'unauthorized' });
    }

    const body = req.body || {};
    const object = body?.meta?.object ?? body?.meta?.entity;
    const entity = entityForPipedriveObject(object);
    const externalId = body?.meta?.id ?? body?.current?.id ?? body?.previous?.id;

    // An object we do not mirror is acknowledged and dropped: Pipedrive
    // subscriptions are coarse, and 4xx-ing a note webhook would make it retry
    // forever for no reason.
    if (!entity || !externalId) {
      return res.json({ ok: true, ignored: true, reason: !entity ? 'unmirrored_object' : 'no_id' });
    }

    const args = {
      system: 'pipedrive',
      entity,
      externalId: String(externalId),
      changeKind: String(body?.meta?.action || 'updated'),
      transport: 'webhook',
      version: versionOf(body),
      rawPayload: body,
      rawHeaders: { 'user-agent': req.headers['user-agent'] || null },
    };

    // The kill switch stops PROCESSING, never receipt. Payloads keep landing
    // durably so nothing is lost while the mirror is paused, and the retry
    // worker drains them when it is switched back on.
    if (!processingLive()) {
      const r = await receive(prisma, args);
      return res.json({ ok: true, received: true, processing: 'disabled', eventId: r.eventId });
    }

    const adapter = mirrorAdapterFactory('pipedrive', entity);
    if (!adapter) return res.json({ ok: true, ignored: true, reason: 'no_adapter' });

    const result = await ingestMirror(prisma, args, adapter);
    return res.json({ ok: true, eventId: result.eventId, outcome: result.outcome ?? null });
  }),
);

export default router;
