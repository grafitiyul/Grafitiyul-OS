// READ-ONLY production census for the automatic-tasks slice (E3).
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const admins = await prisma.adminUser.findMany({ select: { id: true, username: true, isActive: true } });
console.log('=== AdminUsers ===');
for (const a of admins) console.log(`  ${a.id} ${a.username} ${a.isActive ? 'active' : 'INACTIVE'}`);

const types = await prisma.taskType.findMany({ select: { id: true, key: true, nameHe: true, isActive: true, isSystem: true, channel: true, defaultDueOffsetType: true, defaultTime: true, requiresTime: true } });
console.log('=== TaskTypes ===');
for (const t of types) console.log(`  ${t.id} key=${t.key} ${t.nameHe} active=${t.isActive} sys=${t.isSystem} ch=${t.channel} due=${t.defaultDueOffsetType} time=${t.defaultTime ?? '-'} reqTime=${t.requiresTime}`);

const openDeals = await prisma.deal.findMany({
  where: { status: 'open' },
  select: { id: true, orderNo: true, ownerUserId: true, createdAt: true, source: true, dealSource: { select: { label: true } } },
});
console.log(`\n=== open deals: ${openDeals.length} ===`);

const ownerCounts = {};
for (const d of openDeals) ownerCounts[d.ownerUserId || '(null)'] = (ownerCounts[d.ownerUserId || '(null)'] || 0) + 1;
console.log('open-deal ownerUserId distribution:', JSON.stringify(ownerCounts));

const tasks = await prisma.task.findMany({ select: { id: true, dealId: true, status: true, taskType: { select: { key: true, nameHe: true } } } });
console.log(`total tasks: ${tasks.length}; open tasks: ${tasks.filter((t) => t.status === 'open').length}`);
const byType = {};
for (const t of tasks) { const k = t.taskType?.nameHe || '(none)'; byType[k] = (byType[k] || 0) + 1; }
console.log('tasks by type:', JSON.stringify(byType));

const openTaskDealIds = new Set(tasks.filter((t) => t.status === 'open').map((t) => t.dealId));
const anyTaskDealIds = new Set(tasks.map((t) => t.dealId));
const withOpen = openDeals.filter((d) => openTaskDealIds.has(d.id));
const withoutOpen = openDeals.filter((d) => !openTaskDealIds.has(d.id));
const neverAnyTask = openDeals.filter((d) => !anyTaskDealIds.has(d.id));
console.log(`open deals WITH an open task: ${withOpen.length}`);
console.log(`open deals WITHOUT an open task: ${withoutOpen.length}`);
console.log(`open deals with NO task ever: ${neverAnyTask.length}`);

// Deal-source distribution of open deals without an open task (exclusion planning).
const srcCounts = {};
for (const d of withoutOpen) { const k = d.dealSource?.label || d.source || '(none)'; srcCounts[k] = (srcCounts[k] || 0) + 1; }
console.log('withoutOpen by source:', JSON.stringify(srcCounts, null, 1));

await prisma.$disconnect();
