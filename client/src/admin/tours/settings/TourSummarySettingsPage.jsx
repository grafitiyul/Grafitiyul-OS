import SettingsChrome from '../../settings/SettingsChrome.jsx';
import QuestionnairePurposeCard from '../../settings/QuestionnairePurposeCard.jsx';

// Settings → Tours → "סיכום סיור". Binds the tour-summary purpose to a
// questionnaire template (built in the generic builder). Future summary
// settings (required-on-complete, reviewer flow) join this page as more cards.
export default function TourSummarySettingsPage() {
  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <SettingsChrome />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">סיכום סיור</h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          השאלון שצוות הסיור ממלא בסיום כל סיור — בחירת התבנית, עריכתה בבילדר וסטטוס הפרסום.
        </p>
      </header>

      <QuestionnairePurposeCard
        purpose="tour_summary"
        title="שאלון סיכום סיור"
        description="השאלון שצוות הסיור ממלא בסיום כל סיור. נבנה בבילדר השאלונים — כאן רק בוחרים איזו תבנית משמשת."
      />
    </div>
  );
}
