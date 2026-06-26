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
          to="/admin/settings/crm/products"
          icon="📦"
          title="מוצרים"
          description="קטלוג המוצרים והוריאציות לפי מיקום."
        />
        <CategoryCard
          to="/admin/settings/crm/locations"
          icon="📍"
          title="מיקומים"
          description="קטלוג המיקומים (עיר / אזור)."
        />
        <CategoryCard
          to="/admin/settings/crm/payment"
          icon="💳"
          title="הגדרות תשלום"
          description="תנאי תשלום ואמצעי תשלום וברירות מחדל."
        />
      </CategoryGrid>
    </div>
  );
}
