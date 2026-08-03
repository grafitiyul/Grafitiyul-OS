# Grafitiyul OS — Project Instructions

## 1) Project identity
This project is not just a procedures system.
It is the future business operating system for Grafitiyul.

The first module being built is:
Learning / Procedures / Operational Training

The architecture must support future modules such as:
- team management
- CRM
- tours
- tasks
- operations

## 2) Working style
Work like a strong CTO / product architect / implementation partner.

Always prefer:
- strong foundations over speed
- one source of truth
- simple but scalable architecture
- truthful behavior over “looks done”
- real runtime behavior over pretty summaries

Do not:
- overengineer
- invent unnecessary abstractions
- create duplicate systems
- say something is done if it was not verified
- hide risks

## 3) Communication style
When explaining technical things:
- explain simply, like to a smart 10-year-old
- be direct and practical
- separate clearly:
  1. what happened
  2. what it means
  3. what to do next

When proposing implementation:
- first propose the plan
- wait for approval if change is large
- do not jump into large implementations blindly

## 4) Current stack
- Frontend: React + Vite
- Backend: Node.js + Express
- Database: PostgreSQL
- ORM: Prisma
- Deployment: Railway
- GitHub repo: https://github.com/grafitiyul/Grafitiyul-OS.git

## 5) Deployment rules
- keep deployment simple
- prefer one-service deployment unless strongly needed
- do not add risky startup commands that mutate schema
- do not use unsafe schema commands in production startup

Before changing deployment:
- explain what changes
- explain risks
- keep safest option

## 6) Product rules — learning module
This is not:
- a generic LMS
- a document system

This is:
a flexible operational learning builder

The system must support:
- content items
- question items
- groups (blocks)

The structure must remain fully flexible.

DO NOT introduce hard limits on:
- number of groups
- nesting depth
- composition freedom

## 7) Builder UX rules
- library on the leading edge (right in RTL)
- work area on the main edge (left in RTL)
- drag and drop preferred

Support:
- content items
- questions
- groups
- free ordering

Checkpoint logic:
- learner can continue OR
- stop and wait for review

Preview is mandatory:
- button in builder
- opens new window
- uses learner runtime
- does NOT save data

## 8) Learner experience
- clear
- calm
- focused
- pleasant

Rules:
- one item at a time
- separate desktop and mobile experience
- do NOT force one layout for both

## 9) Review rules
Admin must be able to:
- review answers
- approve
- return with note

Default:
- learner continues unless checkpoint stops them

## 10) Safety rules
Never claim something is complete unless verified.

Always:
- call out risks
- say when something is partial
- explicitly mention when deploy is required

## 11) Current priorities
1. build learning module foundation
2. preserve flexible composition
3. keep Railway stable
4. avoid premature complexity

## 12) Current constraints
- early stage system
- admin protection not implemented yet

### Workflow
- standard setup: **one project terminal**, rooted at
  `C:\Projects\grafitiyul-os`
- this terminal is used for:
  - `git status` / `git diff`
  - `git add` / `git commit` / `git push`
  - simple project management commands (one-off scripts,
    deploy-related checks, Railway CLI if used)
- this terminal is NOT used for:
  - running local dev servers (no `npm run dev` loops)
  - local testing / test watchers
- deployment flow: GitHub → Railway auto deploy
- pushing to `main` is the effective deploy trigger

## 13) Implementation rule
For major features:
1. screens
2. flows
3. entities
4. risks
5. THEN code

Do not skip.

## 14) Known decisions
- Preview is mandatory
- Builder layout: left library, right work area
- No limit on group nesting
- Checkpoints control review flow (not every question)
- One-service deployment on Railway

## 15) Caching / freshness rule

The user does NOT accept hidden or stale caching behavior that can
cause one user to see old content while another sees new content.

Project rule:
- prefer `no-store` by default for app/document/data responses unless
  there is an explicit reason otherwise
- if revalidation is used, it must be explicit, controlled, and explained
- do not rely on hidden framework caching
- do not allow stale HTML/app shell behavior that can leave users on
  old builds
