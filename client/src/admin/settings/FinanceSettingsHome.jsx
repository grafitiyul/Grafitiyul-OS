import { CategoryGrid, CategoryCard } from './cards.jsx';
import SettingsChrome from './SettingsChrome.jsx';

// כספים settings home — the payroll module's configuration surface.
export default function FinanceSettingsHome() {
  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-4xl mx-auto">
      <SettingsChrome />
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">הגדרות כספים</h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          קטלוגים והגדרות של מודול הכספים — רכיבי שכר ופעילויות כלליות.
        </p>
      </header>
      <CategoryGrid>
        <CategoryCard
          to="/admin/settings/finance/payroll-components"
          icon="🧾"
          title="רכיבי שכר"
          description="קטלוג רכיבי השכר — אוטומטיים וידניים, מע״מ, נראות ותצורה."
        />
        <CategoryCard
          to="/admin/settings/finance/activity-types"
          icon="📋"
          title="סוגי פעילות כללית"
          description="ישיבת צוות, עבודה משרדית, הדרכה… ברירות מחדל למחיר וכמות."
        />
      </CategoryGrid>
    </div>
  );
}
