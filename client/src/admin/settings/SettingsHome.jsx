import {
  CategoryGrid,
  CategoryCard,
  ModuleGrid,
  ModuleCard,
  SectionEyebrow,
  SectionHeader,
} from './cards.jsx';
import WhatsAppLogo from '../common/WhatsAppLogo.jsx';
import { useResolvedNav } from '../../shell/navConfig.jsx';
import { settingsModules } from '../../shell/navResolve.js';

// Global Settings home. TWO sections, deliberately styled differently because
// they are different kinds of destination:
//
//   1. תצורת מערכת — configuration pages. You change a value and come back.
//   2. מודולים לניהול — complete modules that live here only because they are
//      administrative. You go there to work.
//
// Section 2 is rendered from the navigation registry (navResolve.js), never
// hand-listed, which is what guarantees the invariant "rail ∪ this grid = every
// module": a module the administrator removes from the main navigation grows a
// card here automatically and can never become unreachable.
export default function SettingsHome() {
  const resolved = useResolvedNav();
  const modules = settingsModules(resolved);

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-4xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          הגדרות
        </h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          קונפיגורציה של המערכת, ומודולי הניהול המלאים.
        </p>
      </header>

      <section>
        <SectionEyebrow>תצורת מערכת</SectionEyebrow>
        <CategoryGrid>
          <CategoryCard
            to="/admin/settings/crm"
            icon="🏢"
            title="הגדרות CRM"
            description="סוגי ארגון, תת-סוגים, שלבי עסקה ועוד."
          />
          <CategoryCard
            to="/admin/settings/navigation"
            icon="🧭"
            title="ניווט ותפריטים"
            description="אילו מודולים מופיעים בתפריט הראשי ובאיזה סדר."
          />
          <CategoryCard
            to="/admin/whatsapp"
            icon={<WhatsAppLogo size={30} />}
            title="WhatsApp"
            description="תיבת השיחות, חיבור מספרי WhatsApp, מצב חיבור ופעולות ניהול."
          />
          <CategoryCard
            to="/admin/settings/communication"
            icon="💬"
            title="נוסחים למייל + WhatsApp"
            description="מרכז התקשורת — נוסחים אוטומטיים, טריגרים, תזמונים וחלונות שליחה."
          />
          <CategoryCard
            to="/admin/settings/admin-reports"
            icon="📣"
            title="דיווחי מנהלים"
            description="התראות פנימיות אוטומטיות המנוהלות בקוד — תשלום, הצעת מחיר, שינוי מועד."
          />
          <CategoryCard
            to="/admin/settings/finance"
            icon="💰"
            title="כספים"
            description="רכיבי שכר, סוגי תוספת כללית והגדרות מודול הכספים."
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
      </section>

      {/* The band below is a different kind of destination — the generous gap
          and the rule above it are the separation, and the card language inside
          does the rest. */}
      <section className="mt-14 border-t border-gray-200 pt-9">
        <SectionHeader
          title="מודולים לניהול"
          description="מודולים מלאים, לא מסכי הגדרות. הם יושבים כאן כי הם ניהוליים — לחיצה פותחת את המודול עצמו."
        />
        <ModuleGrid>
          {modules.map((m) => (
            <ModuleCard
              key={m.key}
              to={m.to}
              icon={m.glyph}
              Icon={m.Icon}
              title={m.label}
              description={m.description}
              badge={!m.inNav && !m.management ? 'הוסתר מהתפריט' : null}
            />
          ))}
        </ModuleGrid>
      </section>
    </div>
  );
}
