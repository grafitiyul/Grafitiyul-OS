import {
  CategoryGrid,
  CategoryCard,
  ModuleGrid,
  ModuleCard,
  SectionEyebrow,
  SectionHeader,
  SectionAction,
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
// Section 2 lists EVERY full module, rendered from the navigation registry
// (navResolve.js) and never hand-listed. It is a permanent second entry point
// to all modules — including the ones sitting in the nav rail — which is what
// makes "no module can become unreachable" unconditional rather than a rule
// about hidden modules.
//
// Each card states its navigation status, so this screen answers "where does
// this module live?" without opening the editor.
function navBadge(m) {
  if (!m.inNav) return 'לא בתפריט';
  return m.railGroup === 'primary' ? 'בתפריט — למעלה' : 'בתפריט — למטה';
}

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
            to="/admin/settings/queue"
            icon="📤"
            title="תור שליחה"
            description="כל ההודעות היוצאות במקום אחד — WhatsApp ואימייל, כולל זמני שליחה לכל קהל."
          />
          <CategoryCard
            to="/admin/settings/automations"
            icon="⚡"
            title="אוטומציות"
            description="מרשם האוטומציות — מה רץ, מה תקוע ולמה. אוטומציות שאלונים המפעילות כללי תקשורת."
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
        </CategoryGrid>
      </section>

      {/* The band below is a different kind of destination — the generous gap
          and the rule above it are the separation, and the card language inside
          does the rest. Its header carries the section's own control: managing
          the main menu belongs to the whole section, not to one module in it. */}
      <section className="mt-14 border-t border-gray-200 pt-9">
        <SectionHeader
          title="מודולים לניהול"
          description="כל המודולים המלאים של המערכת — גם אלה שמופיעים בתפריט הראשי. לחיצה פותחת את המודול עצמו."
          action={
            <SectionAction to="/admin/settings/navigation" icon="⚙️">
              ניהול התפריט
            </SectionAction>
          }
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
              badge={navBadge(m)}
            />
          ))}
        </ModuleGrid>
      </section>
    </div>
  );
}
