import SettingsChrome from './SettingsChrome.jsx';
import { CategoryGrid, CategoryCard } from './cards.jsx';

// Tours Settings category page — the landing for the Tours module's
// configuration, same pattern as CRM Settings (CategoryGrid → focused
// sub-pages). The module keeps growing (guide payments, equipment,
// transportation, notifications…) — each future capability becomes another
// category card here instead of stretching one endless page.
export default function ToursSettings() {
  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-4xl mx-auto">
      <header className="mb-8">
        <SettingsChrome />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">
          הגדרות סיורים
        </h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          תזמון, מרכיבי פעילות, שאלונים והרשאות — התצורה של מודול הסיורים.
        </p>
      </header>

      <CategoryGrid>
        <CategoryCard
          to="/admin/settings/tours/group-tours"
          icon="🗓️"
          title="סיורים קבוצתיים"
          description="יצירה אוטומטית של סלוטים — קיבולת ברירת מחדל, אופק תכנון וכללי תזמון שבועיים."
        />
        <CategoryCard
          to="/admin/settings/tours/components"
          icon="🧩"
          title="מרכיבי הפעילות ומיקומי הסדנה"
          description="אבני הבניין של כל סיור והמיקומים שבהם מתקיימות הסדנאות."
        />
        <CategoryCard
          to="/admin/settings/tours/coordination"
          icon="📞"
          title="שיחת תיאום"
          description="הטופס שהלקוח ממלא לפני הסיור — תבנית, בילדר וסטטוס פרסום."
        />
        <CategoryCard
          to="/admin/settings/tours/summary"
          icon="📋"
          title="סיכום סיור"
          description="השאלון שצוות הסיור ממלא בסיום כל סיור — תבנית, בילדר וסטטוס פרסום."
        />
        <CategoryCard
          to="/admin/settings/tours/guide-permissions"
          icon="🛡️"
          title="הרשאות מדריכים"
          description="מה מדריך משובץ רואה ועושה בסיורים שלו בפורטל המדריכים."
        />
        <CategoryCard
          to="/admin/settings/tours/gallery"
          icon="📸"
          title="גלריית סיורים"
          description="הרשאות מחיקה ושיתוף למדריכים, העלאות לקוח ותוקף קובצי הורדה."
        />
      </CategoryGrid>
    </div>
  );
}
