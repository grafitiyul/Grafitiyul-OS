// CRM Tasks WORKSPACE — the canonical cross-deal read API.
//
// Mounted admin-only (requireAdminAuth) in index.js — this router carries no
// auth of its own, per the project's mount-site convention.
//
// This is the read side of the operational task workspace (the first CRM tab).
// It is deliberately SEPARATE from routes/dealTasks.js, which serves ONE deal's
// task strip: that endpoint is deal-scoped, unpaginated and unsorted, and
// cannot answer "every open call across every deal, due today".
//
// This router is a THIN CALLER. Every rule lives in pure, unit-tested modules:
//   tasks/windows.js   — what "היום" / "השבוע" mean (disjoint, Asia/Jerusalem)
//   tasks/taskQuery.js — the canonical filter object, sortable whitelist, where
//   tasks/priority.js  — semantic priority order (high > medium > low > none)
// There are no HTTP route tests in this codebase; logic placed HERE would be
// untestable, so it does not go here.
//
// ZERO N+1 by construction: to-one data rides on the main query's `include`;
// to-many data (customer, phone/email, operational tour, WhatsApp schedule) is
// resolved by BOUNDED batch queries over the returned page only — never per row.

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { adminDisplayName } from '../admin/displayName.js';
import { comparePriority } from '../tasks/priority.js';
import { userOrigin, completeTask, cancelTask, applyTaskPatch } from '../tasks/taskService.js';
import { parseBulkRequest, chunkIds, summarizeResults } from '../tasks/bulkActions.js';
import { openStream } from '../realtime/sse.js';
import { TASKS_CHANNEL } from '../tasks/events.js';
import { resolveWindow, countScanBounds, bucketOf, WINDOWS } from '../tasks/windows.js';
import {
  parseTaskQuery, buildTaskWhere, buildBaseWhere, buildTaskOrderBy,
  needsInMemorySort, countScanWhere, PRIORITY_SORT_CAP,
} from '../tasks/taskQuery.js';
import { israelToday, startOfDayUtc } from '../lib/israelDate.js';

const router = Router();

// To-ONE data only. Every field here is reachable from Task through to-one
// relations, which is exactly the rule that makes a column sortable (§4).
const TASK_INCLUDE = {
  taskType: { select: { id: true, key: true, nameHe: true, icon: true, color: true, channel: true, sortOrder: true } },
  owner: { select: { id: true, username: true, displayName: true } },
  deal: {
    select: {
      id: true,
      orderNo: true,
      title: true,
      status: true,
      participants: true,
      // The Deal's PLANNED tour date (pre-WON sales field). NOT the operational
      // TourEvent date — that is to-many and arrives via hydration below. The
      // two are different facts and are never merged (decision #12).
      tourDate: true,
      tourTime: true,
      communicationLanguage: true,
      dealStage: { select: { id: true, key: true, label: true, sortOrder: true } },
      organization: { select: { id: true, name: true } },
      product: { select: { id: true, nameHe: true } },
      productVariant: { select: { id: true, location: { select: { id: true, nameHe: true } } } },
      location: { select: { id: true, nameHe: true } },
    },
  },
};

/**
 * Batch-resolve every DISPLAY-ONLY column for one page of tasks.
 * Three queries for the whole page, regardless of page size. Never per row.
 */
