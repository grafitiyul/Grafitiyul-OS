import { useState } from 'react';
import SettingsChrome from './SettingsChrome.jsx';
import Toggle from '../common/Toggle.jsx';

// Tours module settings — the CONFIGURATION SURFACE for the future Tours
// module, established ahead of the module itself. Today it holds only the
// guide-permission placeholders: what a guide will be allowed to see/do on a
// tour they are assigned to. Everything defaults to ON.
//
// PLACEHOLDER ONLY — the toggles live in local state: nothing is persisted and
// nothing is enforced anywhere yet (there is no guide-facing runtime). When the
// Tours module lands, this list becomes a server-backed catalog and the runtime
// reads it; the keys below are the intended contract.
const GUIDE_PERMISSIONS = [
  { key: 'viewAssignedTours', label: 'צפייה בסיורים משובצים', desc: 'המדריך רואה את הסיורים שהוא משובץ אליהם, כולל תאריך, שעה ונקודת מפגש.' },
  { key: 'viewParticipants', label: 'צפייה ברשימת המשתתפים', desc: 'שמות המשתתפים וכמותם בסיור.' },
  { key: 'viewContactDetails', label: 'צפייה בפרטי איש הקשר', desc: 'טלפון ופרטי הקשר של איש הקשר בדיל, ליצירת קשר ביום הסיור.' },
  { key: 'viewCustomerNotes', label: 'צפייה במידע חשוב על הלקוח', desc: 'ההערות הפנימיות שנרשמו על הלקוח בדיל.' },
  { key: 'viewPaymentStatus', label: 'צפייה בסטטוס תשלום', desc: 'האם הסיור שולם, שולם חלקית או ממתין לגבייה.' },
  { key: 'fillTourSummary', label: 'מילוי טופס סיכום סיור', desc: 'המדריך ממלא את טופס סיכום הסיור בסיום (הטופס עצמו ייבנה עם מודול הסיורים).' },
];

export default function ToursSettings() {
  // Local, non-persisted state — see the header comment. All ON by default.
  const [perms, setPerms] = useState(() =>
    Object.fromEntries(GUIDE_PERMISSIONS.map((p) => [p.key, true])),
  );

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <SettingsChrome />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">
          סיורים
        </h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          הגדרות מודול הסיורים. כרגע — הרשאות מדריכים בלבד.
        </p>
      </header>

      <section className="bg-white border border-gray-200 rounded-2xl shadow-sm">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100">
          <h2 className="text-[15px] font-semibold text-gray-900">הרשאות מדריכים</h2>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            מה מדריך משובץ רואה ועושה בסיורים שלו.
          </p>
        </div>
        <div className="divide-y divide-gray-100">
          {GUIDE_PERMISSIONS.map((p) => (
            <div key={p.key} className="flex items-start justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-gray-800">{p.label}</div>
                <div className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">{p.desc}</div>
              </div>
              <Toggle
                checked={perms[p.key]}
                onChange={(v) => setPerms((prev) => ({ ...prev, [p.key]: v }))}
                label={p.label}
              />
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 bg-amber-50/60 rounded-b-2xl">
          <p className="text-[12px] text-amber-700 leading-relaxed">
            ⚠️ מודול הסיורים עדיין לא נבנה — ההגדרות כאן הן הכנה בלבד: הן אינן
            נשמרות ואינן נאכפות עדיין. ברירת המחדל של כל ההרשאות היא פעיל.
          </p>
        </div>
      </section>
    </div>
  );
}
