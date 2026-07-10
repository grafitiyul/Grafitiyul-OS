import { useEffect, useState } from 'react';
import SettingsChrome from './SettingsChrome.jsx';
import Toggle from '../common/Toggle.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import { api } from '../../lib/api.js';
import { TimeField } from '../common/pickers/DateTimeFields.jsx';
import { productContextFor } from '../deals/tourContext.js';
import { TOUR_LANGS, TOUR_LANG_LABELS, WEEKDAY_LABELS } from '../tours/config.js';
import ActivityComponentsSettings from '../tours/settings/ActivityComponentsSettings.jsx';
import WorkshopLocationsSettings from '../tours/settings/WorkshopLocationsSettings.jsx';
import QuestionnairePurposeCard from './QuestionnairePurposeCard.jsx';

// Tours module settings — two sections:
//   1. AUTOMATIC SCHEDULING (server-backed, live): global defaults + the
//      recurring weekly rules that auto-generate group Tour Slots as dates
//      enter the horizon. Each rule = Product+Variant+Language+Weekday+Time+
//      Capacity (product decision — multiple recurring schedules).
//   2. Guide permissions — still the approved PLACEHOLDER (local state only);
//      becomes server-backed when the Guide Portal tours phase lands.
const GUIDE_PERMISSIONS = [
  { key: 'viewAssignedTours', label: 'צפייה בסיורים משובצים', desc: 'המדריך רואה את הסיורים שהוא משובץ אליהם, כולל תאריך, שעה ונקודת מפגש.' },
  { key: 'viewParticipants', label: 'צפייה ברשימת המשתתפים', desc: 'שמות המשתתפים וכמותם בסיור.' },
  { key: 'viewContactDetails', label: 'צפייה בפרטי איש הקשר', desc: 'טלפון ופרטי הקשר של איש הקשר בדיל, ליצירת קשר ביום הסיור.' },
  { key: 'viewCustomerNotes', label: 'צפייה במידע חשוב על הלקוח', desc: 'ההערות הפנימיות שנרשמו על הלקוח בדיל.' },
  { key: 'viewPaymentStatus', label: 'צפייה בסטטוס תשלום', desc: 'האם הסיור שולם, שולם חלקית או ממתין לגבייה.' },
  { key: 'fillTourSummary', label: 'מילוי טופס סיכום סיור', desc: 'המדריך ממלא את טופס סיכום הסיור בסיום (הטופס מוגדר בכרטיס "סיכום סיור" למטה; הרשאת הפורטל תיאכף בהמשך).' },
];

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

const EMPTY_RULE = { productId: '', productVariantId: '', weekday: 4, startTime: '17:00', tourLanguage: 'he', capacity: '' };

