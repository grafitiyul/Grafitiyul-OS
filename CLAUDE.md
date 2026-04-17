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
- library on LEFT
- work area on RIGHT
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
