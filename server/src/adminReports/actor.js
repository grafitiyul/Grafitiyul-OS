// Resolve the REAL authenticated actor for a report ("מי עדכן").
//
// Deliberately NOT the deal owner: the person who performed the action is
// frequently not the person who owns the deal, and reporting the owner as the
// updater would be a lie. Returns the canonical name-bearing shape
// (ADMIN_NAME_SELECT) so adminDisplayName resolves it exactly like every other
// surface; null when the action had no authenticated user (system/automation).

import { prisma } from '../db.js';
import { ADMIN_NAME_SELECT } from '../admin/displayName.js';

export async function actorForReport(userId) {
  if (!userId) return null;
  try {
    return await prisma.adminUser.findUnique({ where: { id: userId }, select: ADMIN_NAME_SELECT });
  } catch {
    return null;
  }
}
