// /api/admin-users — admin-only management surface for the AdminUser
// table.
//
// All endpoints sit behind requireAdminAuth (mounted in index.js), so
// every consumer is already a logged-in admin. The first-admin
// bootstrap path (POST /api/auth/setup) stays separate; this router
// exists for the post-bootstrap, ongoing user-management flow:
//
//   GET    /                     → list active + inactive admins
//   POST   /                     → create a new admin
//   PUT    /:id/password         → change a user's password
//   PUT    /:id/active           → activate / deactivate
//
// Two safety rails:
//   * Username must be unique (DB-enforced, surfaced as a clean 409).
//   * The LAST active admin can't be deactivated. Enforced inside a
//     transaction so two parallel requests can't race past the count.
//     Without this rail, a single user-management mistake could lock
//     everyone out of the system.

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import {
  hashPassword,
  validateUsername,
  MIN_PASSWORD_LEN,
} from '../auth.js';

const router = Router();

const SAFE_USER_FIELDS = {
  id: true,
  username: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
};

function badRequest(res, error, message) {
  return res.status(400).json({ error, message });
}

// GET / — return every admin row (active + inactive). The list is
// short by design (humans, not entities). passwordHash is never
// included; SAFE_USER_FIELDS is the allow-list.
router.get(
  '/',
  handle(async (_req, res) => {
    const users = await prisma.adminUser.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      select: SAFE_USER_FIELDS,
    });
    res.json({ users });
  }),
);

// POST / — create a new admin. Same validation rules as /api/auth/setup
// (≥3-char username with safe charset, ≥10-char password, confirmation
// match) so the UI can share gates. role defaults to 'admin'.
router.post(
  '/',
  handle(async (req, res) => {
    const username = validateUsername(req.body?.username);
    const password = String(req.body?.password || '');
    const confirm = String(req.body?.confirmPassword || '');
    if (!username) {
      return badRequest(res, 'invalid_username', 'שם משתמש לא תקין');
    }
    if (password.length < MIN_PASSWORD_LEN) {
      return badRequest(
        res,
        'password_too_short',
        `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LEN} תווים`,
      );
    }
    if (password !== confirm) {
      return badRequest(res, 'password_mismatch', 'אימות הסיסמה לא תואם');
    }
    try {
      const created = await prisma.adminUser.create({
        data: {
          username,
          passwordHash: hashPassword(password),
          role: 'admin',
          isActive: true,
        },
        select: SAFE_USER_FIELDS,
      });
      res.status(201).json({ user: created });
    } catch (e) {
      if (e?.code === 'P2002') {
        return res.status(409).json({
          error: 'username_taken',
          message: 'שם המשתמש כבר קיים',
        });
      }
      console.error('[adminUsers] create failed', e);
      res.status(500).json({ error: 'create_failed' });
    }
  }),
);

// PUT /:id/password — change another user's (or your own) password.
router.put(
  '/:id/password',
  handle(async (req, res) => {
    const password = String(req.body?.newPassword || '');
    const confirm = String(req.body?.confirmPassword || '');
    if (password.length < MIN_PASSWORD_LEN) {
      return badRequest(
        res,
        'password_too_short',
        `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LEN} תווים`,
      );
    }
    if (password !== confirm) {
      return badRequest(res, 'password_mismatch', 'אימות הסיסמה לא תואם');
    }
    const exists = await prisma.adminUser.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!exists) return res.status(404).json({ error: 'not_found' });
    const updated = await prisma.adminUser.update({
      where: { id: req.params.id },
      data: { passwordHash: hashPassword(password) },
      select: SAFE_USER_FIELDS,
    });
    res.json({ user: updated });
  }),
);

// PUT /:id/active — flip isActive. The "last active admin" rail runs
// inside a transaction with `prisma.$transaction` so two simultaneous
// deactivations can't both pass the pre-check and end up locking
// everyone out.
router.put(
  '/:id/active',
  handle(async (req, res) => {
    const next = !!req.body?.isActive;
    const id = req.params.id;
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.adminUser.findUnique({
          where: { id },
          select: { id: true, isActive: true },
        });
        if (!existing) {
          const e = new Error('not_found');
          e.code = 'NOT_FOUND';
          throw e;
        }
        if (existing.isActive && !next) {
          const activeCount = await tx.adminUser.count({
            where: { isActive: true },
          });
          if (activeCount <= 1) {
            const e = new Error('last_active_admin');
            e.code = 'LAST_ACTIVE_ADMIN';
            throw e;
          }
        }
        return tx.adminUser.update({
          where: { id },
          data: { isActive: next },
          select: SAFE_USER_FIELDS,
        });
      });
      res.json({ user: updated });
    } catch (e) {
      if (e?.code === 'NOT_FOUND') {
        return res.status(404).json({ error: 'not_found' });
      }
      if (e?.code === 'LAST_ACTIVE_ADMIN') {
        return res.status(400).json({
          error: 'last_active_admin',
          message: 'לא ניתן להשבית את המנהל הפעיל האחרון',
        });
      }
      console.error('[adminUsers] toggle active failed', e);
      res.status(500).json({ error: 'update_failed' });
    }
  }),
);

export default router;
