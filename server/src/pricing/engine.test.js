// Engine unit tests (Slice A). Pure math — no DB. Run with `npm test` (node:test).
//
// Covers: legacy per_head/tiered (regression), the new `fixed` and `tiered_group`
// models, the "model comes from the winning rule, not the activity type" change,
// VAT splitting, and the deterministic resolution guards.

import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, splitVat, selectRule, priceAddon, addonApplies, sabbathHolidayWindow, resolveSystemAddonEntry, PricingError } from './engine.js';

// A minimal price list wrapper. VAT default excluded@0 so base math is visible
// 1:1 in net/gross unless a test overrides it.
function list(rules, overrides = {}) {
  return {
    id: 'pl1',
    nameHe: 'בדיקה',
    currency: 'ILS',
    isDefault: true,
    defaultVatMode: 'excluded',
    defaultVatRate: 0,
    rules,
    ...overrides,
  };
}

// activityType is intentionally given a CONFLICTING priceModel to prove the
// engine ignores it and reads the model off the winning rule.
const ACTIVITY = { id: 'at1', priceModel: 'per_head' };

function run(rules, counts, context = {}, listOverrides = {}) {
  return calculate({
    priceList: list(rules, listOverrides),
    activityType: ACTIVITY,
    context: { activityTypeId: 'at1', ...context },
    counts,
  });
}

// ── per_head (regression) ───────────────────────────────────────────────────
test('per_head: adult+child per person, ×groupCount', () => {
  const r = run(
    [{ id: 'r1', active: true, priceModel: 'per_head', adultPriceMinor: 10000n, childPriceMinor: 5000n, priority: 0 }],
    { adultCount: 3, childCount: 2, groupCount: 2 },
  );
  // (3*10000 + 2*5000) * 2 = 80000
  assert.equal(r.netMinor, 80000);
  assert.equal(r.priceModel, 'per_head');
});

// ── tiered (single-tier legacy, regression) ─────────────────────────────────
test('tiered: base up to N + per-additional above', () => {
  const r = run(
    [{ id: 'r1', active: true, priceModel: 'tiered', basePriceMinor: 100000n, baseParticipants: 10, perAdditionalParticipantMinor: 8000n, priority: 0 }],
    { participantCount: 13 },
  );
  // 100000 + 3*8000 = 124000
  assert.equal(r.netMinor, 124000);
});

// ── fixed (new) ─────────────────────────────────────────────────────────────
test('fixed: one flat total per group, count-independent', () => {
  const r = run(
    [{ id: 'r1', active: true, priceModel: 'fixed', fixedPriceMinor: 250000n, priority: 0 }],
    { participantCount: 99 },
  );
  assert.equal(r.netMinor, 250000);
});

test('fixed: ×groupCount', () => {
  const r = run(
    [{ id: 'r1', active: true, priceModel: 'fixed', fixedPriceMinor: 250000n, priority: 0 }],
    { participantCount: 5, groupCount: 3 },
  );
  assert.equal(r.netMinor, 750000);
});

test('fixed: missing price → rule_incomplete', () => {
  assert.throws(
    () => run([{ id: 'r1', active: true, priceModel: 'fixed', priority: 0 }], { participantCount: 5 }),
    (e) => e instanceof PricingError && e.code === 'rule_incomplete',
  );
});

// ── tiered_group (new — model 1) ────────────────────────────────────────────
// Ladder: up to 10 = 100000 total, up to 20 = 180000 total, above 20 = +15000 each.
const LADDER = {
  id: 'r1', active: true, priceModel: 'tiered_group', priority: 0,
  perAdditionalParticipantMinor: 15000n,
  tiers: [
    { uptoParticipants: 10, totalPriceMinor: 100000n, sortOrder: 0 },
    { uptoParticipants: 20, totalPriceMinor: 180000n, sortOrder: 1 },
  ],
};

