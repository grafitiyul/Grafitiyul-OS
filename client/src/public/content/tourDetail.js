// ============================================================================
// Tour detail content — mock/static (no DB / WooCommerce / booking).
//
// Structure mirrors the real WP template (woocommerce/content-single-product):
// hero (image + title), description + "בחרו מועד" date list (date · weekday |
// time, holiday tag), gallery, reviews. Real description/dates/reviews live in
// the backup DB and slot in here later. Photos reuse harvested graffiti images.
// ============================================================================
import tourTa from '../assets/home/photos/tour-ta.jpg';
import g1 from '../assets/home/photos/gallery-1.jpg';
import g2 from '../assets/home/photos/gallery-2.jpg';
import g3 from '../assets/home/photos/gallery-3.jpg';
import g4 from '../assets/home/photos/gallery-4.jpg';
import g5 from '../assets/home/photos/gallery-5.jpg';
import g6 from '../assets/home/photos/gallery-6.jpg';

export const tourDetail = {
  slug: 'tlv-graffiti-tour',
  title: 'סיור גרפיטי בנמל תל אביב',
  heroImage: tourTa,
  meta: { city: 'תל אביב', activityType: 'סיור', duration: '90–120 דק׳' },

  description: [
    'צאו איתנו לסיור מודרך בין יצירות אמנות הרחוב המרהיבות של תל אביב, בליווי מדריך־אמן שמכיר כל פינה וכל סיפור שמאחורי הקירות.',
    'במהלך הסיור תכירו את הסצנה האורבנית של העיר, את האמנים הבולטים ואת הטכניקות שמאחורי היצירות — מסטנסיל ועד ציורי קיר ענקיים.',
    'הסיור מתאים למשפחות, קבוצות וחברות, ואינו כולל הרצאות משעממות — רק חוויה צבעונית, כיפית ואותנטית.',
  ],

  // date · weekday | time (+ optional holiday) — as in the Hebcal-enriched terms.
  dates: [
    { id: 'd1', date: '29/06', weekday: 'יום ראשון', time: '17:00', holiday: null },
    { id: 'd2', date: '03/07', weekday: 'יום חמישי', time: '10:30', holiday: null },
    { id: 'd3', date: '06/07', weekday: 'יום ראשון', time: '17:00', holiday: null },
    { id: 'd4', date: '10/07', weekday: 'יום חמישי', time: '18:30', holiday: null },
  ],

  galleryTitle: 'תמונות מהסיור',
  gallery: [g1, g2, g3, g4, g5, g6],

  reviewsTitle: 'מה אומרים עלינו',
  reviews: [
    { id: 'r1', name: 'דנה כהן', date: '14.6.2026', stars: 5, text: 'חוויה מטורפת! המדריך היה אלוף והילדים לא הפסיקו לדבר על זה ימים אחרי.' },
    { id: 'r2', name: 'יוסי לוי', date: '2.6.2026', stars: 5, text: 'סיור מרתק ומקצועי. גילינו עולם שלם של אמנות רחוב בעיר שאנחנו חיים בה.' },
    { id: 'r3', name: 'מאיה ברק', date: '28.5.2026', stars: 5, text: 'יצאנו עם המון השראה ותמונות מהממות. ממליצה בחום לכל מי שאוהב אמנות.' },
  ],
};
