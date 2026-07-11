import { fmtTourDate } from '../../tours/config.js';

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
  const when = entry.createdAt ? new Date(entry.createdAt) : null;
  const actor = entry.createdByName || entry.actorLabel || 'מערכת';
  const text = EVENT_TEXT[d.event] || 'עדכון סיור';
  const reason = REASON_TEXT[d.reason];

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2" dir="rtl">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[15px] leading-none" aria-hidden>🧭</span>
        <span className="inline-flex shrink-0 items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10.5px] font-semibold text-indigo-700 ring-1 ring-indigo-200">
          סיור
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-gray-800">
          <span className="font-medium">{text}</span>
          {d.date && (
            <span className="text-gray-500">
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
          {Number.isInteger(d.seats) && d.seats > 0 && (
            <span className="text-gray-500"> · {d.seats} משתתפים</span>
          )}
          {reason && <span className="text-gray-500"> · {reason}</span>}
        </span>
        <span className="shrink-0 text-[11px] text-gray-400">
          {when
            ? when.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            : ''}
          {' · '}
          {actor}
        </span>
      </div>
    </div>
  );
}
