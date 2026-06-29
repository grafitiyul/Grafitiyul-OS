# GOS — Deal Quote / Pricing — Product Questionnaire & Answers

> Companion to `GOS-deal-quote-pricing-spec.md`. Captures the product/business questions and
> their **decided** answers. Items still OPEN show the recommended default pending Dor's confirm.

## Final decisions already given by Dor (this pass)

- **D-A. Accepted ≠ WON.** An Accepted Quote = the commercial version the customer agreed to; it
  becomes the Deal's commercial source of truth and is the version later signed. Accepting does
  **NOT** auto-mark WON. WON is a **separate** action the user may take immediately after, or later.
- **D-B. Quotes are Business-only.** Business deals have the Quote workflow; **Private** and **Group**
  deals do **not**. The right-panel layout is **activity-type-driven** (future types can differ).
- **D-C. Two-card right panel.** Card 1 "פרטי הסיור" = **operational** (Product, City, **base tour
  price**, Date, Time, Participants, Activity Type, Tour Language, Important Customer Info, future
  operational fields). Card 2 "הצעה/הצעות מחיר" = **commercial, business-only** (Communication
  Language, Payment Terms, Payment Method, **new** Personal email intro, the Generate-Quote button,
  future selling tools).
- **D-E. Base tour price is operational (CLARIFIED by Dor).** The base calculated tour price is part
  of the operational definition of the tour, so it stays in the **Tour Details** card for **all**
  activity types. The Quote card is the commercial layer that adjusts/discounts/adds/communicates on
  top of it — it does not own the base price.
- **D-F. Email intro on QuoteVersion (CONFIRMED).** The personal email introduction belongs to the
  QuoteVersion (per-quote), with an optional Deal-level default.
- **D-D. Sent/delivery undecided (Q16).** No assumptions about how a quote is delivered. Quote status
  = `draft → produced → accepted/rejected`; delivery channel (email/WhatsApp/portal/e-sign) is a
  later, separate design.

## Questionnaire answers

| # | Question | Status | Answer / recommended default |
|---|---|---|---|
| Q1 | Auto-create a quote with every Deal? | OPEN | Default: **Business** deals start with one working draft; Private/Group start with none (no quote workflow). |
| Q2 | Meaning of "main quote" | OPEN | Default: "main" = the working draft shown in the commercial card (Business only). |
| Q3 | Multiple drafts at once? | OPEN | Default: **Yes** (alternatives) — Business only. |
| Q4 | Auto-name/number quotes? | OPEN | Default: auto number **+** optional nickname. |
| Q5 | Can a produced quote be edited, or only cloned? | **ANSWERED** | Produced/accepted are **immutable**; clone → new draft (history preserved). |
| Q6 | Meaning of "accepted quote" | **ANSWERED (D-A)** | Commercial source of truth + later signing. Separate from WON. |
| Q7 | Accept a different quote → what happens | **ANSWERED (D-A)** | It becomes accepted/main commercial truth; old versions preserved; **WON is a separate step**. |
| Q8 | WON without an accepted quote? | OPEN | Default: allow, but nudge to pick/accept a quote (Business). Private/Group: WON without a quote is normal. |
| Q9 | Invoice/registration/tour derive from…? | **ANSWERED (D-A)** | The **accepted** quote (frozen), never the open builder. |
| Q10 | If accepted quote ≠ live panel, which is money truth? | **ANSWERED (D-A)** | The accepted quote; panel edits create a new draft to re-accept. |
| Q11 | Settings price-list change → existing quotes? | **ANSWERED** | Existing stay frozen; explicit **"חשב מחדש / החל מחירון חדש"** to update. |
| Q12 | Open draft auto-updates on price change? | **ANSWERED** | No — stays until explicit recompute. |
| Q13 | Quote statuses | **ANSWERED (D-D)** | `draft → produced → accepted / rejected` (no `sent`/`expired` yet). |
| Q14 | "Valid until" expiry? | OPEN | Default: optional field, no auto-expiry yet. |
| Q15 | Which actions need confirmation? | OPEN | Default: confirm on delete-draft, accept/change-accepted, WON, "נקה טופס"; not on ordinary edits. |
| Q16 | Does "sent" mean emailed? | **ANSWERED (D-D)** | Deferred — delivery channel undecided; status uses neutral "produced". |
| Q17 | What shows in "פרטי הסיור" | **ANSWERED (D-C/D-E)** | Operational fields **incl. the base tour price** — see D-C/D-E. |
| Q18 | What each quote row shows | OPEN | Default: name/number · total · status · created date · language · ★ accepted · quick actions. |
| Q19 | Deal "agreed price" headline source | OPEN | Default: accepted version's total; fall back to working draft (Business). Private/Group: `valueMinor`. |
| Q20 | Discounts — line-level or whole-quote? | OPEN | Default: discount/credit **lines** only first; whole-quote % later. |
| Q21 | Can acceptance be reverted? | OPEN | Default: revert allowed while Deal is OPEN; locked once WON/LOST. |

## D-Price — RESOLVED

Where does **Price** live? **Resolved by Dor (D-E):** the base tour price is **operational** and lives
in the **Tour Details** card for all activity types (Group = ticket totals; Private = the base price;
Business = base price + a commercial Quote layer on top). No separate "minimal commercial line" needed.

## Still-open list (please confirm to finalize)

Q1, Q2, Q3, Q4, Q8, Q14, Q15, Q18, Q19, Q20, Q21. You can answer "defaults" to accept the recommended
defaults above, or list exceptions.
