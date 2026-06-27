import BackButton from '../common/BackButton.jsx';
import { CategoryGrid, CategoryCard } from './cards.jsx';

// CRM Settings category page — lists the CRM configuration sub-screens. Only
// the catalogs screen (Organization Types / Subtypes / Deal Stages) is active
// today; the rest are placeholders.
export default function CrmSettingsHome() {
  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-4xl mx-auto">
      <header className="mb-8">
        <BackButton to="/admin/settings" label="חזרה להגדרות" />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">
          הגדרות CRM
        </h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          קטלוגים והגדרות שמזינים את תהליך העבודה.
        </p>
      </header>

      <CategoryGrid>
        <CategoryCard
          to="/admin/settings/crm/organization-types"
          icon="🏷️"
          title="סוגי ארגון ותת-סוגים"
          description="קטלוג סוגי הארגון ותת-הסוגים של הדילים."
        />
        <CategoryCard
          to="/admin/settings/crm/deal-stages"
          icon="📊"
          title="שלבי דיל"
          description="צינור המכירות — השלבים והסדר שלהם."
        />
        <CategoryCard
          to="/admin/settings/crm/lost-reasons"
          icon="🚫"
          title="סיבות LOST"
          description="רשימת סיבות LOST של דיל, לשימוש חוזר."
        />
        <CategoryCard
          to="/admin/settings/crm/quote-sections"
          icon="📝"
          title="הצעות מחיר"
          description="סעיפי תוכן קבועים לשימוש בהצעות מחיר עתידיות."
        />
        <CategoryCard
          to="/admin/settings/crm/products-area"
          icon="📦"
          title="מוצרים"
          description="מוצרים, מיקומים ותוספות — כל מה שמגדיר את מה שאנחנו מוכרים."
        />
        <CategoryCard
          to="/admin/settings/crm/payment"
          icon="💳"
          title="הגדרות תשלום"
          description="תנאי תשלום ואמצעי תשלום וברירות מחדל."
        />
        <CategoryCard
          to="/admin/settings/crm/pricing"
          icon="🧮"
          title="תמחור"
          description="מחירונים, חוקי תמחור וברירות מחדל לפי ארגון."
        />
        <CategoryCard
          to="/admin/settings/crm/ticket-types"
          icon="🎟️"
          title="סוגי כרטיסים"
          description="קטלוג סוגי הכרטיסים לתמחור לפי כרטיס (מבוגר / ילד וכו')."
        />
        <CategoryCard
          to="/admin/settings/crm/sabbath-hours"
          icon="🕯️"
          title="שעות שבת וחג"
          description="חלונות הזמן שמגדירים מתי תאריך נחשב שבת / חג / ערב חג."
        />
      </CategoryGrid>
    </div>
  );
}
