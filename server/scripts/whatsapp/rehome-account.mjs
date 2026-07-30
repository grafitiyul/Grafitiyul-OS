// Re-home every account-scoped WhatsApp record from one accountId to another.
//
// WHY THIS EXISTS (2026-07-30)
// The main business phone was paired into the OFFICE bridge: the connections
// screen had no explicit default tab and listed office first, so the QR on
// screen belonged to `office`. History sync then mirrored the MAIN number's
// entire WhatsApp under accountId='office' — 811 chats, 21,545 messages.
// Re-pairing main correctly would duplicate every one of those threads, so the
// history is MOVED, never deleted and never re-synced (WhatsApp does not
// re-deliver years of history on demand).
//
// SAFETY CONTRACT
//   * Every account-scoped table is covered. The model list below is asserted
//     against the live Prisma schema at runtime — a future WhatsApp table with
//     an accountId column makes this script ABORT rather than silently leave
//     rows behind.
//   * The whole move runs in ONE transaction. Partial re-homing (messages moved,
//     chats not) would be worse than not running at all.
//   * Unique constraints are (accountId, …) on every table that has one, so a
//     move can only collide if the TARGET already holds rows. That is checked
//     and refused, per table, inside the transaction.
//   * Refuses to run against a source whose bridge is live (status='connected')
//     or that still holds Baileys creds — moving data out from under a running
//     socket is how you get half-written state.
//   * Idempotent: a second run finds nothing to move and exits clean.
//
// Dry run (default):  node scripts/whatsapp/rehome-account.mjs --from=office --to=main
// Execute:            node scripts/whatsapp/rehome-account.mjs --from=office --to=main --apply

import { PrismaClient } from '@prisma/client';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const FROM = String(args.from || '');
const TO = String(args.to || '');
const APPLY = args.apply === true || args.apply === 'true';

if (!FROM || !TO || FROM === TO) {
  console.error('usage: rehome-account.mjs --from=<accountId> --to=<accountId> [--apply]');
  process.exit(2);
}

// Every model that scopes rows by accountId, with the unique constraint that
// governs a move. `delegate` is the Prisma client property name.
const MOVABLE = [
  { model: 'WhatsAppChat', delegate: 'whatsAppChat', unique: '(accountId, externalChatId)' },
  { model: 'WhatsAppMessage', delegate: 'whatsAppMessage', unique: '(accountId, externalMessageId)' },
  { model: 'WhatsAppMessageReaction', delegate: 'whatsAppMessageReaction', unique: '(accountId, externalMessageId, reactorPhone)' },
  { model: 'WhatsAppSession', delegate: 'whatsAppSession', unique: '(accountId, kind, keyId)' },
  { model: 'WhatsAppDataGap', delegate: 'whatsAppDataGap', unique: 'none' },
  { model: 'WhatsAppScheduledMessage', delegate: 'whatsAppScheduledMessage', unique: 'none' },
  { model: 'WhatsAppOutboundIdempotency', delegate: 'whatsAppOutboundIdempotency', unique: 'key (global — accountId not part of it)' },
];

// WhatsApp-prefixed models that are deliberately NOT account-scoped, listed
// explicitly so the coverage assertion below stays meaningful.
//   whatsAppTemplate — reusable internal wording ("נוסחים לתבניות ווטסאפ").
//                      Owned by the CRM, has no accountId, sends through
//                      whichever chat the operator opens.
const NOT_ACCOUNT_SCOPED = ['whatsAppTemplate'];

// Pairing identity written by the bridge. Cleared on the SOURCE so no trace of
// the wrong phone is left behind claiming to be that number.
const PAIRING_STATE_RESET = {
  status: 'disconnected',
  qr: null,
  phoneJid: null,
  deviceName: null,
  lastQrAt: null,
  lastConnectedAt: null,
  lastDisconnectAt: null,
  lastDisconnectReason: null,
  lastMessageAt: null,
  lastInboundMessageAt: null,
  reconnectAttempts: 0,
};

const prisma = new PrismaClient();

async function countsFor(db, accountId) {
  const out = {};
  for (const t of MOVABLE) out[t.model] = await db[t.delegate].count({ where: { accountId } });
  return out;
}

function table(rows) {
  const w = Math.max(...rows.map((r) => r[0].length));
  for (const [label, ...cols] of rows) {
    console.log(`  ${label.padEnd(w)}  ${cols.map((c) => String(c).padStart(9)).join('  ')}`);
  }
}

