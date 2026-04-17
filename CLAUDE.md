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
