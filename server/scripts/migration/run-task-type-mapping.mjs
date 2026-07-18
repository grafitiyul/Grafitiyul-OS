// Historical task-type mapping runner (Slice A). Additive + idempotent.
//   railway run --service Grafitiyul-OS node server/scripts/migration/run-task-type-mapping.mjs [--execute]
//
// - Sets taskTypeId on IMPORTED tasks (entityType Task) where it is null, per
//   the approved map. Native tasks untouched. Type is a label only — channel and
//   scheduledMessageId are never written, so a whatsapp-typed task can't send.
// - Imported tasks whose source activity type is NOT in the map are demoted to
//   historical timeline evidence (task deleted, crosswalk repointed).
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';
import { planTaskTypeBackfill } from '../../src/migration/import/taskTypeMapping.js';
import { sanitizeLegacyHtml, pdIso } from '../../src/migration/import/enrichmentImport.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const EXECUTE = process.argv.includes('--execute');
const SNAP = arg('--snapshot') || 'snap-20260714T125052Z-aaaa';
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId: SNAP });
async function stream(key, visit) { const m = await reader.entityManifest(key); for (const s of m.shards || []) { for (const r of await reader.readShard(s.key)) visit(r); reader._shardCache.clear(); } }
const t = (s) => String(s ?? '').trim();
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ref = JSON.parse(await r2.getObjectText(`snapshots/${SNAP}/pipedrive/reference/reference.json`));
const typeLabel = new Map((ref.activityTypes || []).map((x) => [x.key_string ?? x.key, x.name]));

// imported task crosswalk: activity id → task id
const xw = await prisma.legacyRecord.findMany({ where: { sourceSystem: 'pipedrive', sourceType: 'activity', entityType: 'Task' }, select: { id: true, sourceId: true, entityId: true } });
const taskByActivity = new Map(xw.map((r) => [r.sourceId, r.entityId]));
const xwByActivity = new Map(xw.map((r) => [r.sourceId, r.id]));
const wantActivity = new Set(xw.map((r) => r.sourceId));
console.log(`imported task crosswalks: ${xw.length}`);

// source activities we care about
const actById = new Map();
await stream('pipedrive/activities', (a) => { if (wantActivity.has(String(a.id))) actById.set(String(a.id), a); });

// current task rows + GOS TaskType catalog
const taskIds = [...taskByActivity.values()];
const tasks = await prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, taskTypeId: true, dealId: true, channel: true, scheduledMessageId: true } });
const taskById = new Map(tasks.map((t2) => [t2.id, t2]));
const catalog = await prisma.taskType.findMany({ select: { id: true, key: true, channel: true } });
const taskTypeIdByKey = new Map(catalog.map((c) => [c.key, c.id]));

// build items
const items = [];
for (const [actId, taskId] of taskByActivity) {
  const task = taskById.get(taskId);
  if (!task) continue; // already demoted/removed
  const a = actById.get(actId);
  items.push({ taskId, taskTypeId: task.taskTypeId, typeLabel: typeLabel.get(a?.type) || a?.type || '', rawKey: a?.type || '', actId });
}
const plan = planTaskTypeBackfill(items, taskTypeIdByKey);
console.log('\n══ PLAN ══');
console.log(`items ${plan.stats.total} · setType ${plan.stats.setType} · demote ${plan.stats.demote} · already-typed ${plan.skip.alreadyTyped} · unknown-target ${plan.skip.unknownTarget}`);
console.log('by target:', JSON.stringify(plan.stats.byTarget));
console.log('unmapped (→ evidence):', JSON.stringify(plan.stats.byUnmapped));

// WhatsApp safety assertion over the whole imported set
const unsafe = tasks.filter((t2) => t2.channel !== 'none' || t2.scheduledMessageId != null);
console.log(`\nWhatsApp safety: imported tasks with channel≠none or a scheduledMessageId = ${unsafe.length} (must be 0)`);
if (unsafe.length) { console.error('ABORT: an imported task is wired to a send path'); await prisma.$disconnect(); process.exit(2); }

