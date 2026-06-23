// ============================================================================
// Homepage content — mock/static, sourced from the Figma Homepage copy.
//
// All Hebrew strings are the REAL copy from the Figma desktop frame (#2091:195).
// Images are placeholders (the Figma uses photo/illustration assets that still
// need exporting); they go through the media seam so the real URLs slot in
// later. This whole module is the single content seam for the homepage — later
// it is replaced by GOS/WP data without touching the section components.
// ============================================================================
import { placeholder } from './media.js';
// Real photos harvested from the WordPress backup (uploads/2026).
import tourTour from '../assets/home/photos/tour-tour.jpg';
import tourWorkshop from '../assets/home/photos/tour-workshop.jpg';
import tourTa from '../assets/home/photos/tour-ta.jpg';
import tourWorkshop2 from '../assets/home/photos/tour-workshop2.jpg';
import eventBatmitzva from '../assets/home/photos/event-batmitzva.jpg';
import eventGroup from '../assets/home/photos/event-group.jpg';
import eventProject from '../assets/home/photos/event-project.jpg';
import gallery1 from '../assets/home/photos/gallery-1.jpg';
import gallery2 from '../assets/home/photos/gallery-2.jpg';
import gallery3 from '../assets/home/photos/gallery-3.jpg';
import gallery4 from '../assets/home/photos/gallery-4.jpg';
import gallery5 from '../assets/home/photos/gallery-5.jpg';
import gallery6 from '../assets/home/photos/gallery-6.jpg';
import privatePhoto from '../assets/home/photos/private.jpg';

export const hero = {
  // Exact Figma copy (#2196:3661). The headline highlights "הסיפורים" in white
  // over a teal Breaker-Bay blob (rendered via the <mark> in Hero.jsx).
  titleBefore: 'לגלות את',
  titleHighlight: 'הסיפורים',
  titleAfter: 'שמאחורי הקירות',
  subtitle:
    'אנחנו מציעים מגוון רחב של סדנאות וסיורי אמנות רחוב אינטראקטיביים עם אמני גרפיטי מקצועיים שיחשפו בפניכם את הסודות של עולם הגרפיטי',
  cta: { label: 'חפשו והזמינו סיור', href: '/tours' },
};

export const stats = [
  { value: '12', label: 'שנות פעילות' },
  { value: '2,000+', label: 'באים אלינו כל חודש' },
  { value: '400,000', label: 'איש כבר נהנו אצלנו' },
  { value: '15', label: 'מדריכים מקצועיים' },
  { value: '4.9', label: 'הדירוג שלנו בגוגל' },
  { value: '1,140+', label: 'חוות דעת מפרגנות' },
];

// Exact section copy from Figma (#2384:4026/4027/4028). NOTE: per-card copy
// below is representative — the exact card text + the 4 card PHOTOS are pending
// Figma API export (rate-limited); tracked in the polish backlog.
export const openTours = {
  title: 'תצטרפו לסיורים הפתוחים שלנו',
  subtitle:
    'מגוון סיורים וסדנאות אליהם תוכלו להצטרף. בחרו סיור, חפשו מועד, בחרו כרטיסים והזמינו!',
  cta: { label: 'לצפייה בכל הסיורים והסדנאות', href: '/tours' },
  cards: [
    {
      id: 't1',
      category: 'סיור + סדנה',
      title: 'סיור וסדנה גרפיטי בתל אביב',
      desc: 'סיור מודרך בשכונות הגרפיטי של תל אביב, ולאחריו סדנת ריסוס מעשית. כולל חומרים.',
      priceFrom: 150,
      image: tourTour,
    },
    {
      id: 't2',
      category: 'סיור',
      title: 'סיור גרפיטי בנמל תל אביב',
      desc: 'סיור מודרך בין יצירות אמנות הרחוב המובילות של העיר עם מדריך־אמן.',
      priceFrom: 90,
      image: tourWorkshop,
    },
    {
      id: 't3',
      category: 'סיור + סדנה',
      title: 'סיור גרפיטי בעיר התחתית, חיפה',
      desc: 'חוויה אורבנית בעיר התחתית בחיפה, בשילוב סדנת סטנסיל קצרה.',
      priceFrom: 120,
      image: tourTa,
    },
    {
      id: 't4',
      category: 'סדנה',
      title: 'סדנת ריסוס למתחילים',
      desc: 'סדנה מעשית ללימוד טכניקות ריסוס וסטנסיל, מתאימה לכל הרמות.',
      priceFrom: 110,
      image: tourWorkshop2,
    },
  ],
};

export const events = {
  title: 'מארגנים אירוע? יש לנו את הפתרונות בשבילכם!',
  subtitle:
    'מסיורים אינטימיים לזוגות ועד אירועי גיבוש לחברות - יש לנו פתרון לכל קבוצה',
  cards: [
    {
      id: 'e1',
      title: 'גיבוש לחברות',
      desc: 'חוויית צוות צבעונית ובלתי נשכחת, מותאמת לגודל הקבוצה ולמטרות.',
      image: eventGroup,
    },
    {
      id: 'e2',
      title: 'אירועים פרטיים',
      desc: 'ימי הולדת, מסיבות רווקים/ות ואירועים מיוחדים עם צבע ואנרגיה.',
      image: eventBatmitzva,
    },
    {
      id: 'e3',
      title: 'סיורים לזוגות',
      desc: 'חוויה אינטימית בשניים בלב הסצנה האורבנית.',
      image: eventProject,
    },
  ],
};

