// Ingress Platform — the public webhook endpoints.
//
// These are the URLs external systems will be pointed at during cutover. They
// are deliberately thin: authenticate, translate via the adapter, hand the
// canonical event to the shared pipeline. No business logic lives here.
//
// Mounted BEFORE the global express.json so the raw request body is captured
// for signature verification (a re-serialized req.body cannot reproduce the
// provider's exact bytes). The parser here is scoped to this router with its
// own modest limit, so the global 25mb upload path is unaffected.
//
// Response policy: once a payload is durably received we answer 200 even if
// processing failed — the event is persisted and the retry worker owns it.
// Providers must not be told to re-deliver something we already hold. The only
// non-200 answers are authentication failures and unconfigured sources, both
// of which a retry would not fix.

import express, { Router } from 'express';
import { handle } from '../asyncHandler.js';
import { ingest } from '../ingress/pipeline.js';
import { metaAdapter } from '../ingress/adapters/meta.js';
import { wooAdapter } from '../ingress/adapters/woocommerce.js';
import { websiteFormAdapter } from '../ingress/adapters/websiteForm.js';
import { buildIdempotencyKey } from '../ingress/identity.js';
import { metaConfigured, wooStoreConfigured, websiteFormConfigured, wooStoreConfig } from '../ingress/config.js';
import { IngressError } from '../ingress/errors.js';
import { assertIngressAllowed } from '../mirror/sourceRegistry.js';

const router = Router();

const capture = (req, _res, buf) => {
  req.rawBody = buf;
};
router.use(express.json({ limit: '2mb', verify: capture }));
router.use(express.urlencoded({ extended: true, limit: '2mb', verify: capture }));

// Webhook receipts are never cacheable (project caching policy §15).
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const authFailure = (res, err, source) => {
  const code = err instanceof IngressError ? err.code : 'signature_invalid';
  console.error(`[ingress:${source}] rejected — ${code}`);
  // 401 for a bad signature, 503 when WE are not configured yet: the first is
  // the caller's problem, the second is ours and is fixed by adding a variable.
  const status = code === 'signature_secret_missing' ? 503 : 401;
  return res.status(status).json({ ok: false, error: code });
};

// ── Meta Lead Ads ───────────────────────────────────────────────────────────

// Subscription handshake. Meta calls this once when the webhook is registered
// and expects the challenge echoed back as plain text.
router.get('/meta', (req, res) => {
  try {
    const r = metaAdapter.verifySubscription(req.query);
    if (!r.ok) return res.status(403).send('verification failed');
    return res.status(200).type('text/plain').send(r.challenge);
  } catch (err) {
    return authFailure(res, err, 'meta');
  }
});

router.post(
  '/meta',
  handle(async (req, res) => {
    if (!metaConfigured()) {
      return res.status(503).json({ ok: false, error: 'source_not_configured' });
    }
    try {
      metaAdapter.verify({ rawBody: req.rawBody, headers: req.headers });
    } catch (err) {
      return authFailure(res, err, 'meta');
    }

    const leads = metaAdapter.extractLeads(req.body);
    // Receipt is logged unconditionally. Previously only failures logged, which
    // made a WORKING integration indistinguishable from a dead one — the single
    // most expensive gap in bringing this source up. Ids only: never the
    // signature header, the token or any answer content.
    console.log(`[ingress:meta] delivery accepted — ${leads.length} lead(s)`);
    const results = [];
    for (const lead of leads) {
      const gate = metaAdapter.isAllowed(lead);
      if (!gate.ok) {
        // A skipped lead is never silent: it leaves no IngressEvent, so the log
        // line is the ONLY trace it ever existed.
        console.warn(
          `[ingress:meta] lead ${lead.leadgenId} SKIPPED — ${gate.code} (form=${lead.formId} page=${lead.pageId})`,
        );
        results.push({ leadgenId: lead.leadgenId, skipped: gate.code });
        continue;
      }
      try {
        // Each lead is fetched and ingested independently under its own
        // idempotency key, so one bad lead cannot suppress its siblings.
        const details = await metaAdapter.fetchLeadDetails(lead.leadgenId);
        const canonicalEvent = metaAdapter.toCanonicalEvent(details, lead);
        const r = await ingest({
          source: metaAdapter.key,
          sourceKey: lead.formId || lead.pageId || null,
          externalId: lead.leadgenId,
          idempotencyKey: buildIdempotencyKey({ source: metaAdapter.key, externalId: lead.leadgenId }),
          rawPayload: { notification: lead, details },
          rawHeaders: { 'x-hub-signature-256': req.headers['x-hub-signature-256'] || null },
          canonicalEvent,
        });
        console.log(
          `[ingress:meta] lead ${lead.leadgenId} → event ${r.eventId} status=${r.status}` +
            ` outcome=${r.outcome ?? '-'} deal=${r.dealId ?? '-'}`,
        );
        results.push({ leadgenId: lead.leadgenId, ...r });
      } catch (err) {
        // The lead is real but we could not fetch/translate it. Persist the
        // notification so the worker can retry — never drop it.
        const code = err instanceof IngressError ? err.code : 'internal_error';
        console.error(`[ingress:meta] lead ${lead.leadgenId} failed — ${code}`);
        await ingest({
          source: metaAdapter.key,
          sourceKey: lead.formId || null,
          externalId: lead.leadgenId,
          idempotencyKey: buildIdempotencyKey({ source: metaAdapter.key, externalId: lead.leadgenId }),
          rawPayload: { notification: lead, fetchError: code },
          canonicalEvent: null,
        }).catch(() => {});
        results.push({ leadgenId: lead.leadgenId, status: 'deferred', error: code });
      }
    }
    return res.status(200).json({ ok: true, received: leads.length, results });
  }),
);