export default function ToursSettings() {
  // ── scheduling (server-backed) ──
  const [settings, setSettings] = useState(null);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [globalsDraft, setGlobalsDraft] = useState({ defaultCapacity: '', generateDaysAhead: '' });
  const [savingGlobals, setSavingGlobals] = useState(false);
  const [ruleDraft, setRuleDraft] = useState(EMPTY_RULE);
  const [products, setProducts] = useState([]);
  const [variants, setVariants] = useState([]);
  const [savingRule, setSavingRule] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // ── guide permissions (approved placeholder, local state) ──
  const [perms, setPerms] = useState(() =>
    Object.fromEntries(GUIDE_PERMISSIONS.map((p) => [p.key, true])),
  );

  async function refresh() {
    try {
      const { settings: s, rules: r } = await api.tours.scheduling();
      setSettings(s);
      setRules(r);
      setGlobalsDraft({ defaultCapacity: s.defaultCapacity, generateDaysAhead: s.generateDaysAhead });
      setRuleDraft((d) => ({ ...d, capacity: d.capacity === '' ? s.defaultCapacity : d.capacity }));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    api.products.list().then(setProducts).catch(() => {});
  }, []);

  async function chooseProduct(productId) {
    if (!productId) {
      setVariants([]);
      setRuleDraft((d) => ({ ...d, productId: '', productVariantId: '' }));
      return;
    }
    setRuleDraft((d) => ({ ...d, productId }));
    try {
      const ctx = await productContextFor(productId);
      setVariants(ctx.variants);
      setRuleDraft((d) => ({ ...d, productVariantId: ctx.productVariantId }));
    } catch {
      setVariants([]);
      setRuleDraft((d) => ({ ...d, productVariantId: '' }));
    }
  }

  async function saveGlobals() {
    setSavingGlobals(true);
    try {
      await api.tours.updateSchedulingSettings({
        defaultCapacity: Number(globalsDraft.defaultCapacity),
        generateDaysAhead: Number(globalsDraft.generateDaysAhead),
      });
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setSavingGlobals(false);
    }
  }

  async function addRule() {
    setSavingRule(true);
    try {
      await api.tours.createScheduleRule({
        ...ruleDraft,
        capacity: ruleDraft.capacity === '' ? null : Number(ruleDraft.capacity),
      });
      setRuleDraft({ ...EMPTY_RULE, capacity: settings?.defaultCapacity ?? '' });
      setVariants([]);
      await refresh();
    } catch (e) {
      if (e.payload?.error === 'missing_required_fields') {
        alert('שדות חובה חסרים: ' + (e.payload.missing || []).map((m) => m.labelHe).join(', '));
      } else {
        alert('שגיאה: ' + (e.payload?.error || e.message));
      }
    } finally {
      setSavingRule(false);
    }
  }

  async function toggleRule(rule, active) {
    try {
      await api.tours.updateScheduleRule(rule.id, { active });
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  async function deleteRule() {
    const rule = confirmDelete;
    setConfirmDelete(null);
    try {
      await api.tours.removeScheduleRule(rule.id);
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <SettingsChrome />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">סיורים</h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          תזמון אוטומטי של סיורים קבוצתיים והרשאות מדריכים.
        </p>
      </header>

      {/* ── Automatic scheduling ── */}
      <section className="bg-white border border-gray-200 rounded-2xl shadow-sm mb-6">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100">
          <h2 className="text-[15px] font-semibold text-gray-900">תזמון אוטומטי — סיורים קבוצתיים</h2>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            המערכת יוצרת סלוטים עתידיים אוטומטית כשהם נכנסים לאופק המוגדר. עריכת כלל משפיעה על
            סלוטים עתידיים בלבד — סלוטים שכבר נוצרו נערכים במסך הסיורים.
          </p>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">טוען…</div>
        ) : error ? (
          <div className="px-5 py-6 text-center text-sm text-red-600">
            שגיאה: <span dir="ltr" className="font-mono">{error}</span>
          </div>
        ) : (
          <>
            {/* Globals */}
            <div className="flex flex-wrap items-end gap-3 px-5 py-4 border-b border-gray-100">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-gray-600">קיבולת ברירת מחדל</span>
                <input
                  type="number"
                  min="1"
                  value={globalsDraft.defaultCapacity}
                  onChange={(e) => setGlobalsDraft((g) => ({ ...g, defaultCapacity: e.target.value }))}
                  className={INPUT + ' w-32'}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-gray-600">ימים קדימה ליצירה</span>
                <input
                  type="number"
                  min="0"
                  max="366"
                  value={globalsDraft.generateDaysAhead}
                  onChange={(e) => setGlobalsDraft((g) => ({ ...g, generateDaysAhead: e.target.value }))}
                  className={INPUT + ' w-32'}
                />
              </label>
              <button
                type="button"
                disabled={savingGlobals}
                onClick={saveGlobals}
                className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {savingGlobals ? 'שומר…' : 'שמירה'}
              </button>
            </div>

            {/* Rules */}
            <div className="divide-y divide-gray-100">
              {rules.length === 0 && (
                <p className="px-5 py-6 text-center text-[13px] text-gray-400">
                  אין כללי תזמון עדיין — הוסיפו כלל ראשון למטה (למשל: כל חמישי 17:00).
                </p>
              )}
              {rules.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium text-gray-800">
                      כל יום {WEEKDAY_LABELS[r.weekday]} · <span dir="ltr" className="tabular-nums">{r.startTime}</span>
                      <span className="text-gray-500"> · {r.product?.nameHe || '—'}</span>
                      {r.productVariant?.location?.nameHe && (
                        <span className="text-gray-400"> ({r.productVariant.location.nameHe})</span>
                      )}
                    </div>
                    <div className="text-[12px] text-gray-500">
                      {TOUR_LANG_LABELS[r.tourLanguage] || r.tourLanguage} · קיבולת {r.capacity}
                      {!r.active && <span className="ms-1 font-semibold text-amber-600">· מושהה</span>}
                    </div>
                  </div>
                  <Toggle checked={r.active} onChange={(v) => toggleRule(r, v)} label="פעיל" />
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(r)}
                    title="מחיקת הכלל (סלוטים שכבר נוצרו נשארים)"
                    className="h-8 w-8 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>

            {/* Add rule */}
            <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/60 rounded-b-2xl">
              <div className="mb-2 text-[13px] font-semibold text-gray-700">כלל חדש</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <select
                  value={ruleDraft.productId}
                  onChange={(e) => chooseProduct(e.target.value)}
                  className={INPUT + ' bg-white'}
                >
                  <option value="">— מוצר —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <select
                  value={ruleDraft.productVariantId}
                  onChange={(e) => setRuleDraft((d) => ({ ...d, productVariantId: e.target.value }))}
                  disabled={!variants.length}
                  className={INPUT + ' bg-white disabled:bg-gray-100 disabled:text-gray-400'}
                >
                  <option value="">— וריאציה —</option>
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
                <select
                  value={ruleDraft.weekday}
                  onChange={(e) => setRuleDraft((d) => ({ ...d, weekday: Number(e.target.value) }))}
                  className={INPUT + ' bg-white'}
                >
                  {WEEKDAY_LABELS.map((label, i) => (
                    <option key={i} value={i}>יום {label}</option>
                  ))}
                </select>
                <TimeField
                  value={ruleDraft.startTime}
                  onChange={(v) => setRuleDraft((d) => ({ ...d, startTime: v }))}
                  clearable={false}
                />
                <select
                  value={ruleDraft.tourLanguage}
                  onChange={(e) => setRuleDraft((d) => ({ ...d, tourLanguage: e.target.value }))}
                  className={INPUT + ' bg-white'}
                >
                  {TOUR_LANGS.map((l) => (
                    <option key={l.key} value={l.key}>{l.label}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  placeholder="קיבולת"
                  value={ruleDraft.capacity}
                  onChange={(e) => setRuleDraft((d) => ({ ...d, capacity: e.target.value }))}
                  className={INPUT}
                />
              </div>
              <div className="mt-2.5 flex justify-end">
                <button
                  type="button"
                  disabled={savingRule}
                  onClick={addRule}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingRule ? 'שומר…' : '+ הוספת כלל'}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── Activity Components catalog (מרכיבי פעילות) ── */}
      <ActivityComponentsSettings />

      {/* ── Workshop Locations catalog (מיקומי סדנה) ── */}
      <WorkshopLocationsSettings />

      {/* ── Tour Summary questionnaire (generic engine, purpose binding) ── */}
      <QuestionnairePurposeCard
        purpose="tour_summary"
        title="סיכום סיור"
        description="השאלון שצוות הסיור ממלא בסיום כל סיור. נבנה בבילדר השאלונים — כאן רק בוחרים איזו תבנית משמשת."
      />

      {/* ── Coordination questionnaire (public, per Booking) ── */}
      <QuestionnairePurposeCard
        purpose="coordination"
        title="שיחת תיאום"
        description="הטופס שהלקוח ממלא לפני הסיור (קישור אישי לכל הזמנה, ללא התחברות). נבנה בבילדר — כאן רק בוחרים איזו תבנית משמשת."
      />

      {/* ── Guide permissions (approved placeholder) ── */}
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
            ⚠️ הרשאות המדריכים הן הכנה בלבד: הן אינן נשמרות ואינן נאכפות עד שסיורים יוצגו
            בפורטל המדריכים. ברירת המחדל של כל ההרשאות היא פעיל.
          </p>
        </div>
      </section>

      <ConfirmDialog
        open={!!confirmDelete}
        title="מחיקת כלל תזמון"
        body="למחוק את הכלל? סלוטים שכבר נוצרו ממנו יישארו במסך הסיורים; רק יצירה עתידית תיפסק."
        confirmLabel="מחק כלל"
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={deleteRule}
      />
    </div>
  );
}
