// Permanent removal of a WhatsApp account and everything scoped to it.
//
// OWNER DECISION (2026-07-29): the personal test number 972524264020 is removed
// from production in full, including its conversation history, and including
// conversations that touch migrated legacy deals. The audit found 25 chats /
// 812 messages belonging to contacts with real deals below 27000 and 2,148
// outgoing messages overall; this was raised, reviewed, and the deletion was
// reaffirmed as an explicit business decision. The goal is zero remaining
// production dependency on that number.
//
// What this deliberately does NOT do:
//   * it never deletes a Contact — CRM identity is not WhatsApp's to remove.
//     Chats are LINK-ONLY (contactId), so unlinking is automatic when the chat
//     goes, and the customer record survives intact.
//   * it never touches another account's rows. Every delete is scoped by
//     accountId, and the account being removed must not be the last connected
//     one unless explicitly forced.
//
// Everything is scoped by accountId, in FK-safe order, inside one transaction.

export const WA_SCOPED_TABLES = Object.freeze([
  // Children first. Reactions and messages reference chats; sessions/gaps/
  // idempotency/scheduled are account-scoped leaves.
  'WhatsAppMessageReaction',
  'WhatsAppMessage',
  'WhatsAppChat',
  'WhatsAppSession',
  'WhatsAppDataGap',
  'WhatsAppOutboundIdempotency',
  'WhatsAppScheduledMessage',
]);

export async function tableExists(db, table) {
  const r = await db.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, table);
  return r.length > 0;
}

export async function columnExists(db, table, column) {
  const r = await db.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    table, column);
  return r.length > 0;
}

/**
 * Everything that would be removed, plus every production dependency that would
 * be left dangling. READ-ONLY.
 */
export async function planAccountPurge(db, accountId) {
  const account = await db.whatsAppAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    const e = new Error(`unknown_account: ${accountId}`);
    e.code = 'UNKNOWN_ACCOUNT';
    throw e;
  }

  const counts = {};
  for (const t of WA_SCOPED_TABLES) {
    try {
      const r = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${t}" WHERE "accountId" = $1`, accountId);
      counts[t] = Number(r[0].n);
    } catch { counts[t] = null; }
  }

  // Production references that survive the account and must be reported.
  const linkedContacts = Number((await db.$queryRawUnsafe(
    `SELECT count(DISTINCT "contactId")::int AS n FROM "WhatsAppChat" WHERE "accountId"=$1 AND "contactId" IS NOT NULL`,
    accountId))[0].n);

  // A CRM task bound to a scheduled message on this account would be orphaned.
  let orphanTasks = 0;
  try {
    orphanTasks = Number((await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "Task" t
       JOIN "WhatsAppScheduledMessage" m ON m.id = t."whatsappScheduledMessageId"
       WHERE m."accountId" = $1`, accountId))[0].n);
  } catch { orphanTasks = null; }

  const otherConnected = await db.whatsAppAccount.count({
    where: { id: { not: accountId }, status: 'connected' },
  });

  return {
    accountId,
    account: {
      label: account.label, active: account.active, status: account.status, phoneJid: account.phoneJid,
    },
    counts,
    totalRows: Object.values(counts).reduce((n, v) => n + (v || 0), 0),
    linkedContacts,
    orphanTasks,
    otherConnected,
  };
}

/**
 * Execute. `expectedRows` binds the approval to the measured plan: if the
 * account gained messages between planning and execution (it is a LIVE number —
 * it was still receiving today), the run refuses rather than silently deleting
 * more than was reviewed.
 */
export async function executeAccountPurge(db, accountId, { expectedRows, dryRun = true } = {}) {
  const plan = await planAccountPurge(db, accountId);

  if (expectedRows === undefined || expectedRows === null) {
    const e = new Error('no_expected_rows: the purge must be approved against a measured row count');
    e.code = 'NO_EXPECTED_ROWS';
    throw e;
  }
  if (plan.totalRows !== expectedRows) {
    const e = new Error(
      `row_count_changed: approved ${expectedRows} rows but the account now holds ${plan.totalRows}. ` +
      `This is a live number — re-plan and re-approve.`);
    e.code = 'ROW_COUNT_CHANGED';
    throw e;
  }

  const result = { dryRun, accountId, deleted: {}, totalDeleted: 0 };
  if (dryRun) {
    result.deleted = { ...plan.counts, WhatsAppAccount: 1 };
    result.totalDeleted = plan.totalRows + 1;
    return result;
  }

  // Schema probing happens BEFORE the transaction, never inside it.
  //
  // Postgres poisons an entire transaction as soon as one statement errors —
  // "current transaction is aborted, commands ignored until end of transaction
  // block". Catching the JavaScript error does NOT reset that, so a
  // try/catch around a statement inside a transaction silently converts
  // "this table is absent" into "everything after it fails too". Probing up
  // front means every statement we then run is known-valid.
  const present = [];
  for (const t of WA_SCOPED_TABLES) {
    if (await tableExists(db, t)) present.push(t);
  }
  const taskLinkExists = await columnExists(db, 'Task', 'whatsappScheduledMessageId');

  await db.$transaction(async (tx) => {
    // A CRM task must not keep a pointer at a deleted scheduled message.
    if (taskLinkExists) {
      await tx.$executeRawUnsafe(
        `UPDATE "Task" SET "whatsappScheduledMessageId" = NULL
         WHERE "whatsappScheduledMessageId" IN (SELECT id FROM "WhatsAppScheduledMessage" WHERE "accountId" = $1)`,
        accountId);
    }

    for (const t of present) {
      const n = await tx.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "accountId" = $1`, accountId);
      result.deleted[t] = n;
      result.totalDeleted += n;
    }
    const n = await tx.$executeRawUnsafe(`DELETE FROM "WhatsAppAccount" WHERE id = $1`, accountId);
    result.deleted.WhatsAppAccount = n;
    result.totalDeleted += n;
  }, { timeout: 180_000, maxWait: 30_000 });

  return result;
}

/**
 * Prove the goal: nothing in production still points at this account.
 * Returns { clean, findings[] } — findings are places the id still appears.
 */
export async function verifyNoResidualDependency(db, accountId) {
  const findings = [];
  for (const t of [...WA_SCOPED_TABLES, 'WhatsAppAccount']) {
    try {
      const col = t === 'WhatsAppAccount' ? 'id' : 'accountId';
      const n = Number((await db.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM "${t}" WHERE "${col}" = $1`, accountId))[0].n);
      if (n > 0) findings.push({ table: t, rows: n });
    } catch { /* absent */ }
  }
  return { clean: findings.length === 0, findings };
}
