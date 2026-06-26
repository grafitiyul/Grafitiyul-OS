// =============================================================================
// PHASE B — DRAFT backfill script (REVIEW + SCRATCH ONLY)
// =============================================================================
//
// STATUS: DRAFT artifact under docs/. NOT wired to anything. NOT in the deploy
// path. Run ONLY against a SCRATCH database, and ONLY after Phase A models have
// been added to a (scratch) schema and `prisma generate` has been run there.
//
// WHAT THIS DOES (point-in-time READ MIRROR — no writer flip):
//   * AdminUser            → User (+ admin Role / UserRole / RolePermission)
//   * PersonRef            → TeamMember
//   * PersonProfile        → TeamMemberProfile
//   * PersonRef.teamMemberId link (fills NULLs only)
//
// WHAT THIS NEVER DOES:
//   * never writes AdminUser, PersonProfile, or any portal/learning field
//   * never touches PersonRef EXCEPT to fill the new nullable teamMemberId
//   * never changes auth.js or guide-portal behavior
//   * never flips a writer; the mirror is allowed to drift until Phase C
//
// IDEMPOTENT: keyed on stable bridges (legacyAdminUserId, recruitmentExternalId).
// Re-running converges to the same state (upserts; link fill only on NULL).
//
// Usage (scratch only):
//   DATABASE_URL=postgres://…scratch…  node phase-b-backfill.draft.mjs
//   (add --dry-run to log intended actions without writing)
// =============================================================================

import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

// ----- UUID v7 (app-supplied; Prisma 5.22 has no uuid(7) default) -----------
function uuidv7() {
  const ts = Date.now();
  const b = randomBytes(16);
  b[0] = Math.floor(ts / 2 ** 40) & 0xff;
  b[1] = Math.floor(ts / 2 ** 32) & 0xff;
  b[2] = Math.floor(ts / 2 ** 24) & 0xff;
  b[3] = Math.floor(ts / 2 ** 16) & 0xff;
  b[4] = Math.floor(ts / 2 ** 8) & 0xff;
  b[5] = ts & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ----- Coarse seed permission set (start coarse, structured to grow) --------
const ADMIN_ROLE = { key: 'admin', name: 'Administrator', isSystem: true };
const SEED_PERMISSIONS = [
  { key: 'admin.all', resource: '*', action: '*', scope: 'all',
    description: 'Full administrative access (coarse seed; refine later).' },
  // Structure for future least-privilege; all granted to admin for now:
  { key: 'team.read.all',   resource: 'team',   action: 'read',  scope: 'all' },
  { key: 'team.write.all',  resource: 'team',   action: 'write', scope: 'all' },
  { key: 'crm.read.all',    resource: 'crm',    action: 'read',  scope: 'all' },
  { key: 'crm.write.all',   resource: 'crm',    action: 'write', scope: 'all' },
];

const log = (...a) => console.log('[phase-b]', ...a);

// ----- 1) Seed Role + Permissions + RolePermission --------------------------
async function seedRbac() {
  const role = await prisma.role.upsert({
    where: { key: ADMIN_ROLE.key },
    create: { id: uuidv7(), ...ADMIN_ROLE },
    update: { name: ADMIN_ROLE.name, isSystem: ADMIN_ROLE.isSystem },
  });
  for (const p of SEED_PERMISSIONS) {
    const perm = await prisma.permission.upsert({
      where: { key: p.key },
      create: { id: uuidv7(), ...p },
      update: { resource: p.resource, action: p.action, scope: p.scope },
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      create: { roleId: role.id, permissionId: perm.id },
      update: {},
    });
  }
  log(`RBAC seeded: role=${role.key}, permissions=${SEED_PERMISSIONS.length}`);
  return role;
}

// ----- 2) AdminUser → User (+ UserRole admin) -------------------------------
async function backfillUsers(adminRole) {
  const admins = await prisma.adminUser.findMany();
  let created = 0;
  for (const a of admins) {
    const status = a.isActive ? 'active' : 'suspended';
    if (DRY_RUN) { log(`would upsert User from AdminUser ${a.username} (status=${status})`); continue; }
    const user = await prisma.user.upsert({
      where: { legacyAdminUserId: a.id },
      create: {
        id: uuidv7(),
        legacyAdminUserId: a.id,
        username: a.username,
        displayName: a.username, // AdminUser has no display name
        passwordHash: a.passwordHash, // verbatim scrypt
        status,
        lastLoginAt: a.lastLoginAt ?? null,
        createdAt: a.createdAt, // preserve original creation time
      },
      update: {
        username: a.username,
        passwordHash: a.passwordHash,
        status,
        lastLoginAt: a.lastLoginAt ?? null,
      },
    });
    // Link to the admin role (all legacy AdminUsers have role 'admin').
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
      create: { userId: user.id, roleId: adminRole.id },
      update: {},
    });
    created++;
  }
  log(`Users mirrored from ${admins.length} AdminUser rows`);
}

