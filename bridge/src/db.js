// Single PrismaClient for the bridge process. The GOS server has its own
// instance — separate connection pools, same database, same schema file
// (server/prisma/schema.prisma; `npm run generate` here points at it, so
// there is exactly ONE schema/migration source of truth and the bridge
// NEVER runs migrations).

import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({ log: ['error', 'warn'] });

export async function shutdownPrisma() {
  await prisma.$disconnect();
}
