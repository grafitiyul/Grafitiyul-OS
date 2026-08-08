# סוכן AI — Architecture (2026-08-08)

The AI WhatsApp Agent. Not "an AI that answers WhatsApp" — a controlled operational
agent whose reasoning is grounded in canonical GOS data, approved knowledge,
approved playbooks, approved style, real conversation context, and explicitly
granted permissions.

**V1 ships in SHADOW. No message is sent and no business write happens without an
explicit human action.**

---

## 1. What the audit found (the architecture we must fit into)

| Area | Finding | Consequence for this module |
|---|---|---|
| WhatsApp ingest | The **bridge is a separate Railway service** with its own Prisma client. It writes `WhatsAppMessage`/`WhatsAppChat` directly and holds no CRM logic by design. | The agent **cannot** hook ingest in-process. It must watch the mirror from the GOS server — exactly the pattern `whatsapp/activitySweep.js` already established ("WHY A SWEEP AND NOT A HOOK"). We copy that pattern. |
| Customer sends | `whatsapp/customerQueue.js#enqueueCustomerWhatsApp` is THE way a server-initiated message reaches a customer. It owns sending windows, disconnection deferral, retries, pacing, delivery logging. | The agent **never** touches Baileys or `send.js`. Any future send goes through this one function. |
| Account selection | `senderAccount.js#resolveSendAccount` throws on ambiguity rather than guessing. | Inherited for free by using the queue. |
| Existing LLM use | Only `communication/translate.js` — `@anthropic-ai/sdk`, `ANTHROPIC_API_KEY` (server-only), `output_config.format` json_schema, mechanical post-validation of the result. | Same SDK, same key, same "validate the model's output mechanically" discipline. Generalised into a narrow provider boundary. |
| Trigger context | `communication/context.js#loadTriggerContext` is the ONE include tree for deal/contact/org/tour/payment/quote/owner/links. | The Context Pack **projects** this loader; it does not re-derive a second context. |
| Registries | `control/registry.js`, `reviewItems/registry.js`, `automations/registry.js`, `shell/moduleRoutes.js` all follow: **code owns identity, DB owns operator-controlled state**. | Capabilities and tools are code definitions; only the *mode* lives in the DB. |
| Realtime | `realtime/sse.js` — channelised SSE, invalidation hints only. | Reused for "a new proposal arrived". |
| Nav | Adding a module = one entry in `client/src/shell/moduleRoutes.js`. | `ai-agent` added there. |
| Deal.title | `dealTitleGuard.test.js` fails on any `deal.title` reference inside a customer-facing renderer. | `server/src/agent` is a **customer-facing text generator** → added to `CUSTOMER_FACING`. |
| Prisma blind spot | `*.prismaShape.test.js` walk selects against the generated DMMF because a stub suite stays green while a bad select 500s production. | Every agent select gets a DMMF contract test. |

---

## 2. Core decisions

### D1 — The trigger is a sweep, not a hook
A 60s claim-based sweep in the GOS server reads `WhatsAppMessage` rows created
since a watermark, reduces them to **one newest eligible inbound message per
chat**, and runs at most N chats per pass. Idempotency is structural: a unique
`(chatId, triggerMessageId)` on `AgentRun` means re-seeing a message can never
produce a second run. No bridge deploy is ever needed to change agent behaviour.

### D2 — Authority is per-capability, never a global boolean
`agent/capabilities/registry.js` defines capabilities in code
(`meeting_point_question`, `pricing_discussion`, `discount_request`,
`refund_request`, …), each with `kind`, `risk`, `defaultMode` and — critically —
`maxMode`. `AgentCapabilityState` stores only the operator's chosen `mode`
(`disabled | shadow | approval | auto`) plus optional conditions. A capability
whose `maxMode` is `approval` **cannot be set to auto from the UI or the API** —
that is a code-level ceiling, not a config value.

There is one global switch and it is deliberately *not* an authority control:
`AgentSettings.enabled` is an operational kill switch for **analysis**. Turning it
on grants no authority to anything.

### D3 — Config versioning is content-addressed snapshots
Rather than three parallel version tables, the active configuration (approved
knowledge + playbook + style + capability modes) is hashed and frozen into
`AgentConfigSnapshot`. Every `AgentRun` carries `configSnapshotId`. Same config →
same hash → one row reused. This answers "what rules were active when this
historical response was generated" with one FK, forever, and makes
disable/archive (never delete) safe: the snapshot holds its own frozen copy.

