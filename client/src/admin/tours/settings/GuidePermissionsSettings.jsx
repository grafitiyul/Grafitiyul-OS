import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import SettingsChrome from '../../settings/SettingsChrome.jsx';
import Toggle from '../../common/Toggle.jsx';

// Settings → Tours → "הרשאות מדריכים". SERVER-BACKED singleton
// (GuidePortalSettings) — every switch here is enforced server-side by the
// Guide Portal routes (/api/portal/...): data is filtered/blocked on the
// server, never just hidden in the UI. Gallery delete/share stay on the
// gallery settings screen (TourGallerySettings — their SSOT).

const GROUPS = [
  {
    title: 'פרטי הסיור',
    items: [
      { key: 'viewTeam', label: 'צפייה בצוות הסיור', desc: 'המדריך רואה את חברי הצוות המשובצים לסיור, כולל תפקיד ותמונה.' },
      { key: 'viewParticipantPhone', label: 'צפייה בטלפון הלקוח', desc: 'מספר הטלפון של איש הקשר בכרטיס המשתתפים.' },
      { key: 'viewParticipantEmail', label: 'צפייה באימייל הלקוח', desc: 'כתובת האימייל של איש הקשר בכרטיס המשתתפים.' },
      { key: 'viewCustomerInfo', label: 'צפייה במידע חשוב על הלקוח', desc: 'ההערה התפעולית שנרשמה על הלקוח (״מידע חשוב״) בכרטיס המשתתפים.' },
      { key: 'viewFieldRep', label: 'צפייה בנציג בשטח', desc: 'שם הנציג בשטח, כשמוגדר איש קשר כזה במפורש.' },
    ],
  },
  {
    title: 'טפסים וגלריה',
    items: [
      { key: 'fillTourSummary', label: 'מילוי טופס סיכום סיור', desc: 'המדריך פותח וממלא את טופס סיכום הסיור מהפורטל.' },
      { key: 'useCoordinationForms', label: 'שימוש בטפסי שיחת תיאום', desc: 'המדריך רואה את סטטוס טופס התיאום של כל משתתף ופותח אותו.' },
      { key: 'useTourGallery', label: 'שימוש בגלריית הסיור', desc: 'המדריך פותח את גלריית הסיור, מעלה וצופה במדיה. (מחיקת מדיה ושיתוף קישור ללקוח מנוהלים בהגדרות הגלריה.)' },
    ],
  },
  {
    title: 'לשוניות ותפריט',
    items: [
      { key: 'viewPastTours', label: 'צפייה בסיורי עבר', desc: 'לשונית ״סיורי עבר״ — סיורים שהסתיימו, כולל סיכום וגלריה.' },
      { key: 'viewPay', label: 'צפייה בשכר', desc: 'לשונית ״שכר״ בפורטל (בשלב זה מסך הכנה — אין נתוני שכר במערכת).' },
      { key: 'viewProcedures', label: 'צפייה בנהלים', desc: 'הנהלים והמשימות מהמודול הקיים (פיד המשימות של הפורטל).' },
      { key: 'viewTraining', label: 'צפייה במערכי הדרכה', desc: 'תוכן הדרכה בפורטל (כשהמודול יהיה זמין).' },
      { key: 'editPersonalProfile', label: 'עריכת פרטים אישיים', desc: 'המדריך צופה ומעדכן את הפרטים האישיים שלו מהפורטל.' },
    ],
  },
];

export default function GuidePermissionsSettings() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    api.guidePortalSettings
      .get()
      .then(setSettings)
      .catch((e) => setError(e.payload?.error || e.message));
  }, []);

  async function save(patch) {
    const prev = settings;
    setSettings({ ...settings, ...patch }); // optimistic
    try {
      const next = await api.guidePortalSettings.update(patch);
      setSettings(next);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      setSettings(prev);
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    }
  }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <SettingsChrome />
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">הרשאות מדריכים</h1>
          {savedFlash && <span className="text-[12.5px] font-semibold text-emerald-600">✓ נשמר</span>}
        </div>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          מה מדריך משובץ רואה ועושה בפורטל המדריכים. ההרשאות נאכפות בשרת — לא רק בהסתרת כפתורים.
        </p>
      </header>

      {error ? (
        <p className="text-sm text-red-600">
          שגיאה: <span dir="ltr" className="font-mono">{error}</span>
        </p>
      ) : !settings ? (
        <p className="text-sm text-gray-400">טוען…</p>
      ) : (
        <div className="space-y-6">
          {GROUPS.map((group) => (
            <section key={group.title} className="bg-white border border-gray-200 rounded-2xl shadow-sm">
              <h2 className="px-5 pt-4 pb-1 text-[13px] font-bold text-gray-500">{group.title}</h2>
              <div className="divide-y divide-gray-100">
                {group.items.map((p) => (
                  <div key={p.key} className="flex items-start justify-between gap-4 px-5 py-3.5">
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-medium text-gray-800">{p.label}</div>
                      <div className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">{p.desc}</div>
                    </div>
                    <Toggle
                      checked={!!settings[p.key]}
                      onChange={(v) => save({ [p.key]: v })}
                      label={p.label}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
