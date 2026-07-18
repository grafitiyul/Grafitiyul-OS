// Automatic add-on line generation for the Price Builder — pure, no Prisma/IO.
// Composes the SAME engine primitives the per-card preview already uses
// (resolveSystemAddonEntry, addonApplies, priceAddon, sabbathHolidayWindow) —
// no duplicated detection or math. The route loads the data (winning rule's
// addon rows, the system שבת/חג addon, the active שבת rules, the addon catalog)
// and this module decides which add-on lines a regeneration emits.

import { addonApplies, priceAddon, resolveSystemAddonEntry } from './engine.js';

// Marks a builder line as an auto-generated card add-on. Regeneration
// (applyCardNotes) rebuilds these from canonical card data; the client and the
// route both identify them by this kind — never by label.
export const AUTO_ADDON_SOURCE_KIND = 'price_rule_addon';

// Normalize a tour moment for add-on auto-apply: weekday (0=Sun..6=Sat) from
// the date, minute-of-day from "HH:MM". Same parsing the preview route uses.
export function tourMoment(dateISO, time) {
  const iso = dateISO ? String(dateISO).slice(0, 10) : null;
  let weekday = null;
  if (iso) {
    const dt = new Date(`${iso}T00:00:00Z`);
    if (!Number.isNaN(dt.getTime())) weekday = dt.getUTCDay();
  }
  let minuteOfDay = null;
  if (time) {
    const [hh, mm] = String(time).split(':').map(Number);
    if (Number.isFinite(hh) && Number.isFinite(mm)) minuteOfDay = hh * 60 + mm;
  }
  return { dateISO: iso, weekday, minuteOfDay };
}

// Build the auto add-on builder lines for ONE winning card.
//   ruleAddons      — the winning PriceRule's addon rows (per-card config).
//   systemAddon     — the שבת/חג catalog addon (or null).
//   cardVat         — { vatMode, vatRate } of the winning card.
//   cardGroupId     — provenance stamp for the generated lines.
//   moment          — tourMoment() result (no date → nothing time-based applies).
//   isSabbathHoliday— the ONE detector's verdict (computed by the caller via
//                     sabbathHolidayWindow; false when no date).
//   addonCatalogById— Map addonId → { nameHe, vatMode, vatRate } for labels +
//                     catalog VAT resolution.
// Only auto-applying entries emit lines ('manual' add-ons stay operator-added).
export function buildAutoAddonLines({
  ruleAddons,
  systemAddon,
  cardVat,
  cardGroupId,
  moment,
  isSabbathHoliday,
  addonCatalogById,
}) {
  const entries = (ruleAddons || []).filter(
    (e) => !systemAddon || e.addonId !== systemAddon.id,
  );
  if (systemAddon) {
    const override = (ruleAddons || []).find((e) => e.addonId === systemAddon.id) || null;
    const resolved = resolveSystemAddonEntry(systemAddon, override);
    if (resolved) entries.push(resolved);
  }

  const ctx = {
    weekday: moment?.weekday ?? null,
    minuteOfDay: moment?.minuteOfDay ?? null,
    manualAddonIds: [], // manual add-ons are operator-added lines, never auto
    isSabbathHoliday: isSabbathHoliday === true,
  };

  return entries
    .filter((e) => e.autoApply && e.autoApply !== 'manual' && addonApplies(e, ctx))
    .map((e) => {
      const catalog = addonCatalogById?.get(e.addonId) || null;
      const priced = priceAddon(e, cardVat, catalog);
      return {
        id: `auto-addon:${e.addonId}`,
        kind: 'addon',
        label: catalog?.nameHe || 'תוספת',
        refId: e.addonId,
        quantity: 1,
        unitPriceMinor: priced.priceMinor,
        vatMode: priced.vatMode,
        vatRate: priced.vatRate,
        active: true,
        note: '',
        overridden: false,
        sourceKind: AUTO_ADDON_SOURCE_KIND,
        sourceCardGroupId: cardGroupId || null,
      };
    });
}