// ----- 3) PersonRef/PersonProfile → TeamMember/TeamMemberProfile ------------
async function backfillTeamMembers() {
  const people = await prisma.personRef.findMany({ include: { profile: true } });
  for (const p of people) {
    const status = p.status === 'blocked' ? 'inactive' : 'active';
    if (DRY_RUN) { log(`would upsert TeamMember from PersonRef ${p.externalPersonId}`); continue; }
    const tm = await prisma.teamMember.upsert({
      where: { recruitmentExternalId: p.externalPersonId },
      create: {
        id: uuidv7(),
        recruitmentExternalId: p.externalPersonId,
        displayName: p.displayName,
        memberTypes: ['guide'],
        status,
        primaryEmail: p.email ?? null,
        primaryPhoneE164: p.phone ?? null, // copied as-is; normalization is later
        createdAt: p.createdAt,
      },
      update: {
        displayName: p.displayName,
        status,
        primaryEmail: p.email ?? null,
        primaryPhoneE164: p.phone ?? null,
      },
    });

    // PersonProfile → TeamMemberProfile (only if a profile exists).
    if (p.profile) {
      await prisma.teamMemberProfile.upsert({
        where: { teamMemberId: tm.id },
        create: {
          teamMemberId: tm.id,
          imageUrl: p.profile.imageUrl ?? null,
          description: p.profile.description ?? null,
          notes: p.profile.notes ?? null,
          bankDetails: p.profile.bankDetails ?? null,
        },
        update: {
          imageUrl: p.profile.imageUrl ?? null,
          description: p.profile.description ?? null,
          notes: p.profile.notes ?? null,
          bankDetails: p.profile.bankDetails ?? null,
        },
      });
    }

    // 4) Link PersonRef → TeamMember (fill NULL only; never re-point).
    await prisma.personRef.updateMany({
      where: { id: p.id, teamMemberId: null },
      data: { teamMemberId: tm.id },
    });
  }
  log(`TeamMembers mirrored from ${people.length} PersonRef rows`);
}

async function main() {
  log(DRY_RUN ? 'DRY RUN — no writes' : 'LIVE BACKFILL (scratch DB expected)');
  const adminRole = await seedRbac();
  await backfillUsers(adminRole);
  await backfillTeamMembers();
  log('done.');
}

main()
  .catch((e) => { console.error('[phase-b] FAILED', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });

// =============================================================================
// SAFETY NOTES
//   * Writers untouched: AdminUser & PersonRef portal/learning fields are never
//     written (PersonRef only gets its new nullable teamMemberId filled).
//   * Re-runnable: upserts on legacyAdminUserId / recruitmentExternalId / keys;
//     link fill is WHERE teamMemberId IS NULL. Second run = no-op.
//   * updatedAt: Prisma manages @updatedAt, so mirrored rows get a backfill-time
//     updatedAt (createdAt IS preserved). Acceptable for a mirror copy.
//   * Run the verification SQL (phase-ab-verification.sql) after this script.
// =============================================================================