export const whyUs = {
  title: 'פעילות עם גרפיטיול זו הצלחה בטוחה!',
  subtitle: 'הערכים שלנו הופכים אותנו לבחירה המנצחת שלכם',
  // 8 value items (Figma "Content Cards V13" — icon + paragraph). Copy read
  // from the cached render; exact wording + the line-icons are pending API.
  values: [
    { id: 'v1', text: 'הסיורים שלנו קלילים וכיפיים ולא כוללים הרצאות משעממות' },
    { id: 'v2', text: 'אנחנו קיימים מעל 12 שנים, ועברו אצלנו מעל 400,000 איש בסדנאות וסיורים' },
    { id: 'v3', text: 'הדירוג שלנו בגוגל הוא 4.9 כוכבים מתוך 5, עם מעל 1,200 מדרגים' },
    { id: 'v4', text: 'אנחנו בטופ 15 העסקים המומלצים של Tripadvisor בעולם, מקום 1 בתל אביב' },
    { id: 'v5', text: 'יש לנו פתרונות חווייתיים גם לימים של גשם או חמסין' },
    { id: 'v6', text: 'תנאי הביטול שלנו הכי גמישים והוגנים שיש בשוק' },
    { id: 'v7', text: 'המדריכים שלנו הם גם אמני הגרפיטי המובילים במדינה' },
    { id: 'v8', text: 'מתאימים לקבוצות מגוונות — ילדים, מתבגרים ומבוגרים, אף אחד לא יישאר מאחור' },
  ],
  companiesTitle: 'חברות מדהימות שכבר נהנו איתנו בסיורים וסדנאות',
  companies: Array.from({ length: 12 }, (_, i) => ({
    id: `c${i + 1}`,
    name: `חברה ${i + 1}`,
    logo: placeholder('LOGO', { w: 160, h: 60 }),
  })),
  cta: { label: 'צרו קשר היום!', href: '/contact' },
};

export const privateCta = {
  word: 'PRIVATE',
  title: 'רוצים סיור פרטי?',
  desc: 'צרו קשר ונבנה יחד חוויה שמתאימה בדיוק לקבוצה שלכם — מהמיקום ועד התוכן.',
  // Checklist (Figma teal-check list). Exact wording pending API verification.
  checklist: [
    'גיבוש לחברות וצוותים',
    'אירועי ימי הולדת והפקות',
    'הפעלות לבר/בת מצווה',
    'חוויה פרטית מותאמת אישית',
  ],
  cta: { label: 'השאירו פרטים ונחזור אליכם', href: '/contact' },
  image: privatePhoto,
};

export const testimonials = {
  title: 'אם הלקוחות שלנו שמחים, עשינו את שלנו:',
  items: [
    { id: 'r1', name: 'דנה כהן', rating: 5, text: 'חוויה מטורפת! המדריך היה אלוף והילדים לא הפסיקו לדבר על זה.' },
    { id: 'r2', name: 'יוסי לוי', rating: 5, text: 'גיבוש מושלם לחברה. ארגון חלק ואווירה מעולה.' },
    { id: 'r3', name: 'מאיה ברק', rating: 5, text: 'יצאנו עם יצירה משלנו ועם המון השראה. ממליצה בחום!' },
    { id: 'r4', name: 'אבי מזרחי', rating: 5, text: 'הכי כיף שיש. צבע, מוזיקה ואנשים מהממים.' },
  ],
};

export const instagram = {
  title: 'מתוך האינסטגרם שלנו',
  subtitle: 'הכי טרי, הכי צבעוני, הכי אמיתי!',
  handle: '@grafitiyul',
  images: [
    { id: 'ig1', image: gallery1 },
    { id: 'ig2', image: gallery2 },
    { id: 'ig3', image: gallery3 },
    { id: 'ig4', image: gallery4 },
    { id: 'ig5', image: gallery6 },
    { id: 'ig6', image: gallery5 },
  ],
};

export const press = {
  title: 'מדברים עלינו בתקשורת',
  subtitle: 'קראו עלינו בכתבות באתרים המובילים',
  cta: { label: 'לכל הכתבות', href: '/blog' },
  logos: Array.from({ length: 6 }, (_, i) => ({
    id: `p${i + 1}`,
    name: `מגזין ${i + 1}`,
    logo: placeholder('PRESS', { w: 150, h: 50 }),
  })),
};

export const contactCta = {
  text:
    'בין אם אתם צריכים עזרה, יש לכם שאלות, רוצים להזמין סיור מיוחד או סתם רוצים לפטפט - אנחנו כאן בשבילכם',
  cta: { label: 'שלחו הודעה', href: '/contact' },
};

export const faq = {
  title: 'שאלות נפוצות במיוחד',
  subtitle:
    'השאלות האלה הן הנפוצות במיוחד, אך תוכלו לגשת לדף הייעודי שבו יש עוד מלא תשובות לכל שאלה שיכולה להיות לכם',
  cta: { label: 'לדף שאלות ותשובות', href: '/faq' },
  items: [
    { id: 'f1', q: 'איך מזמינים סיור?', a: 'בוחרים סיור, בוחרים מועד וכמות כרטיסים, ומשלמים אונליין — זה הכל.' },
    { id: 'f2', q: 'האם הסיורים מתאימים לילדים?', a: 'בהחלט! יש לנו סיורים וסדנאות שמתאימים לכל הגילאים.' },
    { id: 'f3', q: 'מה קורה אם יורד גשם?', a: 'חלק מהפעילויות מתקיימות בחללים מקורים; במקרה הצורך ניצור איתכם קשר לתיאום מועד חלופי.' },
    { id: 'f4', q: 'אפשר להזמין סיור פרטי?', a: 'כן, אנחנו בונים סיורים פרטיים בהתאמה אישית לקבוצות, זוגות וחברות.' },
  ],
};
