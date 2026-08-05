# Woo → GOS Operational Pipeline (Open Tours) — 2026-08-05

Goal: every PAID WooCommerce group-tour order becomes a fully operational GOS
Deal automatically — quote, WON, booking, ticket registrations, capacity,
collection, confirmation email — with zero operator re-entry. Woo is the sales
entry point only; GOS is the only business authority.

## What already existed (audit result)

| Piece | Where | State |
|---|---|---|
| Woo webhook route + HMAC + fetch-by-id | `routes/ingress.js`, `ingress/adapters/woocommerce.js`, `ingress/signature.js` | shipped, tested, NOT activated (no `WOO_PRIMARY_WEBHOOK_SECRET` in prod) |
| Content-hash idempotency, one-deal-per-order lifecycle | `ingress/identity.js`, `ingress/resolve.js`, `wooLifecycle.test.js` | shipped |
| variation_id → (TourEvent, card, ticketType) | `WooVariationLink` (unique `[tourEventId, cardGroupId, variantKey]`) | LIVE in prod: 252 links, 2 active card mappings (Woo product 167) |
| Canonical group quote lines | `sourceKind:'group_ticket'` QuoteLines (Ticket Builder shape) | shipped — UI-only writer until now |
| Payment→WON settle (WON + booking + registration + capacity) | `deals/paymentWon.js settleDealWon` | shipped (iCount IPN, Cardcom, manual) |
| Confirmation email on WON (auto vs review card) | `confirmation/wonHook.js` | shipped, fires from `emitWonTransitionEffects` |
| Collection SSOT | `collection.js` (`IcountDocument` + `DealCollectionEvidence`) | shipped |

The ONE gap: `ingress/pipeline.js` called the bare `transitionDealToWon` for a
paid order — WON with a timeline note, but **no quote lines, no booking, no
TicketRegistration, no capacity effect, no collection evidence**.

## Canonical flow (after this change)

```
Woo webhook (paid order, HMAC-verified)
  └─ ingress pipeline (unchanged stages 1-6): Contact + Deal (+pinned note)
       └─ [tx commits; event stamped with dealId — retry-safe]
  └─ wooOrderOperational (NEW, post-commit, retried via ingress worker):
       1. RESOLVE   order lines → WooVariationLink → (tourEventId, cardGroupId, ticketTypeId)
       2. COMPOSE   canonical Ticket-Builder quote lines (same engine as the UI:
                    card prices, card VAT, card first-line notes, composeBuilderLines
                    totals; coupon delta = explicit discount line) → working
                    QuoteVersion + Deal.valueMinor/participants/product
       3. MONEY     DealCollectionEvidence kind 'woo_payment' (origin 'woo',
                    reference woo:<store>:<orderId>) — collection reads PAID
       4. SETTLE    settleDealWon(targetTourEventId, allowOverbook, cause:'woo_order')
                    → transitionDealToWon (atomic) → Booking → syncDealRegistration
                    (source:'deal' row + ticketBreakdown) → capacity/occupancy →
                    operational product recompute → Woo stock re-sync marked →
                    changelog + Report #26 + comms triggers + confirmation email
                    (auto or review card per the confirmation module's own rules)
```

Unpaid orders: Deal + pinned status note + composed quote (kept in sync with
order edits until WON). Payment later (`processing`/`completed` webhook) →
steps 3-4.

## Decisions

1. **No new business logic; one new seam module.**
   `server/src/deals/wooOrderOperational.js` orchestrates ONLY existing
   canonical services. Woo never prices, never registers, never WONs directly.
2. **Quote parity = operator parity.** Lines are byte-shape-identical to the
   Group Ticket Builder save: `kind:'manual'`, label `"card — ticket"`,
   `sourceKind:'group_ticket'` (+cardGroupId/ticketTypeId/productVariantId),
   card VAT, canonical `PriceRuleTicketPrice` unit prices, card first-line
   notes, `composeBuilderLines` totals. `sourceKind` MUST stay
   `group_ticket` — it is what `resolveDealGroupOffering` and the whole
   registration/derivation chain read.
