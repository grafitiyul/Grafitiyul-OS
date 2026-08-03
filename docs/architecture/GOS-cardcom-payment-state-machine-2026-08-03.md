# Cardcom Tourist Payment — Duplicate-Payment Protection (as built, 2026-08-03)

The audit that preceded this slice found a real double-charge window. This
documents the state machine that closed it, so the next person changing the
public payment link knows which rules are load-bearing.

## The window that existed

1. Customer opens `/payment/cardcom/<token>` → GOS mints a Cardcom LowProfile.
2. Customer pays. Cardcom's success redirect pointed at the **bare link**.
3. The webhook had not arrived yet, so the request was still `pending`.
4. The link re-dispatched on `pending` → **minted a second payable session**.

A refresh, a back button, or an impatient customer could pay twice. The old
`ensureCurrentCardcomLowProfile` also re-minted whenever the snapshot drifted,
with a plain `update` (no compare-and-set), so two concurrent opens could
produce two live sessions.

## Canonical states

`PaymentRequest.status` (plain string column — states ship without a type
migration). One resolver, server-side; the client renders, never decides.

| state | meaning | payable? | blocks a 2nd request? |
|---|---|---|---|
| `pending` | request exists, no Cardcom session yet | yes | yes |
| `awaiting_payment` | a LowProfile exists and is reused on refresh | yes | yes |
| `payment_returned` | customer came back; verification pending | **no** | yes |
| `paid` | provider-verified; frozen forever | no | no (terminal) |
| `failed` | provider-verified failure; retry archives it | no | yes |
| `canceled` | operator canceled (`expired` reserved) | no | no (terminal) |

`ACTIVE_STATUSES` (the first four) **is** the partial-unique-index predicate —
one active cardcom request per deal. `PAYABLE_STATUSES` (the first two) is the
only set where a payment page may be created or shown. Both are exported from
`server/src/touristPayment.js` and asserted against the migration in
`touristPayment.test.js`; changing one without the other fails the suite.

## Load-bearing rules

**One session per attempt — DB compare-and-set, never an in-memory lock.**
The mint's `updateMany` is conditioned on the exact `cardcomLowProfileId` the
caller read *and* on the request still being payable. Two concurrent opens may
both call Cardcom, but only one result is persisted; the loser discards its
orphan session (never stored, never shown) and converges on the winner's URL.
An in-memory lock would not survive two Railway instances.

**The return URL is not proof of payment.** `/payment/cardcom/<token>/return`
only stamps `payment_returned`. Marking paid requires a server-side
`GetLpResult` with a transaction identity, an exact amount match, and — when
Cardcom reports `CoinId` — a currency match. Any mismatch sets `verifyHold`
and leaves the request unresolved for the office rather than auto-completing.

**Verification is the only door to money-side effects.** WON transition,
accounting document, and the confirmation email all sit behind the single
`markPaidFromResult` CAS (`status IN ACTIVE → paid`), so duplicate webhooks,
a webhook racing reconciliation, and a post-reconcile replay all converge on
exactly one execution.

**A missing webhook reconciles; it never reopens payment.** The waiting page
polls `/status`, and the בקרה sweep re-checks stuck requests. Both funnel into
`reconcileCardcomRequest`, which claims a per-request rate limit via a
`lastVerifyAt` CAS before calling Cardcom — polling customers and the sweep
cannot stampede the provider. A provider outage leaves the request exactly
where it was.

**Replacement requires proven failure.** Only a verified declined transaction
produces `failed`, and only the explicit retry path replaces the session:
prior evidence is archived to `attemptHistory`, `attemptNo` increments, and a
double-clicked retry archives once (CAS). A refresh, timeout, missing webhook,
customer return, or back button can never reach it.

**Frozen while verifying.** `payment_returned` blocks Deal→request sync, edits,
and cancel — the money may already be real, so nothing may change what is owed.

## Customer pages

English-first (this flow serves foreign customers), Hebrew line underneath:
payment available (redirect), verification pending (*"Please do not pay again"*
/ *"אין לבצע תשלום נוסף"*, self-refreshing: 5s for the first minute then 15s),
success, verified failure (the only retry entry point), and unavailable. No
provider codes are ever shown; the technical reason goes to the log.

## Operator visibility

The Deal's Cardcom modal shows the attempt state in business language, plus
created / returned / webhook-received / last-verified stamps, attempt number,
session id, and any hold — and freezes its form while verification is pending.
Anything stuck beyond 10 minutes (or held) raises the
`cardcom_verification_stuck` בקרה issue: critical when a human must decide.

## Migration

`20260803180000_cardcom_payment_state_machine` — additive. New nullable
columns (plus `attemptNo` defaulting to 1), a backfill that only widens
`pending` rows *already holding a LowProfile* into `awaiting_payment`, and the
wider unique index created **before** the old one is dropped so there is no
unguarded window. Nothing is marked paid from redirect fields.

## Still open (not this slice)

- **Cardcom terminal 147226 lacks LowProfile permission** (ResponseCode 650) —
  the separate blocker from the 2026-08-03 audit. No tourist link can reach a
  payment page until Cardcom enables the module, so the end-to-end production
  drill below is pending.
- **ISOCoinId codes for USD/EUR are still unverified** against the live
  terminal (`CARDCOM_ISOCOIN_*` overrides exist). The currency check compares
  against the same unverified mapping, so confirm it before non-ILS charges.
- **`expired`** is defined and rendered but nothing auto-expires yet.

## Production verification drill (run once Cardcom enables LowProfile)

Open the link (one session minted) → refresh twice (same session, no new mint)
→ pay → confirm the return shows verification-pending, not a payment page →
refresh repeatedly before the webhook (still no payment option) → webhook
arrives → page flips to success → assert in the DB: one `paid` request, one
`cardcomLowProfileId` ever stored, deal WON once, one accounting document, one
Report #26, one confirmation-email workflow. Then re-send the same webhook to
confirm it is a no-op.