### D4 — Three separate concepts in the learning loop
`AgentProposal` (RAW EVIDENCE: what was proposed vs what was actually sent) →
`AgentInsight` (PROPOSED INSIGHT, human-reviewed) → Knowledge/Playbook/Style
(APPROVED RULE). Nothing crosses a boundary without a human action. `proposedText`
is immutable; `finalText` is a separate column. An edit never overwrites the
original — we need both for evaluation.

### D5 — Guards live in code, after generation
`agent/guards.js` runs mechanical checks on every draft: Deal.title leak, invented
price, payment/booking claims contradicted by canonical state, raw `{{token}}`,
foreign phone/email, non-allowlisted URL. A guard hit **downgrades the proposal to
an escalation with a stated reason**. It never silently rewrites and never passes.

### D6 — The AI never writes to Prisma
Tools are declared in `agent/tools/registry.js` with a schema, risk, read/write
class, human-readable preview and an `invoke` that calls a **canonical application
service**. V1 wires exactly one write tool (`create_followup_task` →
canonical task creation), gated at `approval` with `maxMode: 'approval'`.

### D7 — Escalation is a successful outcome
"I don't know", "the data conflicts", "this is outside my authority" are recorded
outcomes with reasons, not failures. They are the primary signal for what
knowledge is missing.

---

## 3. Data model (all additive)

```
AgentSettings           singleton: enabled, model, effort, eligibility knobs
AgentCapabilityState    key → mode (+ conditions). Code owns the definition.
AgentKnowledgeItem      title, body, category, language, scope, status
AgentPlaybookRule       title, whenText, thenText, category, priority, scope, status
AgentStyleProfile       key, language, audience, rules(JSON), status, isDefault
AgentConfigSnapshot     hash(unique), payload(JSON) — frozen active config
AgentRun                trigger, status, chat/message/contact/deal, mode, provider,
                        model, promptVersion, configSnapshotId, contextSources,
                        latency, tokens, intent, escalate+reason, error
AgentProposal           runId, kind, capabilityKey, proposedText(IMMUTABLE),
                        proposedActions, status, finalText, handledBy/At,
                        staleness fingerprint, idempotencyKey(unique)
AgentInsight            category, title, proposedChange, evidence, status, review
```

Nothing is hard-deleted: knowledge/playbook/style/insights archive, so historical
run provenance stays readable (§28).

---

## 4. Information architecture — `/admin/ai-agent` ("סוכן AI")

Six screens, not ten. Knowledge + Playbook + Style are one area because they are
one thing to the operator ("what the agent is made of"); Evaluation is split
between the dashboard (headline quality) and history (per-run truth).

| Route | Hebrew | Purpose |
|---|---|---|
| `/admin/ai-agent` | סקירה | State in seconds: mode, volume, accept/edit/reject rates per category, what needs attention, what could safely be automated. |
| `/admin/ai-agent/review` | לאישור | Proposals awaiting a human + escalations. Keyboard-efficient. |
| `/admin/ai-agent/knowledge` | ידע | Segmented: עובדות (knowledge) · שיטת עבודה (playbook) · סגנון (style). |
| `/admin/ai-agent/learning` | למידה | Insight inbox with evidence. Approve / edit / reject. |
| `/admin/ai-agent/authority` | הרשאות | Capability matrix + settings + kill switch. |
| `/admin/ai-agent/history` | היסטוריה | Every run: trigger, status, latency, model, provenance, proposal, outcome. |

Daily work stays in the WhatsApp inbox. The module is for **management**.

---

## 5. WhatsApp inbox integration

One compact card above the composer in `ChatThread`, rendered only when a proposal
exists for the open chat:

- intent/category chip + the proposed text
- **שלח · ערוך · דחה** (edit seeds the canonical draft store `whatsapp/drafts.js`,
  which the real `ChatComposer` already reads — no second composer, no new send path)
- **למה?** opens provenance: which context sources, which knowledge/playbook/style
  versions, which deal/tour — never chain-of-thought
- stale state rendered explicitly; a stale proposal's send action is disabled

In SHADOW the card is read-only and labelled "צל — לא נשלח".

---

## 6. Safety posture for V1

- default `AgentSettings.enabled = false` — nothing runs until an operator turns it on
- every capability ships at `shadow` (or `disabled` for the never-auto family)
- no automatic send anywhere in the code path; the send action requires an explicit
  authenticated POST carrying the proposal id
- proposals carry a staleness fingerprint; a stale proposal cannot be sent
- `idempotencyKey` unique → two operators approving the same proposal produce one send
- AI failure degrades to a recorded `failed` run. WhatsApp is untouched.
- groups, outbound messages, system/status traffic and non-text messages are
  ineligible in V1
