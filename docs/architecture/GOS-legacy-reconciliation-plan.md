# GOS — Legacy ↔ Phase-0 Reconciliation Plan

**Status:** Decision proposal only. No schema change, no migration, no runtime code.
**Purpose:** Decide how the **live** schema concepts evolve into the Phase-0 GOS models
**without ever creating two writers for the same concept.**
**Last updated:** 2026-06-24

> Governing rule (from the architecture): single ownership with an explicit sync direction at
> every moment. During any transition, exactly one table is the writer; the other is a reader.

---

## 0) The most important correction up front

The mapping is **not** 1:1, and one assumption in the task framing is wrong:

- **`TeamRef` is NOT `TeamMember`.** `TeamRef` is a **team (a group of people)**; `TeamMember` is
  an **individual person**. Phase-0 never modeled a team-*group* entity, so `TeamRef` has **no**
  Phase-0 counterpart to collide with — it is kept and later renamed `Team`.
- **`PersonRef` is NOT `Contact`.** A guide is an **internal** person (`TeamMember`). `Contact` is
  an **external** customer. Mapping `PersonRef → Contact` would be a category error. `Contact` is
  **greenfield** — nothing in the live schema maps to it.
- So the real reconciliations are only two: **`PersonRef`/`PersonProfile` → `TeamMember`**, and
  **`AdminUser` → `User` + `Role`/`Permission`**.

---

## 1) PersonRef / TeamRef / PersonProfile

### PersonRef
- **Currently represents:** a guide's identity + portal access + learning-assignment handle. It
  already implements the recruitment **mirror→flip** pattern (`identitySource` =
  `recruitment` | `management`).
- **Currently owns:** `externalPersonId` (the stable cross-system handle), `displayName`, `email`,
  `phone`, `status`, `portalToken` + `portalEnabled` (guide portal auth), `lifecycleHint`,
  access timestamps, and the link to `TeamRef`. It is referenced by `FlowTargetPerson.personRefId`
  (FK) and by `Attempt.externalPersonId` (loose, by stable handle).
- **Future owner of the concept:** **`TeamMember`** owns *person identity*. But identity is only
  *part* of what PersonRef does — it also owns **portal access** and **learning assignment**, which
  Phase-0 `TeamMember` does **not** cover.
- **Decision: C → narrow (retain, demote, link). LOCKED responsibility split:**
  - **`TeamMember` owns internal person identity:** name, phone, email, employment/guide status,
    payroll-relevant data, and the guide profile.
  - **`PersonRef` remains temporarily responsible for** the learning/portal runtime only:
    `portalToken`, `portalEnabled`, flow targeting (`FlowTargetPerson`), attempt linkage
    (`Attempt.externalPersonId`), `lifecycleHint`, and any other portal/learning runtime links.
  - **`PersonRef` links to `TeamMember` via a nullable `teamMemberId`.** It becomes a
    portal/learning binding record that *points at* a TeamMember — not an identity owner.
  - **`PersonRef` must NOT become `Contact`.** `Contact` is **external customer** identity and
    stays greenfield; a guide is never represented as a Contact.
- **Safest migration path:**
  1. Create `TeamMember` (new UUID v7 ids — per the locked rule, **not** derived from
     `externalPersonId`).
  2. Backfill one `TeamMember` per PersonRef; set `TeamMember.recruitmentExternalId =
     PersonRef.externalPersonId`.
  3. Add `PersonRef.teamMemberId` and populate it. PersonRef identity fields become a **read
     mirror** of TeamMember (TeamMember is now the writer).
  4. Leave `FlowTargetPerson` / `Attempt.externalPersonId` untouched — they keep resolving through
     PersonRef, so the **running portal and learning data never break**.
- **Must not be duplicated:** person identity (name/email/phone/status) — once TeamMember is the
  writer, PersonRef must stop being written for those fields. `externalPersonId` must remain
  resolvable; never orphan it.