async function hydratePage(tasks) {
  const dealIds = [...new Set(tasks.map((t) => t.dealId).filter(Boolean))];
  const schedIds = [...new Set(tasks.map((t) => t.scheduledMessageId).filter(Boolean))];

  const [contactLinks, bookings, scheduled] = await Promise.all([
    dealIds.length
      ? prisma.dealContact.findMany({
          where: { dealId: { in: dealIds }, isPrimary: true },
          select: {
            dealId: true,
            contact: {
              select: {
                id: true, firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true,
                phones: { select: { value: true }, take: 1 },
                emails: { select: { value: true }, take: 1 },
              },
            },
          },
        })
      : [],
    dealIds.length
      ? prisma.booking.findMany({
          where: { dealId: { in: dealIds }, status: 'active' },
          select: {
            dealId: true,
            tourEvent: { select: { id: true, date: true, startTime: true, status: true } },
          },
        })
      : [],
    schedIds.length
      ? prisma.whatsAppScheduledMessage.findMany({
          where: { id: { in: schedIds } },
          select: { id: true, status: true, scheduledAt: true, failureReason: true, sentAt: true },
        })
      : [],
  ]);

  const customerByDeal = new Map();
  for (const link of contactLinks) {
    if (!link.contact) continue;
    const c = link.contact;
    const he = [c.firstNameHe, c.lastNameHe].filter(Boolean).join(' ').trim();
    const en = [c.firstNameEn, c.lastNameEn].filter(Boolean).join(' ').trim();
    customerByDeal.set(link.dealId, {
      id: c.id,
      name: he || en || null,
      phone: c.phones[0]?.value ?? null,
      email: c.emails[0]?.value ?? null,
    });
  }

  // The OPERATIONAL tour: the nearest non-cancelled upcoming event, else the
  // most recent past one. Booking[] is to-many, which is exactly why this
  // column is display-only and cannot be sorted in SQL.
  const today = israelToday();
  const toursByDeal = new Map();
  for (const b of bookings) {
    const ev = b.tourEvent;
    if (!ev || ev.status === 'cancelled' || !ev.date) continue;
    const prev = toursByDeal.get(b.dealId);
    if (!prev) { toursByDeal.set(b.dealId, ev); continue; }
    const better =
      (ev.date >= today && prev.date < today) ||
      (ev.date >= today && prev.date >= today && ev.date < prev.date) ||
      (ev.date < today && prev.date < today && ev.date > prev.date);
    if (better) toursByDeal.set(b.dealId, ev);
  }

  const schedById = new Map(scheduled.map((s) => [s.id, s]));

  return tasks.map((t) => {
    const customer = customerByDeal.get(t.dealId) ?? null;
    const tour = toursByDeal.get(t.dealId) ?? null;
    return {
      id: t.id,
      title: t.title,
      dueDate: t.dueDate,
      dueTime: t.dueTime,
      priority: t.priority,
      status: t.status,
      completedAt: t.completedAt,
      cancelledAt: t.cancelledAt,
      notes: t.notes,
      channel: t.channel,
      createdAt: t.createdAt,
      taskType: t.taskType
        ? { id: t.taskType.id, key: t.taskType.key, nameHe: t.taskType.nameHe, icon: t.taskType.icon, color: t.taskType.color, channel: t.taskType.channel }
        : null,
      // Icon fallback mirrors routes/dealTasks.js so a task looks identical in
      // the workspace and on the Deal.
      icon: t.taskType?.icon ?? (t.channel === 'whatsapp' ? 'whatsapp' : 'check'),
      owner: t.owner ? { id: t.owner.id, name: adminDisplayName(t.owner) } : null,
      deal: t.deal
        ? {
            id: t.deal.id,
            orderNo: t.deal.orderNo,
            title: t.deal.title,
            status: t.deal.status,
            participants: t.deal.participants,
            plannedTourDate: t.deal.tourDate,
            plannedTourTime: t.deal.tourTime,
            communicationLanguage: t.deal.communicationLanguage,
            stage: t.deal.dealStage ? { id: t.deal.dealStage.id, label: t.deal.dealStage.label } : null,
            organization: t.deal.organization ? { id: t.deal.organization.id, name: t.deal.organization.name } : null,
            product: t.deal.product ? { id: t.deal.product.id, name: t.deal.product.nameHe } : null,
            variant: t.deal.productVariant?.location ? { id: t.deal.productVariant.id, name: t.deal.productVariant.location.nameHe } : null,
            city: t.deal.location ? { id: t.deal.location.id, name: t.deal.location.nameHe } : null,
          }
        : null,
      customer,
      // Display-only: the real operational tour, distinct from plannedTourDate.
      upcomingTour: tour ? { id: tour.id, date: tour.date, startTime: tour.startTime, status: tour.status } : null,
      scheduled: t.scheduledMessageId ? schedById.get(t.scheduledMessageId) ?? null : null,
    };
  });
}

// GET /api/tasks — the workspace grid.
router.get(
  '/',
  handle(async (req, res) => {
    const parsed = parseTaskQuery(req.query);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const { filters, resolved, sort, page, pageSize, today } = parsed;
    const base = { today, window: filters.window, sort, page, pageSize };

    // An empty window (השבוע on Fri/Sat) has no dates at all. Return zero rows
    // without touching the database rather than issuing an impossible range.
    if (resolved.empty) {
      return res.json({ ...base, rows: [], total: 0, truncated: false, empty: true });
    }

    const where = buildTaskWhere(filters, resolved);
    const skip = (page - 1) * pageSize;

    // ── the priority path ──
    // Prisma cannot order by a CASE, and the canonical `where` lives in Prisma,
    // so a raw ORDER BY would still need the filtered id set first — it buys
    // nothing and would duplicate the filter into SQL. Instead: fetch the
    // matching rows NARROW (three columns), order with the shared comparator,
    // then hydrate only the page. Bounded by PRIORITY_SORT_CAP with `truncated`.
    if (needsInMemorySort(sort)) {
      const narrow = await prisma.task.findMany({
        where,
        select: { id: true, priority: true, dueDate: true },
        take: PRIORITY_SORT_CAP + 1,
      });
      const truncated = narrow.length > PRIORITY_SORT_CAP;
      const rowsAll = truncated ? narrow.slice(0, PRIORITY_SORT_CAP) : narrow;

      const dir = sort.find((s) => s.key === 'priority').dir;
      rowsAll.sort(
        (a, b) =>
          comparePriority(a.priority, b.priority, dir) ||
          a.dueDate - b.dueDate ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );

      const pageIds = rowsAll.slice(skip, skip + pageSize).map((r) => r.id);
      if (!pageIds.length) {
        return res.json({ ...base, rows: [], total: rowsAll.length, truncated, empty: false });
      }
      const full = await prisma.task.findMany({ where: { id: { in: pageIds } }, include: TASK_INCLUDE });
      const byId = new Map(full.map((t) => [t.id, t]));
      const ordered = pageIds.map((id) => byId.get(id)).filter(Boolean);
      return res.json({
        ...base,
        rows: await hydratePage(ordered),
        total: rowsAll.length,
        truncated,
        empty: false,
      });
    }

    // ── the normal path: real SQL ordering + offset pagination ──
    const [total, rows] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({ where, include: TASK_INCLUDE, orderBy: buildTaskOrderBy(sort), skip, take: pageSize }),
    ]);

    res.json({ ...base, rows: await hydratePage(rows), total, truncated: false, empty: false });
  }),
);

