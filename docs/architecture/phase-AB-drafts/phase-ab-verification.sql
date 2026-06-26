-- ============================================================================
-- PHASE A + B — DRAFT verification SQL (SCRATCH DB ONLY)
-- ============================================================================
--
-- STATUS: DRAFT artifact under docs/. Run ONLY against a scratch database.
-- Read-only checks (plus the BASELINE capture). Nothing here mutates data.
--
-- Identifiers are double-quoted camelCase/PascalCase because the live schema
-- uses Prisma's default naming (no @map). Verify exact casing against the
-- generated Phase A migration before running.
--
-- Run order:
--   STEP 0  — BEFORE the Phase B backfill: capture baselines.
--   STEP 1+ — AFTER the Phase B backfill: structural, parity, integrity,
--             bootstrap-safety, and portal-preservation checks.
-- Every "EXPECT" comment states the pass condition.
-- ============================================================================


-- ===== STEP 0 — BASELINE (run BEFORE backfill; record the numbers) ==========

-- 0.1 Legacy admin baseline.
SELECT count(*) AS admin_total,
       count(*) FILTER (WHERE "isActive") AS admin_active
FROM "AdminUser";

-- 0.2 Guide/person baseline.
SELECT count(*) AS personref_total,
       count(DISTINCT "externalPersonId") AS distinct_external_ids,
       count(*) FILTER (WHERE "portalEnabled") AS portal_enabled
FROM "PersonRef";

-- 0.3 PORTAL-TOKEN BASELINE — the critical "must not change" snapshot.
--     Re-run 5.x after backfill and compare to these exact numbers.
SELECT count(*)                                   AS personref_total,
       count("portalToken")                       AS tokens_present,
       count(DISTINCT "portalToken")              AS tokens_distinct,
       md5(string_agg("portalToken", ',' ORDER BY "id")) AS token_fingerprint
FROM "PersonRef";

-- 0.4 Profile baseline.
SELECT count(*) AS personprofile_total FROM "PersonProfile";


-- ===== STEP 1 — STRUCTURAL (Phase A created what we expect) ==================

-- 1.1 New tables exist. EXPECT: 7 rows.
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('User','Role','Permission','UserRole','RolePermission',
                    'TeamMember','TeamMemberProfile')
ORDER BY tablename;

-- 1.2 PersonRef.teamMemberId column added (the only live-table change).
--     EXPECT: 1 row, is_nullable = YES.
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'PersonRef' AND column_name = 'teamMemberId';

-- 1.3 Partial unique indexes present. EXPECT: both rows.
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('user_username_active_uq','user_email_active_uq')
ORDER BY indexname;

-- 1.4 citext extension installed. EXPECT: 1 row.
SELECT extname FROM pg_extension WHERE extname = 'citext';


-- ===== STEP 2 — PARITY (counts match between source and mirror) =============

-- 2.1 Admin parity. EXPECT: admin_active == mirrored_active_admins.
SELECT
  (SELECT count(*) FROM "AdminUser" WHERE "isActive") AS admin_active,
  (SELECT count(*) FROM "User" u
     WHERE u."legacyAdminUserId" IS NOT NULL
       AND u."status" = 'active'
       AND EXISTS (SELECT 1 FROM "UserRole" ur
                   JOIN "Role" r ON r."id" = ur."roleId"
                   WHERE ur."userId" = u."id" AND r."key" = 'admin'
                     AND r."archived" = false)) AS mirrored_active_admins;

-- 2.2 Team parity. EXPECT: distinct_external_ids == mirrored_team_members.
SELECT
  (SELECT count(DISTINCT "externalPersonId") FROM "PersonRef") AS distinct_external_ids,
  (SELECT count(*) FROM "TeamMember"
     WHERE "recruitmentExternalId" IS NOT NULL) AS mirrored_team_members;

-- 2.3 Profile parity. EXPECT: equal.
SELECT (SELECT count(*) FROM "PersonProfile")      AS personprofile_total,
       (SELECT count(*) FROM "TeamMemberProfile")  AS teammemberprofile_total;


-- ===== STEP 3 — COMPLETENESS (no row left behind) ===========================

-- 3.1 Every active AdminUser has a mirrored User. EXPECT: 0 rows.
SELECT a."id", a."username"
FROM "AdminUser" a
WHERE a."isActive"
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."legacyAdminUserId" = a."id");

-- 3.2 Every PersonRef maps to a TeamMember. EXPECT: 0 rows.
SELECT p."id", p."externalPersonId"
FROM "PersonRef" p
WHERE NOT EXISTS (SELECT 1 FROM "TeamMember" t
                  WHERE t."recruitmentExternalId" = p."externalPersonId");

-- 3.3 Every PersonRef link is filled. EXPECT: 0 (or an explained allow-list).
SELECT count(*) AS personref_without_teammember
FROM "PersonRef" WHERE "teamMemberId" IS NULL;

-- 3.4 No orphan TeamMember mirror (external id with no PersonRef). EXPECT: 0.
SELECT t."id", t."recruitmentExternalId"
FROM "TeamMember" t
WHERE t."recruitmentExternalId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "PersonRef" p
                  WHERE p."externalPersonId" = t."recruitmentExternalId");