- **Production risk if wrong:** the guide portal is token-gated on `PersonRef.portalToken`
  (this is the exact mechanism that loads "Elinoy"). Break PersonRef or its references and **every
  guide's portal link 404s**, including PWA installs that baked the token into `start_url`. Orphaned
  `externalPersonId` silently detaches attempts/assignments from people.

### TeamRef
- **Currently represents:** a **team / group** of guides, managed natively in GOS (recruitment is
  explicitly *not* its source of truth).
- **Currently owns:** `displayName`, `meta`, membership (via `PersonRef.teamRefId`), and flow
  targeting (`FlowTargetTeam`).
- **Future owner:** a GOS **`Team` (group)** entity — a concept Phase-0 has not yet specified.
- **Decision: A — evolve.** Keep it; later rename to `Team` and fold into the Operations/Team
  domain as the group model. No collision, no duplicate.
- **Safest path:** no migration now. When a `Team` group model is specified, rename in place and
  re-point `PersonRef.teamRefId` → `TeamMember`-membership as appropriate.
- **Must not be duplicated:** team-group identity. Do not invent a second "team" table later —
  TeamRef is it.
- **Production risk if wrong:** low now; a duplicate team model later would split membership and
  flow-targeting across two tables.

### PersonProfile
- **Currently represents:** operational/management-owned data for a guide (1:1 with PersonRef).
- **Currently owns:** `imageUrl`, `description`, `notes`, **`bankDetails`** (payroll PII).
- **Future owner:** **`TeamMember`** (identity + operational), with `bankDetails`/pay data living on
  the TeamMember side as sensitive PII.
- **Decision: B — map, then retire.** Migrate its fields onto `TeamMember` (or a thin
  `TeamMemberProfile` if we want to keep the identity/operational split structural). Retire
  PersonProfile once moved.
- **Safest path:** migrate fields alongside the PersonRef→TeamMember backfill; keep PersonProfile as
  a read mirror until verified, then drop.
- **Must not be duplicated:** `bankDetails`/pay data — exactly one owner (TeamMember). Two copies of
  bank details is both a correctness and a privacy hazard.
- **Production risk if wrong:** leaking or diverging sensitive payroll/bank PII across two tables.

---

## 2) AdminUser vs User / Role / Permission

### AdminUser
- **Currently represents:** an internal admin login. Drives the **bootstrap rule** (zero active
  admins → `/admin` setup is open; one+ → login required) enforced in `auth.js`.
- **Currently owns:** `username` (login handle — **not email**), `passwordHash` (scrypt
  `salt:key`), `role` (string, default `admin`), `isActive` (soft-delete flag), `lastLoginAt`.
- **Future owner:** **`User`** owns the login principal; **`Role`/`Permission`** own authorization;
  the `admin` role becomes a seeded `Role` linked via `UserRole`.
