// Guide-portal read models for payroll — the DTO whitelist pattern
// (tours/guidePortal/dto.js convention). A guide sees ONLY their own entries,
// only after office approval, and only components that actually affect them:
// zero rows and guide-hidden components never leave the server. No office
// internals (calc snapshots, other guides, catalog config) are exposed.

import { entryTotals, lineFinalMinor } from './engine.js';

// The message events that form one entry's guide↔office conversation
// (immutable TimelineEntry rows on the activity, filtered by data.entryId).
export const CONVERSATION_EVENTS = ['guide_inquiry', 'guide_message', 'office_reply'];

// Map an activity's timeline rows to ONE entry's conversation, guide-safe:
// only this entry's messages, only text/sender/time — no admin metadata.
export function guideConversationDto(timelineRows, entryId) {
  return (timelineRows || [])
    .filter(
      (t) =>
        t.kind === 'payroll' &&
        t.data &&
        CONVERSATION_EVENTS.includes(t.data.event) &&
        t.data.entryId === entryId &&
        t.data.text,
    )
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((t) => ({
      id: t.id,
      text: t.data.text,
      byGuide: t.data.event !== 'office_reply',
      at: t.createdAt,
    }));
}

export function guidePayEntryDto(entry, activity, componentById, conversation = []) {
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
    // The guide's own conversation for THIS entry — never anyone else's.
    conversation,
    // The OFFICIAL office note ("הערת המשרד") — shown with the entry, never
    // rendered as a chat bubble.
    officeNote: entry.officeNote || null,
  };
}