-- ===== STEP 4 — INTEGRITY + DUPLICATES ======================================

-- 4.1 passwordHash carried verbatim for all mirrored admins. EXPECT: 0 rows.
SELECT a."username"
FROM "AdminUser" a
JOIN "User" u ON u."legacyAdminUserId" = a."id"
WHERE u."passwordHash" IS DISTINCT FROM a."passwordHash";

-- 4.2 Duplicate username among non-deleted Users. EXPECT: 0 rows.
SELECT lower(username::text) AS uname, count(*)
FROM "User" WHERE "deletedAt" IS NULL
GROUP BY lower(username::text) HAVING count(*) > 1;

-- 4.3 Duplicate recruitmentExternalId in TeamMember. EXPECT: 0 rows.
SELECT "recruitmentExternalId", count(*)
FROM "TeamMember" WHERE "recruitmentExternalId" IS NOT NULL
GROUP BY "recruitmentExternalId" HAVING count(*) > 1;

-- 4.4 Duplicate legacyAdminUserId. EXPECT: 0 rows.
SELECT "legacyAdminUserId", count(*)
FROM "User" WHERE "legacyAdminUserId" IS NOT NULL
GROUP BY "legacyAdminUserId" HAVING count(*) > 1;

-- 4.5 Link points at the RIGHT TeamMember (no cross-wiring). EXPECT: 0 rows.
SELECT p."id"
FROM "PersonRef" p
JOIN "TeamMember" t ON t."id" = p."teamMemberId"
WHERE t."recruitmentExternalId" IS DISTINCT FROM p."externalPersonId";

-- 4.6 Phone data-quality (NON-BLOCKING) — count non-E.164 mirrored phones.
SELECT count(*) AS non_e164_phones
FROM "TeamMember"
WHERE "primaryPhoneE164" IS NOT NULL
  AND "primaryPhoneE164" !~ '^\+[1-9][0-9]{6,14}$';


-- ===== STEP 5 — PORTAL-TOKEN PRESERVATION (must be byte-identical) ==========

-- 5.1 Re-run the 0.3 fingerprint AFTER backfill.
--     EXPECT: token_fingerprint, tokens_present, tokens_distinct ALL identical
--     to STEP 0.3. Backfill must not touch any portal token.
SELECT count(*)                                   AS personref_total,
       count("portalToken")                       AS tokens_present,
       count(DISTINCT "portalToken")              AS tokens_distinct,
       md5(string_agg("portalToken", ',' ORDER BY "id")) AS token_fingerprint
FROM "PersonRef";

-- 5.2 portalEnabled flags unchanged. EXPECT: equal to STEP 0.2 portal_enabled.
SELECT count(*) FILTER (WHERE "portalEnabled") AS portal_enabled
FROM "PersonRef";

-- 5.3 No portal/learning field was nulled or altered by the link update.
--     Spot check: every PersonRef still has its token + status. EXPECT: 0 rows.
SELECT count(*) AS broken_portal_rows
FROM "PersonRef"
WHERE "portalToken" IS NULL OR "status" IS NULL;


-- ===== STEP 6 — BOOTSTRAP / SETUP SAFETY (the auth-bypass guard) ============

-- 6.1 Union admin-equivalent count (legacy + new), per reconciliation plan §2.
--     EXPECT: > 0  ⇒  setupOpen = FALSE. Setup must be LOCKED.
SELECT
  (SELECT count(*) FROM "AdminUser" WHERE "isActive")
  +
  (SELECT count(*) FROM "User" u
     WHERE u."deletedAt" IS NULL
       AND u."status" = 'active'
       AND EXISTS (SELECT 1 FROM "UserRole" ur
                   JOIN "Role" r ON r."id" = ur."roleId"
                   WHERE ur."userId" = u."id" AND r."key" = 'admin'
                     AND r."archived" = false))
  AS admin_equivalent_count;       -- EXPECT > 0 (setup locked)

-- 6.2 Sanity: the new-table term alone is also > 0 after backfill (proves the
--     union won't read zero once AdminUser is later retired). EXPECT: > 0.
SELECT count(*) AS new_admin_equivalents
FROM "User" u
WHERE u."deletedAt" IS NULL AND u."status" = 'active'
  AND EXISTS (SELECT 1 FROM "UserRole" ur
              JOIN "Role" r ON r."id" = ur."roleId"
              WHERE ur."userId" = u."id" AND r."key" = 'admin'
                AND r."archived" = false);


-- ===== STEP 7 — IDEMPOTENCY (run the backfill twice, then this) =============

-- 7.1 After a SECOND backfill run, counts must be unchanged from the first.
--     EXPECT: user_count, teammember_count equal across runs (record + compare).
SELECT (SELECT count(*) FROM "User")        AS user_count,
       (SELECT count(*) FROM "TeamMember")  AS teammember_count,
       (SELECT count(*) FROM "UserRole")    AS userrole_count,
       (SELECT count(*) FROM "TeamMemberProfile") AS profile_count;
