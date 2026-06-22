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

export const hero = {
  eyebrow: 'גרפיטיול',
  // The Figma hero title is a graffiti-lettering image; this is a text stand-in.
  title: 'יוצאים לצבוע\nאת הרחוב',
  subtitle:
    'סיורי וסדנאות גרפיטי בלב הסצנה האורבנית. בחרו סיור, חפשו מועד, הזמינו כרטיסים — ובואו ליצור.',
  primaryCta: { label: 'חפשו סיור', href: '/tours' },
  secondaryCta: { label: 'צרו קשר', href: '/contact' },
  image: placeholder('Hero · גרפיטי', { w: 760, h: 680 }),
};

export const stats = [
  { value: '12', label: 'שנות פעילות' },
  { value: '2,000+', label: 'באים אלינו כל חודש' },
  { value: '400,000', label: 'איש כבר נהנו אצלנו' },
  { value: '15', label: 'מדריכים מקצועיים' },
  { value: '4.9', label: 'הדירוג שלנו בגוגל' },
  { value: '1,140+', label: 'חוות דעת מפרגנות' },
];

export const openTours = {
  title: 'תצטרפו לסיורים הפתוחים שלנו',
  subtitle:
    'מגוון סיורים וסדנאות אליהם תוכלו להצטרף. בחרו סיור, חפשו מועד, בחרו כרטיסים והזמינו!',
  cta: { label: 'לצפייה בכל הסיורים והסדנאות', href: '/tours' },
  cards: [
    {
      id: 't1',
      title: 'סיור גרפיטי בתל אביב',
      city: 'תל אביב',
      duration: '120 דק׳',
      priceFrom: 90,
      tag: 'מומלץ',
      image: placeholder('סיור · תל אביב', { w: 560, h: 360 }),
    },
    {
      id: 't2',
      title: 'סיור + סדנה בירושלים',
      city: 'ירושלים',
      duration: '180 דק׳',
      priceFrom: 150,
      tag: 'סדנה',
      image: placeholder('סיור + סדנה · ירושלים', { w: 560, h: 360 }),
    },
    {
      id: 't3',
      title: 'סדנת סטנסיל בחיפה',
      city: 'חיפה',
      duration: '90 דק׳',
      priceFrom: 120,
      tag: 'חדש',
      image: placeholder('סדנה · חיפה', { w: 560, h: 360 }),
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
      image: placeholder('גיבוש חברות', { w: 520, h: 320 }),
    },
    {
      id: 'e2',
      title: 'אירועים פרטיים',
      desc: 'ימי הולדת, מסיבות רווקים/ות ואירועים מיוחדים עם צבע ואנרגיה.',
      image: placeholder('אירוע פרטי', { w: 520, h: 320 }),
    },
    {
      id: 'e3',
      title: 'סיורים לזוגות',
      desc: 'חוויה אינטימית בשניים בלב הסצנה האורבנית.',
      image: placeholder('סיור לזוגות', { w: 520, h: 320 }),
    },
  ],
};

export const whyUs = {
  title: 'פעילות עם גרפיטיול זו הצלחה בטוחה!',
  subtitle: 'הערכים שלנו הופכים אותנו לבחירה המנצחת שלכם',
  values: [
    { id: 'v1', title: 'מדריכים מקצועיים', desc: 'אמנים פעילים שמכירים כל פינה בסצנה.' },
    { id: 'v2', title: 'חוויה לכל אחד', desc: 'מתאים למשפחות, קבוצות וחברות כאחד.' },
    { id: 'v3', title: 'יצירה אמיתית', desc: 'יוצאים עם יצירה משלכם ביד.' },
    { id: 'v4', title: 'גמישות מלאה', desc: 'מועדים, מיקומים ותכנים מותאמים אישית.' },
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
  title: 'סיור פרטי, בדיוק כמו שחלמתם',
  desc: 'בונים יחד חוויה שמתאימה בדיוק לקבוצה שלכם — מהמיקום ועד התוכן.',
  cta: { label: 'דברו איתנו', href: '/contact' },
  image: placeholder('סיור פרטי', { w: 480, h: 480 }),
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
  images: Array.from({ length: 6 }, (_, i) => ({
    id: `ig${i + 1}`,
    image: placeholder(`IG ${i + 1}`, { w: 360, h: 360 }),
  })),
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
