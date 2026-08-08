# סוכן AI — operator-experience audit (2026-08-08)

Audited against the LIVE deployment, not from memory. Source:
`server/scripts/agent-ux-audit.local.mjs` (read-only).

## Live state at audit time

| | |
|---|---|
| `enabled` | **true** (turned on by the operator 12:38) |
| capabilities | 16 — **13 shadow, 3 disabled, 0 approval, 0 auto** |
| ceilings | 4 can reach auto, 11 cap at approval, 1 caps at shadow |
| knowledge | **0 items** |
| playbook | **0 rules** |
| style | 4 profiles, all `draft`, **all empty** |
| runs | 1 — and it **escalated** (escalation rate 100%) |
| proposals | 1, status `shadow` |
| eligible volume | ~8 private chats/day carry inbound text → ~8 runs/day |

**The single most important finding:** the agent is on, ran once, and said
"I don't know" — which is *correct* behaviour with zero approved knowledge, but
nothing in the UI tells the operator that, or that it is their move.

## 1–2. Screens and what each controls

| Screen | Controls | Kind |
|---|---|---|
| סקירה (index) | nothing | **monitoring only** |
| לאישור | proposal decisions (send/edit/reject) | action |
| ידע | Knowledge, Playbook, Style rows + approval | **configuration — changes behaviour** |
| למידה | insight review → creates *drafts* | configuration, gated |
| הרשאות | capability modes, settings, kill switch | **configuration — highest impact** |
| היסטוריה | nothing | **monitoring only** |

## 3. Fields that actually change agent behaviour

- `AgentSettings`: `enabled`, `model`, `effort`, `recentMessageCount`,
  `maxMessageAgeMinutes`, `maxRunsPerSweep`, `includeGroups`
- `AgentCapabilityState`: `mode`, `conditions`
- Knowledge / Playbook / Style rows **only while `status='approved'`**

Everything on סקירה and היסטוריה is derived; editing nothing there changes behaviour.

## 4. Monitoring-only surfaces
סקירה, היסטוריה, and the evidence panes inside למידה.

## 5. Required before Shadow produces anything useful
Nothing is *technically* required — and that is the trap. With 0 knowledge and
empty style the agent can only escalate (proven: 1/1 run escalated). Practical
minimum: **one approved Style profile for the sending language + a handful of
approved Knowledge items**.

## 6. Safe to leave empty
Playbook (the agent answers plainly and escalates judgement calls), capability
`conditions`, and the English profiles if there are no English leads.

## 7. What the operator sees right after enabling
The סקירה dashboard: a green "פעיל" banner and a grid of zeros. No indication
of what to do, what is missing, or that the one run escalated. **This is the
defect.**

## 8–9. Where proposals and insights surface
Proposals: the לאישור tab, and inside the WhatsApp conversation (a collapsed
one-line strip for shadow records). Insights: the למידה tab, but **only after
pressing "חפש תובנות חדשות"**, and only once ≥5 handled proposals exist for a
capability — so the tab reads as permanently empty and unexplained.

## 10–11. How configuration is created
Knowledge/Playbook: inline forms, always created as `draft`, require explicit
approval. Style: four fixed profiles keyed by (language, audience), nine raw
fields each, no explanation of what a profile *is*. Capability modes: four
buttons per row, ceiling-exceeding options rendered disabled.

## 12. Onboarding state derivable from the DB — all of it
`enabled`; counts of approved knowledge/playbook; whether any style profile is
approved *and* non-empty; run/proposal counts; escalation reasons; capability
mode distribution; whether any executable write tool sits above `approval`.
**No completion flags need to be stored.**

## Diagnosis

The module exposes its architecture. Six tabs named after database concepts, a
dashboard of zeros as the landing page, no statement of what is safe, no
statement of what is missing, and no next action. Everything needed to guide the
operator is already in the database — it is simply never projected.

## Fix (UX only — no schema, no new models, no second execution path)

1. Replace the landing dashboard with a **Home** that states status, safety,
   what needs attention today, and what the agent is missing.
2. Add a **guided setup** route (not a blocking wizard) covering concepts →
   style → knowledge → start observing.
3. Explain Knowledge vs Playbook vs Style **inside** the screens that own them.
4. Group the 16 capabilities, show readiness evidence inline, and state what
   changes when a mode is changed.
5. Real empty states everywhere, describing actual behaviour.