test('tiered_group: within first tier → first total', () => {
  assert.equal(run([LADDER], { participantCount: 8 }).netMinor, 100000);
});
test('tiered_group: exactly at first tier bound → first total', () => {
  assert.equal(run([LADDER], { participantCount: 10 }).netMinor, 100000);
});
test('tiered_group: into second tier → second total', () => {
  assert.equal(run([LADDER], { participantCount: 15 }).netMinor, 180000);
});
test('tiered_group: exactly at top tier bound → second total', () => {
  assert.equal(run([LADDER], { participantCount: 20 }).netMinor, 180000);
});
test('tiered_group: above top tier → top total + overflow×perAdditional', () => {
  // 180000 + 3*15000 = 225000
  assert.equal(run([LADDER], { participantCount: 23 }).netMinor, 225000);
});
test('tiered_group: ×groupCount', () => {
  assert.equal(run([LADDER], { participantCount: 8, groupCount: 2 }).netMinor, 200000);
});
test('tiered_group: unsorted tiers are sorted before walking', () => {
  const unsorted = { ...LADDER, tiers: [LADDER.tiers[1], LADDER.tiers[0]] };
  assert.equal(run([unsorted], { participantCount: 8 }).netMinor, 100000);
});
test('tiered_group: no tiers → rule_incomplete', () => {
  assert.throws(
    () => run([{ id: 'r1', active: true, priceModel: 'tiered_group', tiers: [], priority: 0 }], { participantCount: 8 }),
    (e) => e instanceof PricingError && e.code === 'rule_incomplete',
  );
});

// ── ticket_types (new — model 4) ────────────────────────────────────────────
const TICKETS = {
  id: 'r1', active: true, priceModel: 'ticket_types', priority: 0,
  ticketPrices: [
    { ticketTypeId: 'adult', priceMinor: 12000n },
    { ticketTypeId: 'child', priceMinor: 9000n },
  ],
};

test('ticket_types: Σ quantity × price, with per-ticket line items', () => {
  const r = run([TICKETS], { ticketQuantities: { adult: 10, child: 5 } });
  // 10*12000 + 5*9000 = 165000
  assert.equal(r.netMinor, 165000);
  assert.equal(r.priceModel, 'ticket_types');
  assert.equal(r.debug.lines.length, 2);
  const adult = r.debug.lines.find((l) => l.ticketTypeId === 'adult');
  assert.equal(adult.quantity, 10);
  assert.equal(adult.lineMinor, 120000);
});
test('ticket_types: missing quantity counts as 0', () => {
  const r = run([TICKETS], { ticketQuantities: { adult: 3 } });
  assert.equal(r.netMinor, 36000);
});
test('ticket_types: no prices configured → rule_incomplete', () => {
  assert.throws(
    () => run([{ id: 'r1', active: true, priceModel: 'ticket_types', ticketPrices: [], priority: 0 }], { ticketQuantities: { adult: 1 } }),
    (e) => e instanceof PricingError && e.code === 'rule_incomplete',
  );
});
test('ticket_types respects VAT mode (added)', () => {
  const r = run([{ ...TICKETS, vatMode: 'excluded', vatRate: 18 }], { ticketQuantities: { adult: 10, child: 5 } });
  assert.equal(r.netMinor, 165000);
  assert.equal(r.vatMinor, 29700);
  assert.equal(r.grossMinor, 194700);
});

// ── model comes from the WINNING rule, not the activity type ────────────────
test('model is read from the resolved rule (activityType.priceModel ignored)', () => {
  // A specific tiered_group rule beats a wildcard per_head rule on specificity;
  // its OWN model must drive the math even though ACTIVITY.priceModel='per_head'.
  const specific = { ...LADDER, productId: 'p1' };
  const wildcard = { id: 'r2', active: true, priceModel: 'per_head', adultPriceMinor: 999999n, priority: 0 };
  const r = run([wildcard, specific], { participantCount: 8 }, { productId: 'p1' });
  assert.equal(r.priceModel, 'tiered_group');
  assert.equal(r.netMinor, 100000);
});