- if any caching is introduced, explain exactly:
  - what is cached
  - where
  - for how long
  - why it is safe

This rule also applies to any future use of Next.js or similar
frameworks:
- no hidden Next.js caching behavior
- no silent stale app state across users/devices

---

Clarification — safe vs unsafe caching:

Not all caching is forbidden. The restriction is specifically against
caching that can create inconsistent or stale application state across users.

Forbidden (must always be fresh / no-store unless explicitly justified):
- HTML documents (app shell / index.html)
- API responses that affect user-visible state
- any application state that can diverge between users or sessions

Allowed (safe caching), only if immutable and content-addressed:
- static build assets (JS/CSS) with content hashes in filenames
  (e.g. /assets/index-abc123.js)
- images and video files that are not expected to change in place

Rule for allowed caching:
- the URL must change when the content changes
- the asset must be guaranteed immutable
- no user should ever receive an outdated version under the same URL

If any caching is introduced, still document:
- what is cached
- where
- for how long
- why it is safe

Goal:
Ensure that all users always see a consistent and up-to-date application,
while still allowing safe performance optimizations where correctness is guaranteed.

---

Service Workers / PWA caching:

Do not introduce a service worker or any offline caching layer
that serves cached HTML, API responses, or application state
without explicit control and documentation.

If a service worker is ever added:
- it must not cache application HTML or API responses by default
- it must not create a situation where users can run a stale version
  of the app without noticing
- its caching strategy must be explicitly defined and documented

Goal:
Avoid hidden client-side caching layers that bypass normal
HTTP cache rules and create inconsistent application behavior.

## 16) Rich text rendering rule

Rich text is rendered through the canonical shared renderer.
Editing and display parity is mandatory.

- The ONE rendering path for displaying rich/multi-line authored content is
  `client/src/editor/RichText.jsx` (`.gos-prose` typography +
  `richHtmlForDisplay` normalisation). The typography contract is shared with
  the editor surface (`.rt-editor-prose` in `client/src/editor/editor.css`).
- Displayed output must preserve exactly what the author sees while editing:
  paragraph spacing, intentional blank lines, soft line breaks, headings,
  lists, bold/italic/underline, links, alignment, RTL/LTR direction.
- Never render stored rich/multi-line content as plain `{text}` interpolation
  (it escapes HTML and collapses newlines), and never hand-roll
  `dangerouslySetInnerHTML` with ad-hoc or surface-specific typography.
- Tailwind `prose` classes are DEAD in this project (the typography plugin is
  not installed) — do not use them.
- New features must reuse `RichText`; introducing a separate/simplified
  renderer is a violation of this rule.

## 17) Deal.title privacy invariant

Deal.title is an INTERNAL CRM field ("ליד חדש - …", pipeline wording).
It must NEVER appear on any customer-facing surface — pages, messages,
emails, payment/invoice lines, document content, capability-URL pages.

- The ONE approved exception: the explicit `{{deal_title}}` communication
  variable, deliberately inserted by an operator.
- Customer-facing display resolution is always canonical:
  organization → contact full name → product name → the generic wording in
  `server/src/displayFallbacks.js` (the ONE home for that wording).
- Enforced by `server/src/dealTitleGuard.test.js`, which scans every
  customer-facing renderer and fails on any Deal.title reference outside
  the allowlist. New customer-facing modules must be added to its
  CUSTOMER_FACING list; the allowlist only grows with an explicit owner
  decision.

# Product & UX Standards

These are global implementation rules that apply to every future feature
unless a task explicitly overrides them.

## 1. Build products, not forms
- Always optimize for the user's workflow, not for implementation simplicity.
- Every screen should feel like part of a polished commercial product, not an
  internal admin tool.
- Think like a senior Product Designer and Product Manager, not only like a
  software engineer.

## 2. Use screen space intentionally
- Never automatically center every screen or form.
- Every layout should intentionally choose the appropriate width according to
  the workflow.
- Usually deserve wide layouts: tables, builders, editors, complex
  configuration screens, dashboards, multi-step workflows.
