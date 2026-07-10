import { useEffect, useState } from 'react';
import SettingsChrome from '../../settings/SettingsChrome.jsx';
import Toggle from '../../common/Toggle.jsx';
import ConfirmDialog from '../../common/ConfirmDialog.jsx';
import { api } from '../../../lib/api.js';
import { TimeField } from '../../common/pickers/DateTimeFields.jsx';
import { productContextFor } from '../../deals/tourContext.js';
import { TOUR_LANGS, TOUR_LANG_LABELS, WEEKDAY_LABELS } from '../config.js';

// Settings → Tours → "סיורים קבוצתיים" — automatic slot generation: global
// defaults (capacity, horizon) + the recurring weekly rules that auto-generate
// group Tour Slots as dates enter the horizon. Moved VERBATIM out of the old
// single-page ToursSettings (now a category landing page); no behavior change.

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

const EMPTY_RULE = { productId: '', productVariantId: '', weekday: 4, startTime: '17:00', tourLanguage: 'he', capacity: '' };

export default function GroupToursSettings() {
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
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">סיורים קבוצתיים</h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          יצירה אוטומטית של סלוטים קבוצתיים — קיבולת ברירת מחדל, אופק תכנון וכללי תזמון שבועיים.
        </p>
      </header>

      <section className="bg-white border border-gray-200 rounded-2xl shadow-sm mb-6">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100">
          <h2 className="text-[15px] font-semibold text-gray-900">תזמון אוטומטי</h2>
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
