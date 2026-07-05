// Purge ALL WhatsApp data for ONE account — the clean-exit path for test
// accounts (e.g. accountId 'personal_test' paired with a personal number).
//
// Usage (from server/):
//   npm run purge:whatsapp -- <accountId>          dry-run: show what would be deleted
//   npm run purge:whatsapp -- <accountId> --yes    actually delete
//
// Scope — WhatsApp tables ONLY, one accountId only:
//   messages / reactions / scheduled messages / chats   (Slice 2+, when present)
//   data gaps, Baileys sessions, the account row itself
//   R2 media objects under whatsapp/<accountId>/        (when R2 is configured)
// It NEVER touches Deals, Contacts, Organizations, Quotes, Payments or any
// other CRM data. Chat→Contact matching is link-only (WhatsAppChat.contactId),
// so deleting chats cannot modify a Contact.
//
// Forward-compat contract with future slices (enforced here by design):
//   1. EVERY WhatsApp model carries a direct `accountId` column (including
//      WhatsAppMessage / WhatsAppScheduledMessage — denormalized on purpose so
//      account-level purge and queries never need join-tracing).
//   2. All WhatsApp media in R2 lives under the key prefix
//      `whatsapp/<accountId>/…` so prefix deletion is account-exact.
// Models that don't exist yet are skipped automatically (the generated client
// simply doesn't have them), so this script works today and after Slice 2+
// without edits.
//
// Safety:
//   - dry-run by default; deletion requires an explicit --yes.
//   - refuses to run when the account's bridge looks CONNECTED (a live bridge
//     would immediately re-create session rows) — sign out / stop the bridge
//     service first, or pass --force with eyes open.

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as r2 from '../src/r2.js';

// Deletion order is FK-safe (children before parents). Explicit whitelist —
// nothing outside it is ever touched.
const WHATSAPP_MODELS = [
  'whatsAppMessageReaction',
  'whatsAppMessage',
  'whatsAppScheduledMessage',
  'whatsAppChat',
  'whatsAppDataGap',
  'whatsAppSession',
];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const accountId = args.find((a) => !a.startsWith('--'));
const execute = flags.has('--yes');
const force = flags.has('--force');

if (!accountId) {
  console.error('Usage: node scripts/purge-whatsapp-account.mjs <accountId> [--yes] [--force]');
  console.error('       (dry-run by default; --yes actually deletes)');
  process.exit(1);
}

const prisma = new PrismaClient({ log: ['error'] });

async function main() {
  const account = await prisma.whatsAppAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    console.error(`✗ WhatsApp account '${accountId}' not found. Nothing to purge.`);
    process.exit(1);
  }

  console.log(`\nWhatsApp purge — account '${account.id}' (${account.label})`);
  console.log(`  status: ${account.status}   phone: ${account.phoneJid || '—'}\n`);

  if (account.status === 'connected' && !force) {
    console.error('✗ This account\'s bridge looks CONNECTED. A live bridge re-creates session');
    console.error('  rows immediately after the purge. First sign out (admin UI → נתק מכשיר)');
    console.error('  and/or stop the bridge service on Railway, then re-run.');
    console.error('  (Override with --force only if you know the bridge is actually down.)');
    process.exit(1);
  }

  // Count per model — models not in the generated client yet are skipped.
  const present = WHATSAPP_MODELS.filter((m) => prisma[m]);
  const counts = {};
  for (const m of present) {
    counts[m] = await prisma[m].count({ where: { accountId } });
  }

  // R2 media under the account's prefix (Slice 2+ convention).
  const mediaPrefix = `whatsapp/${accountId}/`;
  let mediaKeys = [];
  if (r2.isConfigured()) {
    mediaKeys = await r2.listKeys(mediaPrefix);
  }

  console.log('  Rows to delete:');
  for (const m of present) console.log(`    ${m.padEnd(28)} ${counts[m]}`);
  for (const m of WHATSAPP_MODELS.filter((x) => !prisma[x])) {
    console.log(`    ${m.padEnd(28)} (model not in schema yet — skipped)`);
  }
  console.log(`    ${'whatsAppAccount'.padEnd(28)} 1 (the account row itself)`);
  console.log(
    `    ${('R2 ' + mediaPrefix + '*').padEnd(28)} ${r2.isConfigured() ? mediaKeys.length : '(R2 not configured — skipped)'}`,
  );

  if (!execute) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --yes to execute.\n');
    return;
  }

  console.log('\nDeleting…');
  for (const m of present) {
    const { count } = await prisma[m].deleteMany({ where: { accountId } });
    console.log(`  ✓ ${m}: ${count} deleted`);
  }
  await prisma.whatsAppAccount.delete({ where: { id: accountId } });
  console.log('  ✓ whatsAppAccount row deleted');

  let mediaDeleted = 0;
  for (const key of mediaKeys) {
    await r2.deleteObject(key); // best-effort per object
    mediaDeleted++;
  }
  if (r2.isConfigured()) console.log(`  ✓ R2: ${mediaDeleted} object(s) deleted under ${mediaPrefix}`);

  console.log(`\n✓ Purge of '${accountId}' complete. No non-WhatsApp data was touched.\n`);
}

main()
  .catch((err) => {
    console.error('✗ purge failed:', err?.message || err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