3. **Woo paid total is the money truth.** When engine gross ≠ Woo paid total
   (coupon/fee/price drift) an explicit adjustment line (discount/addon,
   `overridden:true`) reconciles the quote to the paid amount — exactly what
   an operator would enter, and collection settles to zero.
4. **Rewrite policy (pre-WON only).** The composer rewrites the working
   version only when it is empty or contains ONLY `group_ticket` lines; any
   foreign line (operator custom row / reservation source) ⇒ skip + timeline
   note. After WON the composer never touches the Builder.
5. **Payment recorded as collection evidence, not a fake document.**
   New evidence kind `woo_payment` (direction 'in', origin `'woo'`,
   createdByName 'WooCommerce'), deduped by reference. No iCount document is
   fabricated; if iCount later issues a real receipt for the same money the
   operator sees both and collection review flags overpayment.
6. **Registrations stay `source:'deal'`** (created via booking →
   `syncDealRegistration`), so every existing filter (`resyncDealGroupTours`,
   realign, adoption) keeps working. Woo identity lives on the ingress event,
   the deal, and the evidence reference — not on a parallel registration
   source (the reserved `source:'woocommerce'` remains for a future
   deal-less flow).
7. **Failure = loud, never silent.** Unresolvable lines / multi-tour orders /
   full tour ⇒ deal still WONs on payment (money is real, existing
   `won_without_tour` flag) + a `woo_order_attention` ReviewItem
   (exactly-once by dedupeKey). Retries via the existing ingress worker
   backoff.
8. **Retry safety fix.** The ingress event is stamped with `dealId`
   immediately after the persist transaction (status still `pending`), and
   `findDealForExternalOrder` matches any event with a dealId — a failure in
   the operational step can never mint a second deal for the same order.
9. **Single writer at cutover.** The Woo route now enforces
   `assertIngressAllowed` (409 `SOURCE_NOT_CUT_OVER` until
   `SOURCE_WRITER_WOO_OLD=direct`), and the `'new'`→`'secondary'` store-key
   drift in `mirror/sourceRegistry.js` is fixed. Activating direct ingress
   and retiring the Make→Pipedrive path is one env change, not two writers.
10. **No schema migration.** Every field needed already exists
    (`kind`/`origin` on evidence are open strings; comments updated).

## Idempotency map (replay converges at every layer)

| Layer | Key |
|---|---|
| Webhook delivery | `wooEventHash` business projection → IngressEvent unique |
| Order → Deal | ingress-event ledger (`findDealForExternalOrder`, now incl. mid-flight events) |
| Quote compose | replace-sync, skip when unchanged / WON / foreign lines |
| Payment evidence | lookup by (dealId, kind, reference) before create |
| WON | atomic `status != 'won'` guard in `transitionDealToWon` |
| Booking | existing active booking reused; DB partial unique (one active/deal) |
| Registration | `syncDealRegistration` upsert by bookingId + hold adoption |
| Confirmation email | `wonTransitionKey` + 10s window + review-card dedupe |
| Review card | `woo_order_attention:<store>:<orderId>` dedupeKey |

## Activation runbook (production)

1. Deploy (push to main → Railway).
2. Set on the app service: `WOO_PRIMARY_WEBHOOK_SECRET=<random>` and
   `SOURCE_WRITER_WOO_OLD=direct` (writer cutover — the Make/Pipedrive Woo
   path must be OFF at the same moment; the registry vocabulary is
   legacy / direct / off).
3. In the live store wp-admin (or via REST): create webhooks
   `order.created` + `order.updated` → `https://app.grafitiyul.co.il/api/ingress/woocommerce/primary`
   with the same secret.
4. Verify with one real paid order (checklist in the verification section of
   the implementation notes): deal, quote, WON, booking, registrations,
   capacity, confirmation email, collection PAID, replay → no duplicates.

## Risks called out

- Woo prices must keep coming FROM GOS (existing sync). If an operator edits a
  price in Woo directly, the adjustment-line mechanism keeps money truthful
  but the quote will show a price-drift adjustment.
- Orders whose lines carry no `variation_id` (simple products) cannot resolve
  to a tour — they go through the loud review path by design.
- `on-hold` orders are NOT paid (deliberate 2026-08-04 decision) — unchanged.
- Refund/cancel after payment still never un-WONs (office decision) — unchanged.