// ── VAT split ───────────────────────────────────────────────────────────────
test('VAT included: gross stays, net is back-computed', () => {
  const { netMinor, vatMinor, grossMinor } = splitVat(118000, 'included', 18);
  assert.equal(grossMinor, 118000);
  assert.equal(netMinor, 100000);
  assert.equal(vatMinor, 18000);
});
test('VAT excluded: vat added on top', () => {
  const { netMinor, vatMinor, grossMinor } = splitVat(100000, 'excluded', 18);
  assert.equal(netMinor, 100000);
  assert.equal(vatMinor, 18000);
  assert.equal(grossMinor, 118000);
});
test('VAT exempt: no vat, net = gross, rate ignored', () => {
  const { netMinor, vatMinor, grossMinor } = splitVat(100000, 'exempt', 18);
  assert.equal(netMinor, 100000);
  assert.equal(vatMinor, 0);
  assert.equal(grossMinor, 100000);
});
test('exempt via calculate end-to-end (fixed model)', () => {
  const r = run(
    [{ id: 'r1', active: true, priceModel: 'fixed', fixedPriceMinor: 250000n, vatMode: 'exempt', vatRate: 18, priority: 0 }],
    { participantCount: 1 },
  );
  assert.equal(r.netMinor, 250000);
  assert.equal(r.vatMinor, 0);
  assert.equal(r.grossMinor, 250000);
  assert.equal(r.vatMode, 'exempt');
});
test('rule VAT override beats price-list default', () => {
  const r = run(
    [{ id: 'r1', active: true, priceModel: 'fixed', fixedPriceMinor: 118000n, vatMode: 'included', vatRate: 18, priority: 0 }],
    { participantCount: 1 },
  );
  assert.equal(r.grossMinor, 118000);
  assert.equal(r.netMinor, 100000);
  assert.equal(r.vatMode, 'included');
});

// ── add-ons (card-level) ────────────────────────────────────────────────────
test('priceAddon inherits the card VAT when mode is null', () => {
  const r = priceAddon({ addonId: 'a', priceMinor: 25000, vatMode: null }, { vatMode: 'included', vatRate: 18 });
  assert.equal(r.grossMinor, 25000);
  assert.equal(r.netMinor, 21186);
  assert.equal(r.vatMode, 'included');
});
test('priceAddon overrides VAT (excluded) regardless of card', () => {
  const r = priceAddon({ addonId: 'a', priceMinor: 25000, vatMode: 'excluded', vatRate: 18 }, { vatMode: 'included', vatRate: 18 });
  assert.equal(r.netMinor, 25000);
  assert.equal(r.vatMinor, 4500);
  assert.equal(r.grossMinor, 29500);
});
test('priceAddon exempt forces 0 VAT', () => {
  const r = priceAddon({ addonId: 'a', priceMinor: 25000, vatMode: 'exempt' }, { vatMode: 'included', vatRate: 18 });
  assert.equal(r.vatMinor, 0);
  assert.equal(r.grossMinor, 25000);
});
// ── 3-level VAT: entry override → catalog → card ─────────────────────────────
test('priceAddon: catalog VAT used when entry inherits', () => {
  // entry vatMode null (inherit), catalog 'excluded' → uses excluded, not card.
  const r = priceAddon({ addonId: 'a', priceMinor: 25000, vatMode: null }, { vatMode: 'included', vatRate: 18 }, { vatMode: 'excluded', vatRate: 18 });
  assert.equal(r.vatMode, 'excluded');
  assert.equal(r.netMinor, 25000);
  assert.equal(r.grossMinor, 29500);
});
test('priceAddon: catalog "from card" (null) → card VAT (included)', () => {
  const r = priceAddon({ addonId: 'a', priceMinor: 25000, vatMode: null }, { vatMode: 'included', vatRate: 18 }, { vatMode: null });
  assert.equal(r.vatMode, 'included');
  assert.equal(r.grossMinor, 25000);
});
test('priceAddon: catalog "from card" follows an excluded card', () => {
  const r = priceAddon({ addonId: 'a', priceMinor: 25000, vatMode: null }, { vatMode: 'excluded', vatRate: 18 }, { vatMode: null });
  assert.equal(r.vatMode, 'excluded');
  assert.equal(r.grossMinor, 29500);
});
test('priceAddon: catalog "from card" follows an exempt card', () => {
  const r = priceAddon({ addonId: 'a', priceMinor: 25000, vatMode: null }, { vatMode: 'exempt', vatRate: 0 }, { vatMode: null });
  assert.equal(r.vatMode, 'exempt');
  assert.equal(r.vatMinor, 0);
});
test('priceAddon: per-card override beats catalog and card', () => {
  const r = priceAddon({ addonId: 'a', priceMinor: 25000, vatMode: 'exempt' }, { vatMode: 'included', vatRate: 18 }, { vatMode: 'excluded', vatRate: 18 });
  assert.equal(r.vatMode, 'exempt'); // entry override wins
});
test('addonApplies: manual only when toggled', () => {
  const e = { addonId: 'a', enabled: true, autoApply: 'manual' };
  assert.equal(addonApplies(e, { manualAddonIds: ['a'] }), true);
  assert.equal(addonApplies(e, { manualAddonIds: [] }), false);
});
test('addonApplies: weekdays match by getDay number', () => {
  const e = { addonId: 'a', enabled: true, autoApply: 'weekdays', autoApplyWeekdays: [6] };
  assert.equal(addonApplies(e, { weekday: 6 }), true);  // Saturday
  assert.equal(addonApplies(e, { weekday: 3 }), false);
});
test('addonApplies: disabled never applies', () => {
  assert.equal(addonApplies({ addonId: 'a', enabled: false, autoApply: 'manual' }, { manualAddonIds: ['a'] }), false);
});
test('addonApplies: sabbath_holiday follows ctx.isSabbathHoliday', () => {
  const e = { addonId: 'a', enabled: true, autoApply: 'sabbath_holiday' };
  assert.equal(addonApplies(e, { isSabbathHoliday: true }), true);
  assert.equal(addonApplies(e, { isSabbathHoliday: false }), false);
  assert.equal(addonApplies(e, {}), false);
});
test('sabbath_holiday addon + detector: applies on a configured Friday-15:00 window', () => {
  // the ONE detector decides; the addon just reads its result.
  const weekly = [{ active: true, dayOfWeek: 5, allDay: false, startMinute: 900, nameHe: 'כניסת שבת' }];
  const win = sabbathHolidayWindow({ weekday: 5, minuteOfDay: 960, dateISO: '2026-07-03' }, { weekly });
  const e = { addonId: 'a', enabled: true, autoApply: 'sabbath_holiday' };
  assert.equal(addonApplies(e, { isSabbathHoliday: win.applies }), true);
});
test('sabbath_holiday addon does NOT apply outside the window', () => {
  const weekly = [{ active: true, dayOfWeek: 5, allDay: false, startMinute: 900, nameHe: 'כניסת שבת' }];
  const win = sabbathHolidayWindow({ weekday: 5, minuteOfDay: 600, dateISO: '2026-07-03' }, { weekly });
  const e = { addonId: 'a', enabled: true, autoApply: 'sabbath_holiday' };
  assert.equal(addonApplies(e, { isSabbathHoliday: win.applies }), false);
});

