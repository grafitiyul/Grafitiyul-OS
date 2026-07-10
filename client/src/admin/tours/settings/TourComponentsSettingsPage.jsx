import SettingsChrome from '../../settings/SettingsChrome.jsx';
import ActivityComponentsSettings from './ActivityComponentsSettings.jsx';
import WorkshopLocationsSettings from './WorkshopLocationsSettings.jsx';

// Settings → Tours → "מרכיבי הפעילות ומיקומי הסדנה". One page for one
// operational concept: the Activity Components catalog and the Workshop
// Locations that serve its workshop components. The two section components are
// reused as-is (they own their own data + cards); this page only re-homes them
// from the old single-page ToursSettings.
export default function TourComponentsSettingsPage() {
  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <SettingsChrome />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">
          מרכיבי הפעילות ומיקומי הסדנה
        </h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          אבני הבניין של כל סיור והמיקומים שבהם מתקיימות הסדנאות. ברירות המחדל לכל
          וריאציה נקבעות בעריכת המוצר; כאן מנהלים את הקטלוגים עצמם.
        </p>
      </header>

      <ActivityComponentsSettings />
      <WorkshopLocationsSettings />
    </div>
  );
}