// ── WooCommerce (per store) ─────────────────────────────────────────────────

router.post(
  '/woocommerce/:storeKey',
  handle(async (req, res) => {
    const { storeKey } = req.params;
    if (!wooStoreConfig(storeKey)) return res.status(404).json({ ok: false, error: 'store_unknown' });
    if (!wooStoreConfigured(storeKey)) return res.status(503).json({ ok: false, error: 'source_not_configured' });

    // ONE active writer per source (cutover registry): until the writer env
    // flips to `direct`, this endpoint refuses loudly — accepting would run
    // direct ingress ALONGSIDE the legacy Make→Pipedrive path and double every
    // order. 409 is deliberate: the store operator sees a hard error, nothing
    // is silently dropped, and flipping SOURCE_WRITER_* is the whole fix.
    try {
      assertIngressAllowed('woocommerce', storeKey);
    } catch (err) {
      console.error(`[ingress:woo:${storeKey}] refused — ${err.code}`);
      return res.status(err.status || 409).json({ ok: false, error: err.code || 'source_not_cut_over' });
    }

    try {
      wooAdapter.verify({ rawBody: req.rawBody, headers: req.headers, storeKey });
    } catch (err) {
      return authFailure(res, err, `woo:${storeKey}`);
    }

    const orderId = wooAdapter.orderIdOf(req.body);
    if (!orderId) return res.status(200).json({ ok: true, ignored: 'no_order_id' });

    let order = req.body;
    let fetchError = null;
    if (!wooAdapter.isCompleteOrder(order)) {
      try {
        order = await wooAdapter.fetchOrder(storeKey, orderId);
      } catch (err) {
        fetchError = err instanceof IngressError ? err.code : 'internal_error';
        order = null;
      }
    }

    const canonicalEvent = order ? wooAdapter.toCanonicalEvent(order, { storeKey }) : null;
    const r = await ingest({
      source: wooAdapter.key,
      sourceKey: storeKey,
      externalId: orderId,
      // TWO identities, deliberately separate:
      //   externalId (order id) — the STABLE identity of the purchase; it is
      //     what resolves every later delivery to the same Deal.
      //   idempotencyKey (order id + canonical content hash) — the identity of
      //     THIS delivery; it is what decides whether we have already processed
      //     this exact state of the order.
      // Keying only on the order id (the rule until 2026-08-04) collapsed every
      // status transition into "duplicate" and froze the deal at its first
      // delivery. Putting the status in the key instead would have created a new
      // deal per transition. The content hash gives both: retries and no-op
      // saves collapse, real changes flow through to the SAME deal.
      idempotencyKey: buildIdempotencyKey({
        source: wooAdapter.key,
        sourceKey: storeKey,
        externalId: orderId,
        salt: order ? wooAdapter.wooEventHash(order) : null,
      }),
      rawPayload: order ? { order } : { orderId, fetchError },
      rawHeaders: { 'x-wc-webhook-signature': req.headers['x-wc-webhook-signature'] || null },
      canonicalEvent,
    });
    return res.status(200).json({ ok: true, ...r });
  }),
);

// ── Website / Elementor forms ───────────────────────────────────────────────
//
// URL-path secret (the pattern the Cardcom/iCount receivers already use),
// because Elementor cannot compute an HMAC. `formKey` identifies which form so
// attribution stays per-form without a scenario per form.

router.post(
  '/website-form/:secret/:formKey?',
  handle(async (req, res) => {
    if (!websiteFormConfigured()) {
      return res.status(503).json({ ok: false, error: 'source_not_configured' });
    }
    try {
      websiteFormAdapter.verify({
        rawBody: req.rawBody,
        headers: req.headers,
        providedSecret: req.params.secret,
      });
    } catch (err) {
      return authFailure(res, err, 'website_form');
    }

    const formKey = req.params.formKey || req.query.form || 'unknown';
    const canonicalEvent = websiteFormAdapter.toCanonicalEvent(req.body, { formKey });
    const r = await ingest({
      source: websiteFormAdapter.key,
      sourceKey: formKey,
      externalId: null,
      // No provider id exists, so the body hash is the replay key — a genuine
      // double-submit of identical content collapses, distinct submissions do not.
      idempotencyKey: buildIdempotencyKey({
        source: websiteFormAdapter.key,
        sourceKey: formKey,
        rawBody: req.rawBody ? req.rawBody.toString('utf8') : req.body,
      }),
      rawPayload: req.body,
      canonicalEvent,
    });
    return res.status(200).json({ ok: true, ...r });
  }),
);

export default router;
