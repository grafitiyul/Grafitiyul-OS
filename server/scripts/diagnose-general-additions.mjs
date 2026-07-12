// READ-ONLY diagnostic — General Additions ("תוספת כללית") missing from
// the payroll Reports table (production follow-up, Part B audit).
//
// Prints, with ZERO writes:
//   1. Every GeneralActivity + its PayrollActivity (state, payrollMonth, date)
//   2. Every PayrollEntry on those activities (state, officeStatus,
//      guideStatus, externalPersonId, displayName, line count)
//   3. A simulation of the EXACT report query
//      (payrollEntry.findMany where state active + activity active +
//      payrollMonth in months) for the months the general activities live in,
//      split by sourceType — so we can see whether the report query itself
//      returns them.
//
// Run (from server/): railway run -- node scripts/diagnose-general-additions.mjs

import { PrismaClient } from '@prisma/client';

const dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);

function fmt(dt) {
  return dt ? new Date(dt).toISOString().replace('T', ' ').slice(0, 19) : '—';
}

async function main() {
  const generals = await prisma.generalActivity.findMany({
    include: {
      type: { select: { nameHe: true } },
      payrollActivity: {
        include: {
          entries: { include: { _count: { select: { lines: true } } } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`\n═══ GeneralActivity rows: ${generals.length} ═══`);
  const monthsSeen = new Set();
  for (const g of generals) {
    const pa = g.payrollActivity;
    monthsSeen.add(g.payrollMonth);
    console.log(
      `\n▸ ${g.titleHe} (${g.type?.nameHe || '?'}) — GeneralActivity ${g.id}` +
        `\n  payrollMonth=${JSON.stringify(g.payrollMonth)} date=${JSON.stringify(g.date)} createdAt=${fmt(g.createdAt)}`,
    );
    if (!pa) {
      console.log('  ⚠️ NO PayrollActivity linked!');
      continue;
    }
    console.log(
      `  PayrollActivity ${pa.id}: state=${pa.state} sourceType=${pa.sourceType}` +
        ` payrollMonth=${JSON.stringify(pa.payrollMonth)} date=${JSON.stringify(pa.date)} entries=${pa.entries.length}`,
    );
    for (const e of pa.entries) {
      console.log(
        `    • ${e.displayName} [${e.externalPersonId}] state=${e.state}` +
          ` office=${e.officeStatus} guide=${e.guideStatus} inquiry=${e.inquiryStatus} lines=${e._count.lines}`,
      );
    }
  }

  // Simulate the report query for every month a general activity lives in.
  const months = [...monthsSeen].filter(Boolean).sort();
  console.log(`\n═══ Report-query simulation for months: ${months.join(', ') || '(none)'} ═══`);
  if (months.length) {
    const reportEntries = await prisma.payrollEntry.findMany({
      where: { state: 'active', activity: { state: 'active', payrollMonth: { in: months } } },
      include: { activity: { select: { sourceType: true, payrollMonth: true, titleHe: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const bySource = new Map();
    for (const e of reportEntries) {
      const k = e.activity.sourceType;
      bySource.set(k, (bySource.get(k) || 0) + 1);
    }
    console.log(`  total entries the report WHERE returns: ${reportEntries.length}`);
    for (const [k, n] of bySource) console.log(`    sourceType=${k}: ${n}`);
    for (const e of reportEntries.filter((x) => x.activity.sourceType === 'general')) {
      console.log(
        `    general → ${e.displayName} month=${e.activity.payrollMonth} office=${e.officeStatus} guide=${e.guideStatus}`,
      );
    }
  }

  // All payroll months present in PayrollActivity, for the filter picture.
  const allMonths = await prisma.payrollActivity.groupBy({
    by: ['payrollMonth', 'sourceType', 'state'],
    _count: { _all: true },
    orderBy: [{ payrollMonth: 'asc' }],
  });
  console.log('\n═══ PayrollActivity by (payrollMonth, sourceType, state) ═══');
  for (const r of allMonths) {
    console.log(`  ${r.payrollMonth} · ${r.sourceType} · ${r.state}: ${r._count._all}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