// ── system add-on (שבת/חג) inherit ↔ override resolver ───────────────────────
const SYS = { id: 'sys', active: true, defaultPriceMinor: 25000, vatMode: 'included', vatRate: 18 };
test('resolveSystemAddonEntry: no override → catalog default price, VAT deferred', () => {
  const e = resolveSystemAddonEntry(SYS, null);
  assert.equal(e.priceMinor, 25000);
  assert.equal(e.vatMode, null); // VAT resolves later via catalog → card
  assert.equal(e.autoApply, 'sabbath_holiday');
});
test('resolveSystemAddonEntry: catalog price change reaches non-overridden cards', () => {
  const e = resolveSystemAddonEntry({ ...SYS, defaultPriceMinor: 40000 }, { priceMinor: null, vatMode: null });
  assert.equal(e.priceMinor, 40000); // inherited, follows the catalog
});
test('resolveSystemAddonEntry: per-field override (price overridden, VAT deferred)', () => {
  const e = resolveSystemAddonEntry(SYS, { priceMinor: 50000, vatMode: null });
  assert.equal(e.priceMinor, 50000);
  assert.equal(e.vatMode, null); // VAT still resolves via catalog → card
});
test('resolveSystemAddonEntry: card-disabled → null', () => {
  assert.equal(resolveSystemAddonEntry(SYS, { enabled: false }), null);
});
test('resolveSystemAddonEntry: global inactive kill-switch → null even if card overrides', () => {
  assert.equal(resolveSystemAddonEntry({ ...SYS, active: false }, { enabled: true, priceMinor: 99000 }), null);
});
test('resolveSystemAddonEntry: zero effective price → no line', () => {
  assert.equal(resolveSystemAddonEntry({ ...SYS, defaultPriceMinor: 0 }, null), null);
});

