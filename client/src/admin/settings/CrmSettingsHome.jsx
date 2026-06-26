import { Link } from 'react-router-dom';
import { CategoryGrid, CategoryCard } from './cards.jsx';

// CRM Settings category page — lists the CRM configuration sub-screens. Only
// the catalogs screen (Organization Types / Subtypes / Deal Stages) is active
// today; the rest are placeholders.
export default function CrmSettingsHome() {
  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-4xl mx-auto">
      <header className="mb-8">
        <Link
          to="/admin/settings"
          className="text-[13px] text-blue-700 hover:underline"
        >
          ← הגדרות
        </Link>
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
          title="סוגי ארגון, תת-סוגים ושלבים"
          description="קטלוג סוגי ארגון, תת-סוגים לעסקאות, ושלבי צינור המכירות."
        />
        <CategoryCard
          icon="📍"
          title="מקורות"
          description="מקורות הגעת לידים ועסקאות."
          comingSoon
        />
        <CategoryCard
          icon="🧾"
          title="תנאי תשלום"
          description="תנאי תשלום סטנדרטיים לשימוש חוזר."
          comingSoon
        />
        <CategoryCard
          icon="✉️"
          title="תבניות"
          description="תבניות אימייל, WhatsApp והצעות מחיר."
          comingSoon
        />
      </CategoryGrid>
    </div>
  );
}
