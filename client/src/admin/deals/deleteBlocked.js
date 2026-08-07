// Why a deal could not be deleted, in the operator's words.
//
// The server answers with the LIVE dependencies that blocked it
// (server/src/deals/deleteGuard.js) rather than a single opaque code, so the
// operator learns what to do next instead of only that they may not. The
// labels come from the server verbatim — this file never re-writes the rule,
// it only formats the answer.

export function deleteBlockedMessage(err) {
  const blockers = err?.payload?.blockers;
  if (Array.isArray(blockers) && blockers.length) {
    return (
      'לא ניתן למחוק את הדיל:\n\n'
      + blockers.map((b) => `• ${b.labelHe}`).join('\n')
      + '\n\nיש לנתק או לבטל את התלויות האלה קודם.'
    );
  }
  return 'שגיאה במחיקה: ' + (err?.payload?.error || err?.message || 'לא ידוע');
}
