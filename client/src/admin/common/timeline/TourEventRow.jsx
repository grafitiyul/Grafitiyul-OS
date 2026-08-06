import { fmtTourDate } from '../../tours/config.js';
import EventRowShell from './EventRowShell.jsx';

// Compact history row for a Tours lifecycle event (TimelineEntry kind='tour').
// Emitted by the server tours module (src/tours/tourFromDeal.js) on the DEAL
// timeline: tour created/joined/left, booking orphaned. entry.data carries
// { event, date, startTime, seats?, reason? }.

const EVENT_TEXT = {
  tour_created: 'נוצר סיור מהדיל',
  tour_joined: 'הדיל שובץ לסיור קבוצתי',
  tour_left: 'הדיל הוסר מהסיור',
  booking_orphaned: 'הסיור נשמר בנפרד מהדיל (orphan)',
  tour_update_applied: 'עדכון הסיור הוחל — הסיור עודכן לפי הדיל',
  tour_state_saved_to_plan: 'הסיור בוטל בפתיחה מחדש — הצוות והמרכיבים נשמרו בתכנון',
  // Tour Gallery lifecycle (batch-level — never one event per photo).
  gallery_first_upload: 'הועלתה מדיה ראשונה לגלריית הסיור',
  gallery_batch_uploaded: 'הועלתה מדיה לגלריית הסיור',
  gallery_media_deleted: 'נמחקה מדיה מגלריית הסיור',
  gallery_cover_changed: 'עודכן קאבר הגלריה',
  gallery_link_created: 'נוצר קישור גלריה ללקוח',
  gallery_link_rotated: 'הוחלף קישור הגלריה ללקוח',
  gallery_link_revoked: 'בוטל קישור הגלריה ללקוח',
  gallery_cleanup_scheduled: 'ניקוי גלריית הסיור תוזמן',
  gallery_cleanup_completed: 'גלריית הסיור נמחקה מהאחסון',
  gallery_cleanup_skipped: 'ניקוי הגלריה בוטל (הסיור חזר לפעיל)',
  gallery_export_requested: 'התבקשה הורדת כל הגלריה',
  gallery_export_completed: 'קובץ הורדת הגלריה מוכן',
};

const REASON_TEXT = {
  deal_reopened: 'הדיל נפתח מחדש',
  deal_lost: 'הדיל סומן LOST',
  tour_replaced: 'הוחלף סיור',
};

export default function TourEventRow({ entry }) {
  const d = entry.data || {};
  const text = EVENT_TEXT[d.event] || 'עדכון סיור';
  const reason = REASON_TEXT[d.reason];

  return (
    <EventRowShell
      icon={<span className="text-[15px]" aria-hidden>🧭</span>}
      chip={{ label: 'סיור', tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200' }}
      when={entry.createdAt}
      actor={entry.createdByName || entry.actorLabel || 'מערכת'}
    >
      {text}
      {d.date && (
        <span className="gos-detail">
          {' · '}
          {fmtTourDate(d.date)}
          {d.startTime && (
            <>
              {' '}
              <span dir="ltr" className="tabular-nums">{d.startTime}</span>
            </>
          )}
        </span>
      )}
      {Number.isInteger(d.seats) && d.seats > 0 && <span className="gos-detail"> · {d.seats} משתתפים</span>}
      {reason && <span className="gos-detail"> · {reason}</span>}
    </EventRowShell>
  );
}
