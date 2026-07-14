import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import SettingsChrome from '../../settings/SettingsChrome.jsx';
import Toggle from '../../common/Toggle.jsx';
import AlertDialog from '../../common/AlertDialog.jsx';

// Settings → Tours → "גלריית סיורים". Server-backed singleton
// (TourGallerySettings) — every switch here materially controls behavior that
// is ENFORCED SERVER-SIDE (guide delete / link sharing / customer uploads).

const TOGGLES = [
  {
    key: 'guideCanDelete',
    label: 'מדריכים יכולים למחוק מדיה',
    desc: 'מדריך משובץ יכול למחוק תמונות וסרטונים מגלריות הסיורים שלו בפורטל המדריכים.',
  },
  {
    key: 'guideCanShareCustomerLink',
    label: 'מדריכים יכולים לשתף קישור ללקוח',
    desc: 'מדריך משובץ רואה ומעתיק את קישור הגלריה הציבורי של הסיור.',
  },
  {
    key: 'customerUploadEnabled',
    label: 'לקוחות יכולים להעלות מדיה (ברירת מחדל)',
    desc: 'ברירת המחדל לגלריות חדשות — לקוח עם קישור יכול להעלות תמונות וסרטונים משלו. מופיעות מיד, מסומנות פנימית כהעלאת לקוח.',
  },
];

export default function GallerySettingsPage() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [alertMsg, setAlertMsg] = useState(null); // system AlertDialog, never window.alert

  useEffect(() => {
    api.tourGallery
      .settings()
      .then(setSettings)
      .catch((e) => setError(e.payload?.error || e.message));
  }, []);

  async function save(patch) {
    const prev = settings;
    setSettings({ ...settings, ...patch }); // optimistic
    try {
      const next = await api.tourGallery.updateSettings(patch);
      setSettings(next);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      setSettings(prev);
      setAlertMsg('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    }
  }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <SettingsChrome />
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">גלריית סיורים</h1>
          {savedFlash && <span className="text-[12.5px] font-semibold text-emerald-600">✓ נשמר</span>}
        </div>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          הרשאות והתנהגות של גלריות המדיה של הסיורים — מדריכים, לקוחות וקבצי הורדה.
        </p>
      </header>

      {error ? (
        <p className="text-sm text-red-600">
          שגיאה: <span dir="ltr" className="font-mono">{error}</span>
        </p>
      ) : !settings ? (
        <p className="text-sm text-gray-400">טוען…</p>
      ) : (
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm">
          <div className="divide-y divide-gray-100">
            {TOGGLES.map((t) => (
              <div key={t.key} className="flex items-start justify-between gap-4 px-5 py-3.5">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-gray-800">{t.label}</div>
                  <div className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">{t.desc}</div>
                </div>
                <Toggle
                  checked={!!settings[t.key]}
                  onChange={(v) => save({ [t.key]: v })}
                  label={t.label}
                />
              </div>
            ))}

            <div className="flex items-start justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-gray-800">שורת מיתוג בגלריה הציבורית</div>
                <div className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">
                  טקסט קצר שמופיע מתחת לכותרת בעמוד הגלריה של הלקוח (לא חובה).
                </div>
              </div>
              <input
                type="text"
                defaultValue={settings.publicBrandingText || ''}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (settings.publicBrandingText || '')) {
                    save({ publicBrandingText: v || null });
                  }
                }}
                placeholder="למשל: גרפיטיול — סיורי גרפיטי ואמנות רחוב"
                className="w-64 shrink-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-[13px] focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="flex items-start justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-gray-800">תוקף קובץ ״הורדת הכול״</div>
                <div className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">
                  כמה שעות קובץ ה-ZIP המוכן נשאר זמין להורדה לפני שנמחק מהאחסון.
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={720}
                  defaultValue={settings.archiveExpiryHours}
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isInteger(n) && n >= 1 && n <= 720 && n !== settings.archiveExpiryHours) {
                      save({ archiveExpiryHours: n });
                    }
                  }}
                  className="w-20 rounded-lg border border-gray-300 px-2.5 py-1.5 text-[13px] focus:border-blue-500 focus:outline-none"
                  dir="ltr"
                />
                <span className="text-[12.5px] text-gray-500">שעות</span>
              </div>
            </div>
          </div>
        </section>
      )}
      <AlertDialog open={!!alertMsg} body={alertMsg} onClose={() => setAlertMsg(null)} />
    </div>
  );
}
