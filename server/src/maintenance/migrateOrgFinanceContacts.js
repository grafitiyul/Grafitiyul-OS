import { setOrganizationFinanceContact } from '../organizations/financeContact.js';

// Durable one-time backfill: legacy Organization finance scalars
// (financeContactName/financeEmail/financePhone) become CANONICAL Contacts —
// each org with finance data and no financeContactId is run through the ONE
// finance-contact service (phone-match → email-match → create, org membership
// link, designation, timeline entry, mirror rewrite). Idempotent: only rows
// with a null designation are touched; re-running is a no-op.
//
// "Ambiguous" rows (no email AND no phone — a bare name) cannot be identity-
// matched; a fresh Contact is created for them (never merged by name) and
// they are counted separately in the summary for the owner's review.
const KEY = 'migrate_org_finance_contacts_v1';
const STALE_MS = 15 * 60 * 1000;

export async function migrateOrgFinanceContacts(client, log = console) {
  const orgs = await client.organization.findMany({
    where: {
      financeContactId: null,
      OR: [
        { financeEmail: { not: null } },
        { financePhone: { not: null } },
        { financeContactName: { not: null } },
      ],
    },
    select: { id: true, name: true, financeContactName: true, financeEmail: true, financePhone: true },
  });

  const summary = { migrated: 0, matchedPhone: 0, matchedEmail: 0, created: 0, nameOnly: 0, failed: [] };
  for (const org of orgs) {
    try {
      const r = await client.$transaction((tx) =>
        setOrganizationFinanceContact(tx, {
          organizationId: org.id,
          name: org.financeContactName,
          email: org.financeEmail,
          phone: org.financePhone,
          source: 'migration',
        }),
      );
      summary.migrated += 1;
      if (r.matchedBy === 'phone') summary.matchedPhone += 1;
      else if (r.matchedBy === 'email') summary.matchedEmail += 1;
      else summary.created += 1;
      if (!org.financeEmail && !org.financePhone) summary.nameOnly += 1;
    } catch (e) {
      summary.failed.push({ organizationId: org.id, name: org.name, error: e?.code || e?.message });
      log?.warn?.(`[maintenance:${KEY}] org ${org.name} failed: ${e?.message}`);
    }
  }
  log?.log?.(
    `[maintenance:${KEY}] migrated ${summary.migrated}/${orgs.length} (phone ${summary.matchedPhone}, email ${summary.matchedEmail}, created ${summary.created}, name-only ${summary.nameOnly}, failed ${summary.failed.length})`,
  );
  return summary;
}

export async function startMigrateOrgFinanceContacts(client, log = console) {
  try {
    await client.maintenanceJob.upsert({ where: { key: KEY }, create: { key: KEY }, update: {} });
    const staleBefore = new Date(Date.now() - STALE_MS);
    const claimed = await client.maintenanceJob.updateMany({
      where: {
        key: KEY,
        OR: [
          { status: 'pending' },
          { status: 'failed' },
          { status: 'running', startedAt: { lt: staleBefore } },
        ],
      },
      data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return; // done, or another instance owns it
    const summary = await migrateOrgFinanceContacts(client, log);
    await client.maintenanceJob.update({
      where: { key: KEY },
      data: { status: summary.failed.length ? 'failed' : 'done', finishedAt: new Date(), summary, error: null },
    });
  } catch (e) {
    log?.warn?.(`[maintenance:${KEY}] failed: ${e?.message}`);
    await client.maintenanceJob
      .update({ where: { key: KEY }, data: { status: 'failed', error: String(e?.message || e).slice(0, 500) } })
      .catch(() => {});
  }
}
