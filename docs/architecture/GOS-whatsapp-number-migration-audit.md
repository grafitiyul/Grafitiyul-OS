# WhatsApp — business-number migration

**Status:** infrastructure COMPLETE and deployed. **Blocked on two QR scans, then
the post-pairing checklist in §1 — which is REQUIRED before the migration counts
as done.**

Supersedes the 2026-07-29 pre-purge audit (that document described
`personal_test` as connected and `office` as loop-failing; both statements are
now historical).

**Last updated:** 2026-07-30

---

## 1. ⛔ REQUIRED AFTER PAIRING — do not close the migration without this

Group destinations could not be pre-configured: the destination chats live on the
WhatsApp accounts themselves, so they do not exist until the numbers pair and
group sync completes. All 16 report configs were re-pointed to the `office`
account, and the 10 dead group ids were **cleared on purpose** so dispatch writes
an auditable *"לא הוגדר יעד"* skip rather than failing against an id that no
longer resolves.

- [ ] **Pair `main`** — `מספר ראשי (0556638970)` on `gos-whatsapp-main`
- [ ] **Pair `office`** — `מספר משרד (0533083321)` on `gos-whatsapp-office`
- [ ] **Wait for group sync** to finish on both accounts before touching reports
- [ ] **Re-select the 10 manager-report group destinations** in ואטסאפ → דיווחים
      (reports #1–#10; each needs its internal group picked again)
- [ ] **Verify every report resolves to the CORRECT new group** — not merely a
      non-empty one. A wrong-but-populated destination is the failure mode here,
      and it looks identical to success on the config screen.
- [ ] **One end-to-end test send per report family**, using the built-in test-send
      dialog:
      - [ ] group-destination family (reports #1–#10)
      - [ ] per-guide family (reports #11–#16 — `waChatId` stays null by design;
            these resolve a guide's own number)
- [ ] **Confirm reports #11–#16 need no group** and are not mistakenly given one
- [ ] **Confirm no send used the wrong account** — check each delivery row's
      `waAccountId` reads `office`

Only when every box above is ticked is the number migration complete.

### Why this cannot be automated

The group ids are created by WhatsApp, discovered by group sync, and chosen by a
human who knows which internal group each report belongs in. GOS can verify a
destination is *set*; it cannot verify it is the *right* one.

## 2. Final production state (deployed, verified 2026-07-30)

| | **gos-whatsapp-main** | **gos-whatsapp-office** |
|---|---|---|
| `WHATSAPP_ACCOUNT_ID` | `main` | `office` |
| `WHATSAPP_ACCOUNT_LABEL` | `מספר ראשי (0556638970)` | `מספר משרד (0533083321)` |
| `BRIDGE_DISABLED` | removed | removed |
| Vars containing "test" | none | none |
| Account row | active, `qr_required` | active, `qr_required` |

`WHATSAPP_BRIDGE_URLS = main=…,office=…`

The `personal_test` account and all 48,834 of its rows were removed (owner
decision, reaffirmed after the evidence was presented). Contacts were **not**
deleted — chats are link-only, so all 20,460 survive with the link gone.

## 3. Sender-account ownership — no global default

`WHATSAPP_SYSTEM_ACCOUNT` is deliberately **unset and unused**. A single global
sender is too coarse: different autonomous messages belong to different business
domains, so each owns its own explicit account.

| Send family | Canonical owner of the account | Frozen where |
|---|---|---|
| Manager reports #1–#10 | `AdminReportConfig.waAccountId` → **office** | `AdminReportDelivery.waAccountId` at fire time |
| Guide/staff notifications #11–#16 | `AdminReportConfig.waAccountId` → **office** | same |
| Customer-facing automations | `CommunicationMessage.waAccountId` — **required at publish** | `CommunicationDelivery.recipientSnapshot` |
| Scheduled WhatsApp | `WhatsAppScheduledMessage.accountId` — frozen at scheduling | the row itself |
| Operator-initiated (deal sends, control notifications) | the operator's explicit selection, remembered globally per user | — |
| Inbox / composer / templates | the chat's own account | — |

An unresolvable sender **fails loudly**: 409 with the candidate accounts for
operator paths, an auditable skip row for reports, a publish-time validation
error for automations. Nothing guesses.

## 4. Why history was not portable

WhatsApp identity is the **pairing**, not the row. `WhatsAppSession` holds
Baileys auth state per pairing, and `WhatsAppChat` is unique on
`(accountId, externalChatId)` — so the same customer legitimately gets a separate
thread per number and threads never merge across accounts. There is no supported
operation that "moves" a conversation to a different number, and inventing one
would fabricate a record of conversations that never happened on it.

## 5. What is explicitly NOT part of this

- The bridge never runs migrations (the GOS server owns `prisma migrate deploy`).
- Templates are account-agnostic and were not migrated.
- No message history was moved or rewritten.
