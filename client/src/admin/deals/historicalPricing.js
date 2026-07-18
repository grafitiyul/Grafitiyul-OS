import { formatMinor } from '../../lib/money.js';

// Pure helpers for the READ-ONLY historical commercial breakdown (frozen lines
// migrated from Pipedrive). No engine, no persistence — just display math over
// the stored minor-unit numbers. Kept framework-free so it is unit-testable.

// Client-side display total: sum of active lines (unitPriceMinor × quantity).
// The pricing engine is never consulted — historical lines are frozen numbers,
// so we render exactly what was imported. Inactive lines are excluded (they are
// excluded from the deal value the same way in the live builder).
export function historicalLineTotalMinor(lines) {
  return (lines || []).reduce((sum, l) => {
    if (!l || l.active === false) return sum;
    const parsed = Number.parseInt(l.quantity, 10);
    const qty = Number.isFinite(parsed) ? parsed : 1;
    const unit = Number(l.unitPriceMinor) || 0;
    return sum + unit * qty;
  }, 0);
}

// Banner reconciliation note. Returns null when there is nothing to say, else a
// short muted message. It never implies an error — class C simply shows that the
// historical line total differs from the stored deal value (both amounts), and
// class B notes that the original deal value was 0. Class A → no note.
export function reconciliationNote(reconciliation) {
  if (!reconciliation) return null;
  if (reconciliation.class === 'B') {
    return { text: 'ערך העסקה במקור היה 0.' };
  }
  if (reconciliation.class === 'C') {
    const lineSum = formatMinor(reconciliation.lineSumMinor);
    const dealValue = formatMinor(reconciliation.dealValueMinor);
    return {
      text: `סכום השורות ההיסטוריות (${lineSum}) שונה מערך העסקה שנשמר (${dealValue}).`,
    };
  }
  return null;
}
