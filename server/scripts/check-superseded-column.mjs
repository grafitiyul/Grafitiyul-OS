// Tiny read-only check: has migration 20260726090000_tour_superseded been
// applied to the target database? Prints COLUMN_READY / NOT_YET.
import { PrismaClient } from '@prisma/client';

const dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);

try {
  const rows = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'TourEvent' AND column_name = 'supersededByTourEventId'`;
  console.log(rows.length ? 'COLUMN_READY' : 'NOT_YET');
} catch (e) {
  console.log('ERR ' + e.message);
} finally {
  await prisma.$disconnect();
}