- **LOCKED — login handle:** `User` keeps **username as the primary login handle** (matching
  today's AdminUser behavior) with an **optional `email`**. We deliberately do **not** migrate
  admins from username to email during this migration — changing the login identity at the same
  time as the table cutover would compound production auth risk. Email becomes the login identity
  only in a later, separate, opt-in step if ever.
- **Decision: B + C → D.** Map AdminUser → User/Role, keep AdminUser as a **legacy mirror** until
  the auth cutover is verified, then retire it.
- **Safest migration path:**
  1. Create `User`, `Role`, `Permission`, `UserRole`, `RolePermission`; seed the `admin` role and a
     coarse permission set (`own`/`all`).
  2. Backfill one `User` per active AdminUser, carrying `passwordHash` verbatim (the scrypt string
     is compatible) and a `UserRole → admin` link.
  3. **Auth still reads/writes AdminUser** (no behavior change yet). User is a read mirror.
  4. In a **separate, later** code change, switch `auth.js` to read `User` + role — and re-express
     the **bootstrap count** as "active Users holding the admin role." Verify on a scratch DB.
  5. Flip writer to User; retire AdminUser.
- **Must not be duplicated:** admin credentials and the **bootstrap count**. Two live auth sources
  (AdminUser *and* User both accepting logins) is a security hole.
- **Production risk if wrong — highest in this document:**
  - **Auth bypass:** if the bootstrap count is computed wrong post-migration (e.g. it reads a table
    with zero rows), `/admin` setup **re-opens in production** and anyone can create an admin.
  - **Lockout:** mis-migrated `passwordHash` or username handle → no one can log in.
  - **Username vs email mismatch:** RESOLVED — `User` keeps **username** as the login handle and
    `email` is optional (see LOCKED note above). No handle migration occurs, so this risk is
    removed.

### Bootstrap / setup rule (safe condition — LOCKED, design only)

The legacy rule is "zero **active** admins → `/admin` setup is open; one+ → locked." It must be
re-expressed against `User`+`Role` **without ever re-opening setup in production**. The danger:
during the migration both tables exist, so consulting only one could read zero and re-open setup.

**Define an "active admin-equivalent principal" as either:**
- a legacy `AdminUser` with `isActive = true`; **or**
- a `User` with `deletedAt IS NULL` **and** `status = 'active'` **and** linked via `UserRole` to a
  non-archived `Role` whose `key = 'admin'`.

**Exact safe condition — setup is OPEN if and only if:**

```
adminEquivalentCount =
      COUNT(AdminUser WHERE isActive = true)              -- legacy table
    + COUNT(User u                                         -- new table
            WHERE u.deletedAt IS NULL
              AND u.status = 'active'
              AND EXISTS (UserRole ur JOIN Role r ON r.id = ur.roleId
                          WHERE ur.userId = u.id
                            AND r.key = 'admin'
                            AND r.archived = false))

setupOpen = (adminEquivalentCount == 0)
```

**Mandatory safety properties:**
- **Union, not either:** while both tables exist, count the **UNION**. Any active admin in *either*
  table locks setup. (After AdminUser is retired, the legacy term is dropped — `User` only.)
- **Fail-closed:** if the count query errors for any reason, treat the count as `> 0` (setup
  **locked**). Never default to open. An exception must never expose `/setup`.
- **No "0 because wrong table":** the migration backfills `User` admins **before** any code reads
  the new term, so the union is never transiently zero while real admins exist.
- This is **design only** — `auth.js` is not changed here, and the writer is flipped to `User` only
  after this condition is verified on a scratch DB.

---

## 3) Actor fields — scalar IDs or FK to User?

**Recommendation: keep actor fields as scalar IDs for now. Do not FK-enforce them yet.**

Reasons:
1. **User identity is in flux** during this very reconciliation. FK-enforcing `deletedById`,
   `ownerUserId`, `authorUserId`, `actorUserId`, etc. now couples every domain table to an
   unsettled `User` migration.
2. **Not every actor is a user.** `DomainEvent.actorType` includes `system`/`automation`;
   `AuditLog.actorUserId` is nullable for system actions. A FK can't represent "system."
3. **Append-only logs must outlive users.** `AuditLog` and `DomainEvent` are immutable history. A
   FK to a mutable `User` either **blocks** user deletion (restrict) or **corrupts** the record
   (set-null). Loose ids are the correct, standard choice for audit/event stamps.
4. **No hot-path navigation.** Actor resolution is display-time, not query-critical.

**Rule going forward:** logs and actor-stamps stay **loose scalar ids**, permanently. *Structural*
ownership that is always a real user (e.g. a Deal's sales owner) **may** become an optional FK
**after** `User` identity is settled — decided case by case, never as a blanket sweep.

---

## 4) What must not be duplicated (consolidated)

- Person identity (name/email/phone/status) — one writer: `TeamMember`.
- Admin credentials **and the bootstrap count** — one auth source at a time.
- Payroll/bank PII (`bankDetails`) — one owner: `TeamMember`.
- Team-group identity — one table: `TeamRef`→`Team`.
- `externalPersonId` as the stable learning/portal handle — never orphaned, never re-minted.
- `PersonRef` ≠ `Contact` — guides are internal; do not create a customer record for them.

---

## 5) Recommended decision

1. **Two reconciliations only:** `PersonRef`/`PersonProfile` → `TeamMember`, and `AdminUser` →
   `User`/`Role`/`Permission`. `TeamRef` is kept (future `Team` group). `Contact` is greenfield.
2. **PersonRef is retained and narrowed**, not retired — it keeps portal/learning duties and links
   to the new `TeamMember` (the new identity owner).
3. **AdminUser → User via mirror-then-flip**, with the bootstrap rule re-expressed and verified
   before any writer flip. **`User` = username (login handle) + optional email**, no handle
   migration. Bootstrap uses the **union, fail-closed** condition defined in §2.
4. **Actor fields stay scalar.** Logs loose forever; structural-owner FKs revisited only after User
   settles.
5. **New tables use UUID v7; existing tables keep their cuid ids.** Mixed id strategies coexist
   (both are strings); never re-key live rows just for consistency.
6. **PersonRef split LOCKED:** TeamMember owns identity; PersonRef keeps portal/learning runtime
   and links via `teamMemberId`; PersonRef never becomes Contact; Contact stays greenfield.

---

## 6) Migration phases (no writer ever shared)

- **Phase A — Add, don't touch.** Create `User`/`Role`/`Permission`/`UserRole`/`RolePermission` and
  `TeamMember` (+ `TeamMemberProfile` if chosen) as **new, empty** tables. Zero impact on live code.
- **Phase B — Backfill as read mirrors.** Populate `TeamMember` from PersonRef/PersonProfile and
  `User` from active AdminUsers. Add `PersonRef.teamMemberId`. Legacy tables remain the **writers**;
  new tables are read-only mirrors. Verify counts and references on a scratch DB.
- **Phase C — Flip identity (Team).** Make `TeamMember` the writer for person identity; PersonRef
  identity fields become read-through. Portal/learning keep working via PersonRef.
- **Phase D — Flip auth (Admin).** Separate, carefully reviewed change: switch `auth.js` to
  `User`+role, re-express the bootstrap count, verify on scratch, then flip the writer. Keep
  AdminUser as a mirror briefly.
- **Phase E — Retire.** Drop `PersonProfile` (migrated) and `AdminUser` (cutover verified). Rename
  `TeamRef`→`Team` when the group model is specified.

Each phase is one verified ownership move. Nothing in Phases A–B changes runtime behavior.

---

## 7) Blocker status

**RESOLVED (locked 2026-06-24):**
1. ✅ **Admin login handle** — `User` keeps **username** (primary login handle) + **optional
   `email`**. No handle migration. (§2 LOCKED note.)
2. ✅ **Bootstrap rule** — exact **union, fail-closed** condition defined in §2. Design only; not
   implemented.
3. ✅ **PersonRef responsibility split** — TeamMember owns identity; PersonRef keeps portal/learning
   runtime and links via `teamMemberId`; never becomes Contact. (§1 PersonRef LOCKED.)
6. ✅ **Reference strategy for learning data** — directly resolved by (3): because PersonRef is
   **retained** and keeps `FlowTargetPerson`/`Attempt.externalPersonId`, those references are
   **not** re-pointed at `TeamMember.id`. Phase C is therefore **low-risk** (no large data
   re-keying).

**REMAINING — non-blocking design detail (decide at schema-authoring time, not blockers):**
4. **TeamMemberProfile vs flat TeamMember:** whether to keep the identity/operational split
   structural (mirror PersonRef/PersonProfile) or flatten onto `TeamMember`. Direction: TeamMember
   owns the data either way; a thin `TeamMemberProfile` is recommended for the sensitive/bulky
   fields (`bankDetails`, image, notes) but is an implementation choice, not a gate.
5. **`Team` group model timing:** when to specify the `Team` (group) model so `TeamRef` can be
   renamed cleanly. Does not block `TeamMember`/`User`; affects only final membership wiring.

**Net:** the highest-risk surfaces (production auth + live guide portal) are now locked.
Real Prisma migration **design** for the `User`/`TeamMember`/`PersonRef-link` core is **unblocked**.
Items 4–5 can be settled inside the schema-authoring step.
