// THE one create-or-activate path for a generated open-tour occurrence.
//
// The canonical identity of a generated slot is (openTourTemplateId, date,
// startTime) — never the rule id. Existence is checked on that identity, so a
// rule delete+recreate (new rule id, same Thursday) or two concurrent generation
// runs can NEVER mint a second active occurrence: an existing active slot is
// kept (and only its stale rule attribution repaired), a cancelled twin is
// reopened in place (preserving its registrations/bookings/assignments/Woo
// history), and only when neither exists is a fresh row created — atomically,
// via ON CONFLICT DO NOTHING against the partial unique index
// (TourEvent_active_generated_slot_key). Generation, regeneration after an
// exception deletion, reopening and repair all funnel through here.

import { weekdayOf } from './slotGeneration.js';
import { calendarPendingPatch } from './calendar/service.js';
import { wooPendingPatch } from './woo/service.js';
import { seedTourComponents } from './tourComponents.js';

// A slot in one of these statuses OCCUPIES its logical occurrence — a second
// active row must never be created (postponed carries a null date, so it never
// collides on the identity and is intentionally omitted here).
const ACTIVE_STATUSES = ['scheduled', 'completed'];

// Postgres unique_violation (Prisma maps 23505 → P2002 even for a raw partial
// index) or the index surfaced by name.
function isUniqueViolation(e) {
  return (
    e?.code === 'P2002' ||
    /unique constraint|duplicate key|TourEvent_active_generated_slot_key/i.test(String(e?.message || ''))
  );
}

// PURE: the active rule that currently OWNS (date, startTime), or null when none
// (a manual/replacement slot) or ambiguous (two rules at the same weekday+time —
// left untouched rather than guessed). `timeOverrides` is date→time.
export function owningRuleId(date, startTime, rules = [], timeOverrides = new Map()) {
  const wd = weekdayOf(date);
  const matches = (rules || []).filter((r) => {
    if (r.weekday !== wd) return false;
    if (r.validFrom && date < r.validFrom) return false;
    if (r.validUntil && date > r.validUntil) return false;
    const eff = timeOverrides.get(date) || r.startTime;
    return eff === startTime;
  });
  return matches.length === 1 ? matches[0].id : null;
}

// PURE: every (date, startTime, ruleId) the active rules require ON A SINGLE
// date — used by the exception-deletion reopen (a cancel might have hidden more
// than one rule's occurrence on that date). Ignores the generation cursor.
export function requiredSlotsForDate(rules = [], date, timeOverrides = new Map()) {
  const wd = weekdayOf(date);
  const out = [];
  for (const r of rules || []) {
    if (r.weekday !== wd) continue;
    if (r.validFrom && date < r.validFrom) continue;
    if (r.validUntil && date > r.validUntil) continue;
    out.push({ date, startTime: timeOverrides.get(date) || r.startTime, generatedByRuleId: r.id });
  }
  return out;
}

// spec: { openTourTemplateId, date, startTime, generatedByRuleId, productId?,
//         productVariantId?, locationId?, tourLanguage?, capacity? }
// Returns { outcome: 'exists'|'reattributed'|'reopened'|'created'|'race_lost', id }.
export async function ensureCanonicalSlot(client, spec, { log = null } = {}) {
  const identity = {
    openTourTemplateId: spec.openTourTemplateId,
    date: spec.date,
    startTime: spec.startTime,
    kind: 'group_slot',
  };

  // 1. Active occurrence already present → keep it, only repair stale attribution
  //    (a dead-rule slot is invisible to ruleEdit, which queries by rule id).
  const active = await client.tourEvent.findFirst({
    where: { ...identity, status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, generatedByRuleId: true },
  });
  if (active) {
    if (spec.generatedByRuleId && active.generatedByRuleId !== spec.generatedByRuleId) {
      await client.tourEvent.update({
        where: { id: active.id },
        data: { generatedByRuleId: spec.generatedByRuleId },
      });
      log?.log?.(
        `[canonical-slot] re-attributed ${active.id} (${spec.date} ${spec.startTime}) → rule ${spec.generatedByRuleId}`,
      );
      return { outcome: 'reattributed', id: active.id };
    }
    return { outcome: 'exists', id: active.id };
  }

  // 2. Reopen a cancelled twin in place (preferring one already owned by the
  //    target rule, then most Woo history, then oldest) — never a fresh create
  //    when a genuine occurrence row exists to revive.
  const cancelled = await client.tourEvent.findMany({
    where: { ...identity, status: 'cancelled' },
    select: {
      id: true,
      generatedByRuleId: true,
      createdAt: true,
      _count: { select: { wooVariationLinks: true } },
    },
  });
  if (cancelled.length) {
    cancelled.sort((a, b) => {
      const owned = (x) => (x.generatedByRuleId === spec.generatedByRuleId ? 1 : 0);
      if (owned(a) !== owned(b)) return owned(b) - owned(a);
      if (a._count.wooVariationLinks !== b._count.wooVariationLinks)
        return b._count.wooVariationLinks - a._count.wooVariationLinks;
      return a.createdAt < b.createdAt ? -1 : 1;
    });
    const pick = cancelled[0];
    try {
      await client.tourEvent.update({
        where: { id: pick.id },
        data: {
          status: 'scheduled',
          cancelledAt: null,
          generatedByRuleId: spec.generatedByRuleId ?? pick.generatedByRuleId,
          ...calendarPendingPatch(),
          // 'auto' — a genuine lifecycle reactivation. If the row already carries
          // Woo links it re-publishes; a never-linked row still respects the
          // first-publication gate (bulk/sync-one).
          ...wooPendingPatch('auto'),
        },
      });
      log?.log?.(`[canonical-slot] reopened ${pick.id} (${spec.date} ${spec.startTime})`);
      return { outcome: 'reopened', id: pick.id };
    } catch (e) {
      if (isUniqueViolation(e)) {
        log?.warn?.(
          `[canonical-slot] reopen race lost (${spec.date} ${spec.startTime}) — active slot already exists`,
        );
        const winner = await client.tourEvent.findFirst({
          where: { ...identity, status: { in: ACTIVE_STATUSES } },
          select: { id: true },
        });
        return { outcome: 'race_lost', id: winner?.id ?? null };
      }
      throw e;
    }
  }

  // 3. Create fresh — atomic ON CONFLICT DO NOTHING. count 0 ⇒ a concurrent run
  //    won the race; converge to its row and log the loss.
  const res = await client.tourEvent.createMany({
    data: [{ ...spec, kind: 'group_slot', status: 'scheduled' }],
    skipDuplicates: true,
  });
  if (res.count === 0) {
    log?.warn?.(`[canonical-slot] create race lost (${spec.date} ${spec.startTime})`);
    const winner = await client.tourEvent.findFirst({
      where: { ...identity, status: { in: ACTIVE_STATUSES } },
      select: { id: true },
    });
    return { outcome: 'race_lost', id: winner?.id ?? null };
  }
  const created = await client.tourEvent.findFirst({
    where: { ...identity, status: 'scheduled' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (created && spec.productVariantId) await seedTourComponents(client, created.id, spec.productVariantId);
  return { outcome: 'created', id: created?.id ?? null };
}
