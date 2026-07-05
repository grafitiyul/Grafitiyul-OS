// Copy the ONE schema source of truth (server/prisma/schema.prisma) into
// bridge/prisma/ so `prisma generate` emits the client into the BRIDGE's
// node_modules. Prisma writes the generated client into the node_modules
// nearest the schema file — generating straight from ../server/prisma would
// land the client in server/node_modules and leave the bridge importing the
// ungenerated stub (the exact trap the Challenge System's sync-schema script
// solved). The copy is a BUILD ARTIFACT (gitignored), never edited by hand,
// and the bridge still never runs migrations.

import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../server/prisma/schema.prisma');
const destDir = path.resolve(here, '../prisma');
const dest = path.join(destDir, 'schema.prisma');

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[sync-schema] copied ${src} -> ${dest}`);
