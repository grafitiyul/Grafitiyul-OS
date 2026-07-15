// Honest empty shells for the queues whose proposal builders are not built yet
// (Slice 4+). They state plainly what will live here — no fake data, no dead
// controls, no placeholder rows.
import QueueShell from '../components/QueueShell.jsx';

// NOTE: "אנשי קשר" (tab 2) is now the real duplicate-review queue —
// see tabs/ContactsTab.jsx. It is not a shell any more.

export function NameCleanupTab() {
  return (
    <QueueShell
      icon="✍️"
      title="ניקוי שמות"
      blocking
      description="כאן יוצגו שמות חסרים או לא תקינים לאישור ידני. שום שם לא ישונה בשקט — כל שינוי יוצג לאישור. בניית ההצעות תגיע בשלב הבא."
    />
  );
}

export function ExceptionalTab() {
  return (
    <QueueShell
      icon="⚠️"
      title="רשומות חריגות"
      blocking={false}
      description="כאן יוצגו רשומות בודדות שלא מתאימות לאף כלל ודורשות החלטה פרטנית. בניית ההצעות תגיע בשלב הבא."
    />
  );
}

// NOTE: "ארכיון מערכת קודמת" (tab 6) is now the read-only Snapshot Browser —
// see tabs/SnapshotBrowserTab.jsx. It is not a shell any more.
