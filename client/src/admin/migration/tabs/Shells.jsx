// Honest empty shells for the queues whose proposal builders are not built yet
// (Slice 4+). They state plainly what will live here — no fake data, no dead
// controls, no placeholder rows.
import QueueShell from '../components/QueueShell.jsx';

export function OrganizationsTab() {
  return (
    <QueueShell
      icon="🏢"
      title="ארגונים"
      blocking
      description="כאן יוצגו ארגונים שנראים כפולים, עם הראיות לכל התאמה, כדי להחליט מה לאחד ומה להשאיר נפרד. סניפים (יחידות) ייווצרו כחלק מאותו תהליך. בניית ההצעות תגיע בשלב הבא."
    />
  );
}

export function ContactsTab() {
  return (
    <QueueShell
      icon="👤"
      title="אנשי קשר"
      blocking
      description="כאן יוצגו אנשי קשר שנראים כפולים, כולל ראיות טלפון ואימייל, כדי להחליט מה לאחד. בניית ההצעות תגיע בשלב הבא."
    />
  );
}

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

export function LegacyArchiveTab() {
  return (
    <QueueShell
      icon="📦"
      title="ארכיון מערכת קודמת"
      blocking={false}
      description="כאן יהיה אפשר לעיין בנתונים כפי שהיו במערכת הקודמת. המידע כבר שמור בצילום — מסך העיון ייבנה בשלב הבא."
    />
  );
}
