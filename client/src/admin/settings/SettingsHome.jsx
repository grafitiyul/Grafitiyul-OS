import { CategoryGrid, CategoryCard } from './cards.jsx';
import WhatsAppLogo from '../common/WhatsAppLogo.jsx';

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
          to="/admin/whatsapp"
          icon={<WhatsAppLogo size={30} />}
          title="WhatsApp"
          description="תיבת השיחות, חיבור מספרי WhatsApp, מצב חיבור ופעולות ניהול."
        />
        <CategoryCard
          to="/admin/settings/finance"
          icon="💰"
          title="כספים"
          description="רכיבי שכר, סוגי פעילות כללית והגדרות מודול הכספים."
        />
        <CategoryCard
          to="/admin/settings/tours"
          icon="🗺️"
          title="סיורים"
          description="הרשאות מדריכים והגדרות תפעול — הכנה למודול הסיורים."
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
