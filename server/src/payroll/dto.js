// Guide-portal read models for payroll — the DTO whitelist pattern
// (tours/guidePortal/dto.js convention). A guide sees ONLY their own entries,
// only after office approval, and only components that actually affect them:
// zero rows and guide-hidden components never leave the server. No office
// internals (calc snapshots, other guides, catalog config) are exposed.

import { entryTotals, lineFinalMinor } from './engine.js';

export function guidePayEntryDto(entry, activity, componentById) {
  const visibleLines = (entry.lines || [])
    .filter((l) => {
      const component = componentById.get(l.componentId);
      if (component && component.guideVisible === false) return false;
      return lineFinalMinor(l) !== 0;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
  // Totals ALWAYS run over the full line set — hiding a zero/office-only row
  // must never change the money.
  const totals = entryTotals(entry.lines || [], {
    vatStatus: entry.vatStatusSnapshot,
    vatRate: entry.vatRateSnapshot,
  });
  return {
    id: entry.id,
    activityTitle: activity.titleHe,
    sourceType: activity.sourceType,
    date: activity.date,
    payrollMonth: activity.payrollMonth,
    role: entry.role,
    guideStatus: entry.guideStatus, // pending | approved | inquiry (בבירור)
    guideApprovedAt: entry.guideApprovedAt,
    vatStatus: entry.vatStatusSnapshot, // exempt → the UI shows a flat total only
    vatRate: entry.vatRateSnapshot,
    lines: visibleLines.map((l) => ({
      name: l.componentNameHe,
      sign: l.sign,
      amountMinor: lineFinalMinor(l),
    })),
    totals,
  };
}
