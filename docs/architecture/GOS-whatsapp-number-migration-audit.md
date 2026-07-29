# WhatsApp — business-number migration audit

**Status:** AUDIT COMPLETE. Nothing changed operationally. The migration is
blocked on two owner inputs (the target number, then a QR scan) — both of which
were pre-agreed as stop conditions.

**Measured:** 2026-07-29, read-only against production.

---

## 1. What exists today

| | `personal_test` | `office` |
|---|---|---|
| Number | **972524264020** | **972533083321** |
| Device | `Dor Koren` | — |
| Status | **connected** | **qr_required** |
| Paired JID | `972524264020:80@s.whatsapp.net` | none, ever |
| Last connected | 2026-07-29 10:04 | **never** |
| Last inbound | 2026-07-29 11:38 | never |
| Reconnect attempts | 0 | **9,624** |
| Chats | 223 (34 linked to CRM) | 0 |
| Messages | **20,314** (1,124 with media) | 0 |
| History span | 2026-01-16 → 2026-07-29 | — |
| Auth-state rows | 26,475 | 0 |
| Data gaps | 1,347 | 1 |

Bridge binding (`WHATSAPP_BRIDGE_URLS`):

```
personal_test = http://gos-whatsapp-main.railway.internal:3000
office        = http://gos-whatsapp-office.railway.internal:3000
```

Note the mismatch worth knowing before touching anything: the Railway service
named **`gos-whatsapp-main`** currently serves the account keyed
**`personal_test`**. Service name and account key do not agree, and any runbook
that assumes they do will point at the wrong bridge.

## 2. Finding — the `office` bridge is in a permanent pairing loop

`office` has **9,624 reconnect attempts** and has never once paired
(`phoneJid` null, `lastConnectedAt` null). Its bridge service has been spinning
since it was provisioned, burning a Railway service continuously to retry a
pairing that no one ever completed with a QR scan.

This is a live defect independent of the migration, and it is also the single
biggest practical risk to the migration: whatever number is chosen, the same
thing happens again unless a human scans the QR inside the pairing window.

**Recommendation:** set `active=false` on `office` until the moment of the
scheduled pairing, so the loop stops. This is a one-row change and fully
reversible.

## 3. Duplicate-sender exposure — currently NIL

The one thing that must never happen is two connected numbers sending on behalf
of the business. Measured exposure right now:

| Vector | State | Risk |
|---|---|---|
| Connected accounts | exactly **one** (`personal_test`) | none |
| Scheduled messages pending | **0** (5 sent, 5 cancelled) | none |
| Outbound idempotency keys | 51, all `personal_test` | none |
| Communication deliveries (whatsapp) | 2 total (1 sent, 1 failed_final) | none |
| Open CRM WhatsApp tasks | **3 open** | see below |
| Templates | 25, **not** account-bound | see below |

Two real caveats:

1. **Templates are not bound to an account.** They resolve their sender at send
   time, so they will follow whichever account the send path selects. They do
   not need migrating, but they also provide no protection against sending from
   the wrong number.
2. **3 open WhatsApp CRM tasks.** Each links 1:1 to a scheduled message. If the
   number changes while they are open, they fire from the new number — which is
   probably desirable, but it should be a decision, not a surprise.

## 4. What migrating actually means

WhatsApp identity is the **pairing**, not the row. Concretely:

- A `WhatsAppAccount` row is a stable key (`main`/`office`) plus its live
  connection state. Changing the number means re-pairing that key to a different
  handset, not editing `label`.
- `WhatsAppSession` holds Baileys auth state — **26,475 rows** for
  `personal_test`. It is per-pairing and must **not** be copied to another
  account; doing so would attempt to resurrect a session that belongs to a
  different device.
- `WhatsAppChat` is unique on `(accountId, externalChatId)`, so the same
  customer legitimately gets a separate thread per number. Threads do **not**
  merge across accounts, by design.

**Therefore history is not portable.** The 20,314 messages belong to
972524264020 and stay attached to it. There is no supported operation that
"moves" them to the business number, and inventing one would fabricate a record
of conversations that never happened on that number.

The honest plan is retention, not migration:

- keep `personal_test` as a **read-only historical archive** — `active=false`,
  bridge unbound, history fully browsable in the CRM (including the 34
  CRM-linked chats);
- pair the business number as a **new** account key;
- new conversations accumulate there from day one.

## 5. Prepared migration procedure (NOT executed)

Blocked at step 0: **the target number has not been named.**

| # | Step | Who | Reversible |
|---|---|---|---|
| 0 | Name the business number. If it is 972533083321, reuse the `office` key; if it is a third number, mint a new key (do **not** relabel `personal_test`). | Owner | — |
| 1 | `active=false` on `office` to stop the 9,624-attempt loop. | Operator | yes |
| 2 | Confirm 0 pending scheduled messages (measured 0 today; re-check at the time). | Operator | — |
| 3 | Point the target bridge service at the chosen account key in `WHATSAPP_BRIDGE_URLS`. | Operator | yes |
| 4 | Set the target account `active=true`; the bridge enters `qr_required`. | Operator | yes |
| 5 | **Scan the QR from the business handset, inside the pairing window.** | **Owner — manual, unavoidable** | — |
| 6 | Verify `status=connected` and `phoneJid` matches the business number. | Operator | — |
| 7 | Set `personal_test` `active=false` — the archive stops receiving, history is retained. | Operator | yes |
| 8 | Verify exactly ONE account has `status=connected`. | Operator | — |

Step 5 is the hard stop that was agreed in advance: pairing cannot be automated.

## 6. What is explicitly NOT part of this

- No message history is deleted, moved or rewritten.
- No chat is re-linked to a different contact.
- Templates are untouched (they are account-agnostic).
- The bridge itself never migrates schema — unchanged rule.