// ── שעות שבת וחג detector ────────────────────────────────────────────────────
const WEEKLY = [
  { active: true, dayOfWeek: 6, allDay: true, nameHe: 'שבת' },              // Saturday all day
  { active: true, dayOfWeek: 5, allDay: false, startMinute: 900, nameHe: 'כניסת שבת' }, // Fri 15:00+
];
test('detector: Saturday all-day window applies', () => {
  const r = sabbathHolidayWindow({ weekday: 6, minuteOfDay: 600, dateISO: '2026-07-04' }, { weekly: WEEKLY });
  assert.equal(r.applies, true);
  assert.equal(r.type, 'shabbat');
});
test('detector: Friday before 15:00 does not apply, after does', () => {
  assert.equal(sabbathHolidayWindow({ weekday: 5, minuteOfDay: 840, dateISO: '2026-07-03' }, { weekly: WEEKLY }).applies, false);
  assert.equal(sabbathHolidayWindow({ weekday: 5, minuteOfDay: 960, dateISO: '2026-07-03' }, { weekly: WEEKLY }).applies, true);
});
test('detector: only APPROVED holidays apply', () => {
  const holidays = [
    { active: true, status: 'approved', date: '2026-04-02', allDay: true, type: 'chag', nameHe: 'פסח' },
    { active: true, status: 'pending', date: '2026-04-03', allDay: true, type: 'chag', nameHe: 'פסח ב' },
  ];
  assert.equal(sabbathHolidayWindow({ weekday: 4, minuteOfDay: 600, dateISO: '2026-04-02' }, { holidays }).applies, true);
  assert.equal(sabbathHolidayWindow({ weekday: 5, minuteOfDay: 600, dateISO: '2026-04-03' }, { holidays }).applies, false);
});
test('detector: nothing matches → does not apply', () => {
  assert.equal(sabbathHolidayWindow({ weekday: 2, minuteOfDay: 600, dateISO: '2026-07-07' }, { weekly: WEEKLY }).applies, false);
});
test('detector hierarchy: Saturday (שבת) beats an ערב חג on the same day', () => {
  const weekly = [{ active: true, dayOfWeek: 6, allDay: true, nameHe: 'שבת' }];
  const holidays = [{ active: true, status: 'approved', date: '2026-07-04', allDay: true, type: 'erev_chag', nameHe: 'ערב חג' }];
  // 2026-07-04 is a Saturday (weekday 6)
  const r = sabbathHolidayWindow({ weekday: 6, minuteOfDay: 1000, dateISO: '2026-07-04' }, { weekly, holidays });
  assert.equal(r.type, 'shabbat');
  assert.equal(r.matched.length, 2); // both matched; שבת won
});
test('detector hierarchy: חג beats ערב חג on the same day', () => {
  const holidays = [
    { active: true, status: 'approved', date: '2026-09-12', allDay: true, type: 'erev_chag', nameHe: 'ערב' },
    { active: true, status: 'approved', date: '2026-09-12', allDay: true, type: 'chag', nameHe: 'חג' },
  ];
  const r = sabbathHolidayWindow({ weekday: 0, minuteOfDay: 600, dateISO: '2026-09-12' }, { holidays });
  assert.equal(r.type, 'chag');
});

// ── resolution guards ───────────────────────────────────────────────────────
test('no matching rule → no_price_rule', () => {
  assert.throws(
    () => run([], { participantCount: 1 }),
    (e) => e instanceof PricingError && e.code === 'no_price_rule',
  );
});
test('genuine tie (same specificity + priority) → ambiguous_price_rule', () => {
  const a = { id: 'a', active: true, priceModel: 'fixed', fixedPriceMinor: 1n, priority: 0 };
  const b = { id: 'b', active: true, priceModel: 'per_head', adultPriceMinor: 1n, priority: 0 };
  assert.throws(
    () => selectRule([a, b]),
    (e) => e instanceof PricingError && e.code === 'ambiguous_price_rule',
  );
});
test('higher priority breaks a specificity tie', () => {
  const lo = { id: 'lo', active: true, priceModel: 'fixed', fixedPriceMinor: 100n, priority: 0 };
  const hi = { id: 'hi', active: true, priceModel: 'fixed', fixedPriceMinor: 200n, priority: 5 };
  assert.equal(selectRule([lo, hi]).id, 'hi');
});