if (!EXECUTE) { console.log('\n--dry: nothing written.'); await prisma.$disconnect(); process.exit(0); }

// ── execute ──
const batchId = `tasktypes-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
const run = await prisma.migrationRun.create({ data: { kind: 'import', target: 'import.task_types', status: 'running', snapshotId: SNAP, batchId, startedAt: new Date(), counters: plan.stats } });
try {
  // setType: label only — never channel/scheduledMessageId
  for (const s of plan.setType) await prisma.task.update({ where: { id: s.taskId }, data: { taskTypeId: s.typeId } });
  // demote: unmapped imported tasks become historical timeline evidence
  let demoted = 0;
  for (const d of plan.demote) {
    const task = taskById.get(d.taskId);
    const item = items.find((x) => x.taskId === d.taskId);
    const a = actById.get(item.actId);
    const note = sanitizeLegacyHtml(a?.note);
    const subject = t(a?.subject);
    const header = `${d.typeLabel || 'פעילות'}${subject ? ` · ${subject}` : ''}`;
    const when = pdIso(a?.marked_as_done_time || a?.due_date || a?.add_time) || new Date().toISOString();
    await prisma.$transaction(async (tx) => {
      const te = await tx.timelineEntry.create({ data: {
        subjectType: 'deal', subjectId: task.dealId, kind: 'note', isSystem: true,
        body: `<div><b>${escapeHtml(header)}</b></div>${note ? `<div>${note}</div>` : ''}`,
        actorType: 'import', actorLabel: 'ייבוא: פעילות מ-Pipedrive', createdAt: new Date(when),
      } });
      await tx.legacyRecord.update({ where: { id: xwByActivity.get(item.actId) }, data: { entityType: 'TimelineEntry', entityId: te.id, importBatchId: batchId } });
      await tx.task.delete({ where: { id: d.taskId } });
    });
    demoted += 1;
  }
  await prisma.migrationRun.update({ where: { id: run.id }, data: { status: 'done', finishedAt: new Date(), counters: { ...plan.stats, applied: plan.setType.length, demoted } } });
  console.log(`\n✔ set types ${plan.setType.length} · demoted ${demoted}`);
} catch (e) {
  await prisma.migrationRun.update({ where: { id: run.id }, data: { status: 'failed', finishedAt: new Date(), error: String(e?.message || e).slice(0, 500) } });
  console.error('FAILED:', e?.message || e); process.exit(3);
}

// ── verify ──
console.log('\n══ VERIFY ══');
const impTaskIds = [...taskByActivity.values()];
const stillTasks = await prisma.task.findMany({ where: { id: { in: impTaskIds } }, select: { id: true, taskTypeId: true, channel: true, scheduledMessageId: true, taskType: { select: { nameHe: true, channel: true } } } });
console.log(`imported tasks remaining: ${stillTasks.length}`);
console.log('typed:', stillTasks.filter((t2) => t2.taskTypeId).length, '· null-type:', stillTasks.filter((t2) => !t2.taskTypeId).length);
console.log('by type:', JSON.stringify(stillTasks.reduce((m, t2) => ((m[t2.taskType?.nameHe || 'null'] = (m[t2.taskType?.nameHe || 'null'] || 0) + 1), m), {})));
console.log('any channel≠none:', stillTasks.filter((t2) => t2.channel !== 'none').length, '· any scheduledMessageId:', stillTasks.filter((t2) => t2.scheduledMessageId != null).length);
console.log('native tasks (not crosswalked) unchanged:', await prisma.task.count({ where: { id: { notIn: impTaskIds } } }));
console.log('WhatsAppScheduledMessage total (must be unchanged by this run):', await prisma.whatsAppScheduledMessage.count());
await prisma.$disconnect();
