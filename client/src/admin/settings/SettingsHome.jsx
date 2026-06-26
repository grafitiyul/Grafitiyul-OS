import { CategoryGrid, CategoryCard } from './cards.jsx';

// Global Settings home — category cards. Low-frequency configuration, reached
// from the bottom of the sidebar. Only CRM Settings is active today; the rest
// are placeholders for future modules.
export default function SettingsHome() {
  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-4xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          הגדרות
        </h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          קונפיגורציה של המערכת. נכנסים לכאן בעיקר בהקמה ראשונית ולעדכונים
          נדירים.
        </p>
      </header>

      <CategoryGrid>
        <CategoryCard
          to="/admin/settings/crm"
          icon="🏢"
          title="הגדרות CRM"
          description="סוגי ארגון, תת-סוגים, שלבי עסקה ועוד."
        />
        <CategoryCard
          icon="🔐"
          title="משתמשים והרשאות"
          description="ניהול משתמשי מערכת, תפקידים והרשאות."
          comingSoon
        />
        <CategoryCard
          icon="💬"
          title="תקשורת"
          description="חיבורי WhatsApp ואימייל, תבניות הודעה."
          comingSoon
        />
        <CategoryCard
          icon="💰"
          title="כספים"
          description="תנאי תשלום, חיבור iCount, הצעות מחיר וקבלות."
          comingSoon
        />
        <CategoryCard
          icon="🗺️"
          title="סיורים"
          description="סוגי סיור, הגדרות תפעול ושיבוץ מדריכים."
          comingSoon
        />
        <CategoryCard
          icon="⚙️"
          title="מערכת"
          description="הגדרות כלליות, גיבוי וניטור."
          comingSoon
        />
      </CategoryGrid>
    </div>
  );
}
