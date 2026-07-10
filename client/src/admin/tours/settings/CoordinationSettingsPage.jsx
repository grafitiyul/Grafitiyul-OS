import SettingsChrome from '../../settings/SettingsChrome.jsx';
import QuestionnairePurposeCard from '../../settings/QuestionnairePurposeCard.jsx';

// Settings → Tours → "שיחת תיאום". Binds the coordination purpose to a
// questionnaire template (built in the generic builder). Future coordination
// settings (timing, reminders, channels) join this page as more cards.
export default function CoordinationSettingsPage() {
  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <SettingsChrome />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">שיחת תיאום</h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          הטופס שהלקוח ממלא לפני הסיור — בחירת התבנית, עריכתה בבילדר וסטטוס הפרסום.
        </p>
      </header>

      <QuestionnairePurposeCard
        purpose="coordination"
        title="שאלון שיחת תיאום"
        description="הטופס שהלקוח ממלא לפני הסיור (קישור אישי לכל הזמנה, ללא התחברות). נבנה בבילדר — כאן רק בוחרים איזו תבנית משמשת."
      />
    </div>
  );
}
