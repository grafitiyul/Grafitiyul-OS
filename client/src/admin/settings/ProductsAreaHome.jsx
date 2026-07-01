import SettingsChrome from './SettingsChrome.jsx';
import { CategoryGrid, CategoryCard } from './cards.jsx';

// Products area — the "what we sell" workspace hub. Groups the catalog-facing
// settings that a business owner thinks of together. Navigation only: each card
// links to its existing settings page (URLs unchanged). Long-term each Product
// will host its own details/locations/pricing/add-ons/images — NOT built here.
export default function ProductsAreaHome() {
  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-4xl mx-auto">
      <header className="mb-8">
        <SettingsChrome />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">מוצרים</h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          כל מה שמגדיר את מה שאנחנו מוכרים: מוצרים, מיקומים ותוספות.
        </p>
      </header>

      <CategoryGrid>
        <CategoryCard
          to="/admin/settings/crm/products"
          icon="📦"
          title="מוצרים ראשיים"
          description="קטלוג המוצרים והוריאציות לפי מיקום."
        />
        <CategoryCard
          to="/admin/settings/crm/addons"
          icon="➕"
          title="תוספות"
          description="פריטים נמכרים שאינם מוצרים, עם עקיפות מחיר."
        />
        <CategoryCard
          to="/admin/settings/crm/locations"
          icon="📍"
          title="מיקומים"
          description="קטלוג המיקומים (עיר / אזור)."
        />
      </CategoryGrid>
    </div>
  );
}
