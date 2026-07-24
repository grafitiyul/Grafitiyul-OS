// Shared IO wrapper around the auto add-on engine primitives (the ONE שבת/חג
// detector + buildAutoAddonLines). Used by BOTH the Builder route and the agent
// pricing resolver so there is never a second Saturday/holiday detector or a
// duplicated add-on assembly. Pure engine logic stays in autoAddons.js/engine.js;
// this only performs the canonical DB reads and hands the data to them.

import { tourMoment, buildAutoAddonLines } from './autoAddons.js';
import { sabbathHolidayWindow } from './engine.js';

// Returns { sabbath, lines, systemAddonId } — the auto-generated add-on builder
// lines for the winning card at this moment (empty when no date / nothing
// applies). `sabbath` carries the detector's verdict (type: shabbat/chag/…) so
// display layers can name the surcharge semantically.
export async function loadAndBuildAutoAddons(prisma, { winningRule, cardVat, cardGroupId, tourDate, tourTime, groupCount }) {
  const systemAddon = await prisma.addon.findFirst({ where: { systemKey: 'sabbath_holiday' } });
  const moment = tourMoment(tourDate, tourTime);
  let sabbath = { applies: false };
  const entriesNeedSabbath =
    !!systemAddon || (winningRule?.addons || []).some((e) => e.autoApply === 'sabbath_holiday');
  if (moment.dateISO && entriesNeedSabbath) {
    const [weekly, holidays] = await Promise.all([
      prisma.sabbathWeeklyRule.findMany({ where: { active: true } }),
      prisma.holidayRule.findMany({ where: { active: true, status: 'approved' } }),
    ]);
    sabbath = sabbathHolidayWindow(
      { weekday: moment.weekday, minuteOfDay: moment.minuteOfDay ?? 0, dateISO: moment.dateISO },
      { weekly, holidays },
    );
  }
  const entryAddonIds = [
    ...new Set([...(winningRule?.addons || []).map((e) => e.addonId), systemAddon?.id].filter(Boolean)),
  ];
  const catalogRows = entryAddonIds.length
    ? await prisma.addon.findMany({
        where: { id: { in: entryAddonIds } },
        select: { id: true, nameHe: true, vatMode: true, vatRate: true },
      })
    : [];
  const lines = buildAutoAddonLines({
    ruleAddons: winningRule?.addons || [],
    systemAddon,
    cardVat,
    cardGroupId,
    moment,
    isSabbathHoliday: sabbath.applies,
    addonCatalogById: new Map(catalogRows.map((a) => [a.id, a])),
    groupCount,
  });
  return { sabbath, lines, systemAddonId: systemAddon?.id || null };
}