async function main() {
  // 0. The model list must still describe reality.
  const schemaModels = Object.keys(prisma)
    .filter((k) => /^whatsApp/.test(k))
    .filter((k) => typeof prisma[k]?.count === 'function');
  const declared = new Set([...MOVABLE.map((t) => t.delegate), 'whatsAppAccount', ...NOT_ACCOUNT_SCOPED]);
  const undeclared = schemaModels.filter((m) => !declared.has(m));
  if (undeclared.length) {
    console.error(`ABORT: WhatsApp models not covered by this script: ${undeclared.join(', ')}`);
    console.error('Add them to MOVABLE (or to the exclusion list) before re-homing.');
    process.exit(3);
  }

  const [src, dst] = await Promise.all([
    prisma.whatsAppAccount.findUnique({ where: { id: FROM } }),
    prisma.whatsAppAccount.findUnique({ where: { id: TO } }),
  ]);
  if (!src) { console.error(`ABORT: source account '${FROM}' does not exist`); process.exit(3); }
  if (!dst) { console.error(`ABORT: target account '${TO}' does not exist`); process.exit(3); }

  console.log(`\n=== RE-HOME ${FROM} → ${TO} ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===\n`);
  console.log('accounts:');
  for (const a of [src, dst]) {
    console.log(`  ${a.id.padEnd(8)} status=${String(a.status).padEnd(13)} phoneJid=${a.phoneJid || '—'}  ${a.label}`);
  }

  // 1. Never move data out from under a live socket.
  if (src.status === 'connected') {
    console.error(`\nABORT: source '${FROM}' is CONNECTED. Sign it out before re-homing.`);
    process.exit(4);
  }
  const srcCreds = await prisma.whatsAppSession.count({ where: { accountId: FROM, kind: 'creds' } });
  if (srcCreds > 0) {
    console.error(`\nABORT: source '${FROM}' still holds Baileys creds (${srcCreds} row(s)) — it is not signed out.`);
    process.exit(4);
  }
  if (dst.status === 'connected') {
    console.error(`\nABORT: target '${TO}' is CONNECTED. Re-home before pairing it, not after.`);
    process.exit(4);
  }

  // 2. BEFORE counts.
  const beforeSrc = await countsFor(prisma, FROM);
  const beforeDst = await countsFor(prisma, TO);
  console.log('\nBEFORE:');
  table([['table', FROM, TO], ...MOVABLE.map((t) => [t.model, beforeSrc[t.model], beforeDst[t.model]])]);

  const totalToMove = Object.values(beforeSrc).reduce((a, b) => a + b, 0);
  if (totalToMove === 0) {
    console.log(`\nNothing to move — '${FROM}' holds no account-scoped rows. (Already re-homed?)`);
    await prisma.$disconnect();
    return;
  }

  // 3. Collision analysis. Every unique here starts with accountId, so the only
  //    way a move collides is a target that already holds rows.
  console.log('\nUNIQUE CONSTRAINT ANALYSIS:');
  let blocked = false;
  for (const t of MOVABLE) {
    const risk = beforeDst[t.model] > 0 && t.unique !== 'none' && !t.unique.startsWith('key');
    if (risk) blocked = true;
    console.log(`  ${t.model.padEnd(28)} ${t.unique.padEnd(48)} ${risk ? 'COLLISION RISK' : 'safe'}`);
  }
  if (blocked) {
    console.error(`\nABORT: target '${TO}' already holds rows under a (accountId, …) unique.`);
    console.error('A blind UPDATE would violate it. Resolve the overlap manually first.');
    process.exit(5);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — ${totalToMove} rows would move. Re-run with --apply to execute.`);
    await prisma.$disconnect();
    return;
  }

  // 4. The move. One transaction, or nothing.
  const moved = await prisma.$transaction(async (tx) => {
    const result = {};
    for (const t of MOVABLE) {
      // Re-assert emptiness INSIDE the transaction — the check above was
      // outside it, and a concurrent write must not slip through.
      if (t.unique !== 'none' && !t.unique.startsWith('key')) {
        const now = await tx[t.delegate].count({ where: { accountId: TO } });
        if (now > 0) throw new Error(`${t.model}: target gained ${now} rows mid-flight — aborting`);
      }
      const { count } = await tx[t.delegate].updateMany({
        where: { accountId: FROM },
        data: { accountId: TO },
      });
      result[t.model] = count;
    }
    await tx.whatsAppAccount.update({ where: { id: FROM }, data: PAIRING_STATE_RESET });
    return result;
  }, { timeout: 120_000 });

  console.log('\nMOVED:');
  table(Object.entries(moved).map(([k, v]) => [k, v]));

  // 5. AFTER counts — read back, never assume.
  const afterSrc = await countsFor(prisma, FROM);
  const afterDst = await countsFor(prisma, TO);
  console.log('\nAFTER:');
  table([['table', FROM, TO], ...MOVABLE.map((t) => [t.model, afterSrc[t.model], afterDst[t.model]])]);

  const leftBehind = Object.values(afterSrc).reduce((a, b) => a + b, 0);
  const landed = Object.values(afterDst).reduce((a, b) => a + b, 0);
  const expected = totalToMove + Object.values(beforeDst).reduce((a, b) => a + b, 0);

  const srcAfter = await prisma.whatsAppAccount.findUnique({ where: { id: FROM } });
  console.log(`\nsource pairing state cleared: phoneJid=${srcAfter.phoneJid || 'null'} status=${srcAfter.status} lastConnectedAt=${srcAfter.lastConnectedAt || 'null'}`);

  console.log('\nVERIFY:');
  console.log(`  rows left on '${FROM}': ${leftBehind} ${leftBehind === 0 ? '✓' : '✗ EXPECTED 0'}`);
  console.log(`  rows now on '${TO}':    ${landed} ${landed === expected ? '✓' : `✗ EXPECTED ${expected}`}`);
  console.log(`  identity cleared:      ${srcAfter.phoneJid === null ? '✓' : '✗'}`);

  const ok = leftBehind === 0 && landed === expected && srcAfter.phoneJid === null;
  console.log(`\n${ok ? 'RE-HOME VERIFIED' : 'RE-HOME INCOMPLETE — INVESTIGATE'}`);
  await prisma.$disconnect();
  process.exit(ok ? 0 : 6);
}

main().catch(async (err) => {
  console.error('\nFAILED:', err?.message || err);
  await prisma.$disconnect();
  process.exit(1);
});
