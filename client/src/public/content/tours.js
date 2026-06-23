// ============================================================================
// Tours catalog content — mock/static (no DB/WooCommerce/booking yet).
//
// Card anatomy + filters mirror the real WordPress catalog template
// (loop-templates/tours-listing.php): city + activity-type + duration filters,
// "closest dates" per card, price-from CTA. Real tour data (titles, cities,
// prices, dates) is harvestable from the backup DB later — this is the seam.
//
// Photos reuse the real graffiti images already harvested from the backup.
// ============================================================================
import tourTour from '../assets/home/photos/tour-tour.jpg';
import tourWorkshop from '../assets/home/photos/tour-workshop.jpg';
import tourTa from '../assets/home/photos/tour-ta.jpg';
import tourWorkshop2 from '../assets/home/photos/tour-workshop2.jpg';
import eventGroup from '../assets/home/photos/event-group.jpg';
import eventProject from '../assets/home/photos/event-project.jpg';

export const toursPage = {
  title: 'הסיורים והסדנאות שלנו',
  subtitle: 'בחרו סיור או סדנה, סננו לפי עיר, סוג פעילות ומשך — ומצאו את החוויה שלכם.',
};

// Filter option lists (mirror the city / pa_פעילות / pa_משך taxonomies).
export const cities = ['תל אביב', 'ירושלים', 'חיפה', 'באר שבע'];
export const activityTypes = ['סיור', 'סדנה', 'סיור + סדנה'];
// Duration buckets keyed by an id; `match(minutes)` decides membership.
export const durations = [
  { id: 'lt90', label: 'עד שעה וחצי', match: (m) => m <= 90 },
  { id: '90to150', label: 'שעה וחצי – שעתיים וחצי', match: (m) => m > 90 && m <= 150 },
  { id: 'gt150', label: 'מעל שעתיים וחצי', match: (m) => m > 150 },
];
// Simple date filter (Decision B) — "upcoming" buckets, not a range calendar.
export const dateRanges = [
  { id: 'all', label: 'כל המועדים' },
  { id: 'this-month', label: 'החודש' },
  { id: 'next-month', label: 'החודש הבא' },
];

// Mock catalog. durationMin/Max in minutes. closestDates: upcoming departures.
export const tours = [
  {
    id: 't1',
    slug: 'tlv-graffiti-tour',
    title: 'סיור גרפיטי בנמל תל אביב',
    cities: ['תל אביב'],
    activityType: 'סיור',
    durationMin: 90,
    durationMax: 120,
    excerpt: 'סיור מודרך בין יצירות אמנות הרחוב המובילות של העיר, עם מדריך־אמן מקומי.',
    priceFrom: 90,
    image: tourTour,
    closestDates: [
      { date: '29/06', time: '17:00' },
      { date: '03/07', time: '10:30' },
    ],
  },
  {
    id: 't2',
    slug: 'tlv-graffiti-workshop',
    title: 'סיור וסדנת גרפיטי בתל אביב',
    cities: ['תל אביב'],
    activityType: 'סיור + סדנה',
    durationMin: 150,
    durationMax: 180,
    excerpt: 'סיור בשכונות הגרפיטי ולאחריו סדנת ריסוס מעשית. כולל חומרים ויצירה אישית.',
    priceFrom: 150,
    image: tourWorkshop,
    closestDates: [
      { date: '28/06', time: '16:30' },
      { date: '05/07', time: '16:30' },
    ],
  },
  {
    id: 't3',
    slug: 'jerusalem-graffiti-tour',
    title: 'סיור גרפיטי בירושלים',
    cities: ['ירושלים'],
    activityType: 'סיור',
    durationMin: 120,
    durationMax: 120,
    excerpt: 'במרכז הסצנה הירושלמית — סיפורי הקירות והאמנים שמאחוריהם.',
    priceFrom: 110,
    image: tourTa,
    closestDates: [{ date: '30/06', time: '18:00' }],
  },
  {
    id: 't4',
    slug: 'haifa-stencil-workshop',
    title: 'סדנת סטנסיל בחיפה',
    cities: ['חיפה'],
    activityType: 'סדנה',
    durationMin: 90,
    durationMax: 90,
    excerpt: 'סדנה מעשית ללימוד טכניקת הסטנסיל, מתאימה לכל הרמות.',
    priceFrom: 120,
    image: tourWorkshop2,
    closestDates: [{ date: '04/07', time: '11:00' }],
  },
  {
    id: 't5',
    slug: 'company-team-graffiti',
    title: 'סדנת גיבוש גרפיטי לקבוצות',
    cities: ['תל אביב', 'חיפה'],
    activityType: 'סדנה',
    durationMin: 120,
    durationMax: 180,
    excerpt: 'חוויית צוות צבעונית ומותאמת לקבוצות וחברות, בהובלת אמני גרפיטי.',
    priceFrom: 140,
    image: eventGroup,
    closestDates: [],
  },
  {
    id: 't6',
    slug: 'street-art-project',
    title: 'פרויקט אמנות רחוב מודרך',
    cities: ['באר שבע'],
    activityType: 'סיור + סדנה',
    durationMin: 180,
    durationMax: 240,
    excerpt: 'יום יצירה אורבני: סיור השראה ולאחריו יצירת קיר משותף.',
    priceFrom: 180,
    image: eventProject,
    closestDates: [{ date: '11/07', time: '09:30' }],
  },
];
