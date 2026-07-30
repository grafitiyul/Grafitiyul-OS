# WhatsApp read/unread state & historical pin recovery

Status as of 2026-07-30. Written after the first correct pairing of the main
number and two live iterations on the recovery procedure. This is the
reference for "why does GOS disagree with the phone about read/pinned state,
and what can and cannot be recovered".

## What works today (verified in production)

**Live bidirectional read/unread sync** — proven on the live `main` account:

| direction | mechanism |
|---|---|
| new inbound message → GOS unread | bridge `bumpUnreadById` (increments iff newer than the read water-mark) |
| owner replies from any device → GOS read | `markChatReadById` on outgoing live message |
| chat read on the phone → GOS read | `chats.update` with `unreadCount: 0` |
| chat marked-unread on the phone → GOS | `chats.update` with `unreadCount: -1` → `manualUnreadAt` |
| chat opened in GOS → phone read | `markChatRead` advances the water-mark, then bridge `/mark-read` → `socket.readMessages()` receipts (multi-device sync) |
| pin/unpin on the phone → GOS | `chats.update` `pinned` → `providerPinnedAt` (read-only mirror; GOS never writes pin back) |
| archive/delete on the phone → GOS | `providerArchivedAt` / `providerDeletedAt` flags; live message revives |

**Snapshot restore at pairing/history sync** (`bridge/src/ingest.js`):
`messaging-history.set` and `chats.upsert` are snapshot-shaped, so positive
unread counts from them are trusted: `applySnapshotUnread` sets the count and
back-derives `lastReadAt` under the N newest incoming messages. The bundle's
`chats[]` also seed rows for conversations whose messages missed the bundle,
and mirror archive + pin state. This code shipped AFTER the 2026-07-30
pairing, so it has not yet been exercised by a real pairing — the next
pairing/history event proves it.

Trust boundary (deliberate): positive counts are accepted ONLY from
snapshot-shaped events. `chats.update` is a partial event whose positive
`unreadCount` has historically been ambiguous (absolute vs incremental) in
Baileys; from it we trust only `0` and `-1`. The live bump owns the count
otherwise.

## What was NOT recovered, and why (protocol limitations)

The 2026-07-30 pairing ran with the OLD code, so the phone's pre-pairing
unread counts and pin state were dropped at the only moment WhatsApp offers
them wholesale. Recovering them afterwards hit two real protocol limits:

1. **Unread counts exist only in the pairing-time history bundle.** WhatsApp's
   app state (the cross-device settings sync) carries `markChatAsRead`
   read/unread FLAGS, archive, pin, mute — but never numeric unread counts.
   Once the bundle is gone, counts are gone. A chat unread on the phone
   surfaces in GOS the moment any new message arrives in it (live bump), or
   when the user toggles its read state on the phone.

2. **App-state replay ("recovery resync") is fragile by design.** The
   canonical procedure — delete the account's `app-state-sync-version` rows
   (ONLY those; never creds/keys/sessions) and restart the bridge — makes the
   hook in `waClient.maybeInitialAppStateResync` request a full replay. Two
   hard-won implementation facts, both proven live and both fixed in code:
   * `resyncAppState(..., isInitialSync=true)` — the registration-time
     variant — attaches a `conditional` to every emitted update that only
     passes when the chat exists in the CONCURRENTLY BUFFERED history sync.
     No history sync running → every event silently discarded. Must use
     `false` (the dirty-hint path: unconditional emits, and with the cursor
     gone "incremental" means everything from version 0).
   * The resync must not fire on the first `connection: open` after a
     restart: Railway's deploy overlap runs two containers whose sockets
     replace each other (440 ping-pong), and a resync killed mid-processing
     STILL rebuilds the cursor rows (`decodePatches` persists versions even
     when the event flush dies) — so the retry guard sees "synced" and never
     retries. The hook therefore waits 30s of stable connection (timer armed
     on open, cleared on close).

   Final state of the effort: the hook is deployed and correct as far as it
   was tested, but the third live run was NOT performed — the business call
   (2026-07-30) was that live sync already works, historical pins are an
   optimization, and engineering time stops here. The procedure remains
   available: delete the 5 cursor rows for the account, restart the bridge,
   wait ~1 minute past the churn, verify `providerPinnedAt` counts.

3. **The zero-engineering per-chat fix**: unpin + re-pin (or toggle read
   state) on the phone. The live `chats.update` path syncs it immediately.
   This is the practical answer for individual chats — e.g. the pinned chat
   `972508783355`, which exists in GOS fully identified but sorts at
   position ~729 by its 2026-02 last message, beyond the inbox's take-200
   window, until a pin or a new message lifts it.

## Operational notes

* The inbox 'active' scope matches every contact-linked chat regardless of
  age (731 of 814 on main) but the route returns the top 200 by pin-then-
  recency. Chats beyond that horizon are reachable via search; they are also
  invisible on the phone's own first screens, so this is parity, not loss.
* Account isolation: every read-state statement filters `accountId`; main
  and office cannot cross-contaminate.
* Pin/archive/mute WRITES back to WhatsApp are deliberately not implemented
  (app-state patch writes are the most corruption-prone Baileys surface, and
  there is no operational need yet).