// GET /api/tasks/counts — the number inside each time chip.
//
// TWO queries, not six: one narrow scan over today..end-of-next-week bucketed
// in memory, plus one count for overdue (which is unbounded backwards and so
// cannot join the bucketed scan). Applies every filter EXCEPT the window, via
// the same buildBaseWhere the grid uses — if these diverged, the counts would
// lie about what the grid will show.
router.get(
  '/counts',
  handle(async (req, res) => {
    // The window is irrelevant here; force a valid one so parsing succeeds and
    // an overdue+completed combination cannot 400 the whole count bar.
    const parsed = parseTaskQuery({ ...req.query, window: 'today', status: req.query.status });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const { filters, today } = parsed;
    const scan = countScanBounds({ today });
    const base = buildBaseWhere(filters);

    const [forward, overdue] = await Promise.all([
      prisma.task.findMany({
        where: { ...base, dueDate: countScanWhere(scan.from, scan.to) },
        select: { dueDate: true },
      }),
      // Overdue is always about OPEN tasks — that is what the chip means,
      // whatever the status filter says.
      prisma.task.count({
        where: { ...base, status: 'open', dueDate: { lt: startOfDayUtc(today) } },
      }),
    ]);

    const counts = { overdue, today: 0, tomorrow: 0, this_week: 0, next_week: 0 };
    for (const row of forward) {
      // dueDate is a calendar date anchored at UTC midnight (see israelDate.js).
      const bucket = bucketOf(row.dueDate.toISOString().slice(0, 10), { today });
      if (bucket) counts[bucket] += 1;
    }

    // A window with no dates cannot have a count; the chip renders disabled.
    const empty = {};
    for (const w of WINDOWS) {
      if (w === 'range') continue;
      empty[w] = Boolean(resolveWindow(w, { today }).empty);
    }

    res.json({ today, counts, empty });
  }),
);

// GET /api/tasks/stream — SSE invalidation hints (shared realtime hub; same
// contract as /api/payroll/stream). Every subscriber is an admin (mount-site
// auth), so there is no per-subscriber filtering. Exact path, so the PATCH
// /:id param route below can never shadow it.
router.get('/stream', (req, res) => {
  openStream(req, res, { channel: TASKS_CHANNEL, scope: 'admin' });
});

// ── Writes ───────────────────────────────────────────────────────────────────
// Both endpoints are THIN CALLERS of taskService — the same canonical write
// path the Deal tab's routes delegate to. No task-mutation rule lives here.

// PATCH /api/tasks/:id — single-row field edit (the workspace's inline cells).
router.patch(
  '/:id',
  handle(async (req, res) => {
    const origin = await userOrigin(req.adminAuth?.userId);
    const result = await applyTaskPatch(req.params.id, req.body, { origin });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true, id: result.task.id });
  }),
);

// POST /api/tasks/bulk — complete / cancel (never delete) / assign_owner /
// set_due_date / set_due_time / set_priority / set_type over an id list.
//
// Each task is processed individually (transitions already run in their own
// transaction, preserving the one-TimelineEntry-per-transition audit), in
// slices of BULK_CHUNK_SIZE, ids capped at MAX_BULK_IDS. Partial failure is the
// NORMAL case: the response reports every row, never a blanket success.
router.post(
  '/bulk',
  handle(async (req, res) => {
    const parsed = parseBulkRequest(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const { action, ids, patch } = parsed;
    const origin = await userOrigin(req.adminAuth?.userId);

    const results = [];
    for (const chunk of chunkIds(ids)) {
      for (const id of chunk) {
        try {
          const r =
            action === 'complete'
              ? await completeTask(id, origin)
              : action === 'cancel'
                ? await cancelTask(id, origin)
                : await applyTaskPatch(id, patch, { origin });
          results.push(r.ok ? { id, ok: true } : { id, ok: false, error: r.error });
        } catch (e) {
          console.warn('[tasks/bulk] row failed', id, e?.message);
          results.push({ id, ok: false, error: 'internal' });
        }
      }
    }

    res.json(summarizeResults(results));
  }),
);

export default router;
