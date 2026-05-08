-- Internal admin users table. Replaces the env-var ADMIN_USERNAME /
-- ADMIN_PASSWORD login flow. Until the first row is inserted, the
-- server runs in bootstrap mode (admin reachable, /api/auth/setup
-- accepts a one-time create-first-user request). After the first
-- active row exists, /api/auth/setup returns 403 and admin requires
-- a valid session.

CREATE TABLE "AdminUser" (
    "id"           TEXT         NOT NULL,
    "username"     TEXT         NOT NULL,
    "passwordHash" TEXT         NOT NULL,
    "role"         TEXT         NOT NULL DEFAULT 'admin',
    "isActive"     BOOLEAN      NOT NULL DEFAULT true,
    "lastLoginAt"  TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");