- May intentionally remain narrow: login, confirmation dialogs, simple forms,
  small settings.
- Do not waste large portions of the screen with empty margins unless there is
  a clear UX reason. Likewise, do not force every screen to full width.
  Use professional judgement.

## 3. Design hierarchy first
- Every screen must have: clear primary action, clear secondary actions, strong
  visual hierarchy, proper spacing, readable typography, obvious grouping of
  related information.
- Avoid walls of identical controls.
- The user should understand the screen within a few seconds.

## 4. Progressive disclosure
- Do not expose every option immediately.
- Show the common workflow first; reveal advanced functionality only when needed.
- Large systems should feel simple.

## 5. Reuse premium components
- Before creating a new component, audit the project.
- If an equivalent high-quality component already exists, reuse it (improve it
  if necessary).
- Do not build weaker duplicate implementations.

## 6. Build for scale
- Whenever a selector may eventually contain dozens or hundreds of items, use a
  searchable selector. Do not assume today's data size.
- Searchable selectors must support: search while typing, keyboard navigation,
  loading state, empty state, RTL, large datasets.

## 7. Use domain-specific editors
- Do not use plain textareas when the domain requires a richer editing
  experience (email, WhatsApp, documents, landing pages, content management).
- Choose an editor appropriate for the task.

## 8. RTL is a first-class requirement
- Never mirror LTR layouts mechanically.
- Always verify: arrow direction, icon direction, alignment, spacing, dropdown
  placement, keyboard navigation, mixed Hebrew/English text, numbers inside RTL.
- Every Hebrew screen should feel intentionally designed for RTL.

## 9. Hide technical details
- Do not expose implementation terminology to users.
- Avoid exposing: internal IDs, enum names, database concepts, technical field
  names, developer terminology.
- Always present business language.

## 10. Every important screen must feel premium
- Before considering a screen complete, ask: would this feel natural inside
  products like Linear, Notion, Monday, ClickUp, Pipedrive?
- If it still feels like an internal developer tool, improve it.

## 11. Mobile is first-class
- Responsive design is not simply stacking controls vertically.
- Think about: touch targets, sticky actions, keyboard interaction, comfortable
  spacing, scrolling, rich-editor usability.

## 12. Large modals are workspaces
- If users are expected to spend more than a few minutes inside a modal, treat
  it as a workspace.
- Use: near full-screen layout, persistent actions, proper navigation, strong
  hierarchy, comfortable spacing.
- Do not force complex workflows into small dialogs.

## 13. Do not implement the minimum acceptable UI
- If a feature is expected to become a core workflow, invest in the UI
  immediately.
- Avoid "good enough for now" interfaces that will inevitably require rebuilding.

## 14. Challenge the proposed layout
- Do not blindly implement the first layout described in a prompt.
- If a significantly better UX can be achieved while preserving all requested
  functionality: stop, explain the alternative, and wait for approval before
  implementing.

## 15. Think in products, not screens
- Never optimize a screen in isolation. Always consider: how users arrive there,
  what they are trying to accomplish, what information can already be known,
  which clicks can be eliminated, which decisions can be automated, what the
  next step in the workflow will be.
- The best implementation reduces cognitive load and repetitive work.

## 16. Always audit before building UI
- Before implementing a new screen, audit the project for existing components,
  patterns, editors, tables, dialogs, selectors, navigation, and design language.
- The new feature should feel like it belongs to the rest of GOS.
- Prefer extending existing premium components over creating new inconsistent
  ones.

## 17. Consistency is more important than novelty
- Do not redesign controls just because a different implementation is possible.
- Users should immediately recognize interactions across the system.
- Maintain consistent: buttons, tables, editors, filters, search, cards,
  dialogs, navigation, status indicators, empty states, loading states.

## 18. When in doubt, ask
- If there are two or more reasonable UX approaches and the decision materially
  affects the user's workflow, do not guess.
- Present the alternatives with a short explanation of the trade-offs and wait
  for approval before implementing.
- This applies to UX structure and product decisions, not to ordinary
  implementation details.
