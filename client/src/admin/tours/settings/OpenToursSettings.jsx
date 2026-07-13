import { useEffect, useState } from 'react';
import SettingsChrome from '../../settings/SettingsChrome.jsx';
import Toggle from '../../common/Toggle.jsx';
import Dialog from '../../common/Dialog.jsx';
import ConfirmDialog from '../../common/ConfirmDialog.jsx';
import { DateField, TimeField } from '../../common/pickers/DateTimeFields.jsx';
import { api } from '../../../lib/api.js';
import { TOUR_LANGS, TOUR_LANG_LABELS, WEEKDAY_LABELS, fmtTourDate } from '../config.js';

// Settings → Tours → "סיורים פתוחים" — recurring OPEN TOUR templates. A template
// is the reusable "what" (city, meeting point, duration, capacity, offered
// sellable ticket products); its schedule rules are the "when"; exceptions are
// one-offs. Generation materializes real group Tour Slots from them. Nothing
// here names a product — offered products are Pricing Cards flagged sellable,
// and the operational product is DERIVED from registrations at runtime.

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';
const PRIMARY =
  'rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50';
const FIELD_LABEL = 'mb-1 block text-[12px] font-medium text-gray-600';

const EXCEPTION_TYPE_LABELS = { add: 'תוספת מועד', cancel: 'ביטול מועד', time_override: 'שינוי שעה' };

function errText(e) {
  return 'שגיאה: ' + (e.payload?.error || e.message);
}

export default function OpenToursSettings() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  // Shared TourSettings globals (migrated here from the retired Group Tours page).
  const [globals, setGlobals] = useState({ defaultCapacity: '', generateDaysAhead: '' });
  const [savingGlobals, setSavingGlobals] = useState(false);

  async function refresh() {
    try {
      const list = await api.openTours.list();
      setTemplates(list);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    api.tours
      .scheduling()
      .then(({ settings }) =>
        setGlobals({ defaultCapacity: settings.defaultCapacity, generateDaysAhead: settings.generateDaysAhead }),
      )
      .catch(() => {});
  }, []);

  async function saveGlobals() {
    setSavingGlobals(true);
    try {
      await api.tours.updateSchedulingSettings({
        defaultCapacity: Number(globals.defaultCapacity),
        generateDaysAhead: Number(globals.generateDaysAhead),
      });
    } catch (e) {
      alert(errText(e));
    } finally {
      setSavingGlobals(false);
    }
  }

  async function createTemplate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const t = await api.openTours.create({ nameHe: newName.trim() });
      setNewName('');
      await refresh();
      setEditId(t.id); // open the editor on the fresh template
    } catch (e) {
      alert(errText(e));
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(t, active) {
    try {
      await api.openTours.update(t.id, { active });
      await refresh();
    } catch (e) {
      alert(errText(e));
    }
  }

  async function deleteTemplate() {
    const t = confirmDelete;
    setConfirmDelete(null);
    try {
      await api.openTours.remove(t.id);
      await refresh();
    } catch (e) {
      alert(errText(e));
    }
  }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <SettingsChrome />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">סיורים פתוחים</h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          תבניות סיור חוזרות שמייצרות סלוטים אוטומטית. כל תבנית מגדירה מיקום, משך וקיבולת, ואילו
          כרטיסים נמכרים בה — המוצר התפעולי של הסיור נגזר אוטומטית מההרשמות בפועל.
        </p>
      </header>

      {/* Shared generation globals */}
      <section className="bg-white border border-gray-200 rounded-2xl shadow-sm mb-6">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100">
          <h2 className="text-[15px] font-semibold text-gray-900">תזמון אוטומטי</h2>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            המערכת יוצרת סלוטים עתידיים אוטומטית כשהם נכנסים לאופק המוגדר, לפי תבניות הסיור הפתוח.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <label className="block">
            <span className={FIELD_LABEL}>קיבולת ברירת מחדל</span>
            <input
              type="number"
              min="1"
              value={globals.defaultCapacity}
              onChange={(e) => setGlobals((g) => ({ ...g, defaultCapacity: e.target.value }))}
              className={INPUT + ' w-32'}
            />
          </label>
          <label className="block">
            <span className={FIELD_LABEL}>ימים קדימה ליצירה</span>
            <input
              type="number"
              min="0"
              max="366"
              value={globals.generateDaysAhead}
              onChange={(e) => setGlobals((g) => ({ ...g, generateDaysAhead: e.target.value }))}
              className={INPUT + ' w-32'}
            />
          </label>
          <button type="button" disabled={savingGlobals} onClick={saveGlobals} className={PRIMARY + ' h-10'}>
            {savingGlobals ? 'שומר…' : 'שמירה'}
          </button>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-2xl shadow-sm mb-6">
        <div className="flex flex-wrap items-end gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50/60 rounded-t-2xl">
          <label className="block flex-1 min-w-[200px]">
            <span className={FIELD_LABEL}>תבנית חדשה</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createTemplate()}
              placeholder="למשל: סיור גרפיטי — תל אביב"
              className={INPUT}
            />
          </label>
          <button type="button" disabled={creating || !newName.trim()} onClick={createTemplate} className={PRIMARY}>
            {creating ? 'יוצר…' : '+ יצירת תבנית'}
          </button>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">טוען…</div>
        ) : error ? (
          <div className="px-5 py-6 text-center text-sm text-red-600">
            שגיאה: <span dir="ltr" className="font-mono">{error}</span>
          </div>
        ) : templates.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-gray-400">
            אין תבניות עדיין — צרו תבנית ראשונה למעלה.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {templates.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-gray-800">
                    {t.nameHe}
                    {t.location?.nameHe && <span className="font-normal text-gray-400"> · {t.location.nameHe}</span>}
                    {!t.active && <span className="ms-1 text-[12px] font-semibold text-amber-600">· מושהה</span>}
                  </div>
                  <div className="text-[12px] text-gray-500">
                    {t.scheduleRules?.length || 0} כללי תזמון · {t.products?.length || 0} מוצרים ·{' '}
                    {t.exceptions?.length || 0} חריגים
                  </div>
                </div>
                <Toggle checked={t.active} onChange={(v) => toggleActive(t, v)} label="פעיל" />
                <button
                  type="button"
                  onClick={() => setEditId(t.id)}
                  className="h-8 rounded-md px-3 text-[13px] font-medium text-blue-600 hover:bg-blue-50"
                >
                  עריכה
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(t)}
                  title="מחיקת התבנית (סלוטים שכבר נוצרו נשארים)"
                  className="h-8 w-8 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <WooMappingsSection />

      {editId && (
        <OpenTourEditor
          templateId={editId}
          onClose={() => {
            setEditId(null);
            refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="מחיקת תבנית סיור פתוח"
        body="למחוק את התבנית? כלליה, חריגיה ומוצריה יימחקו, אך סלוטים שכבר נוצרו יישארו במסך הסיורים; רק יצירה עתידית תיפסק."
        confirmLabel="מחק תבנית"
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={deleteTemplate}
      />
    </div>
  );
}

// ── Editor dialog (bound to a persisted template) ────────────────────────────

const EMPTY_RULE = { weekday: 4, startTime: '17:00', validFrom: '', validUntil: '', season: '' };
const EMPTY_EXC = { date: '', type: 'add', time: '11:00' };

function OpenTourEditor({ templateId, onClose }) {
  const [tpl, setTpl] = useState(null);
  const [locations, setLocations] = useState([]);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scalars, setScalars] = useState(null);
  const [saving, setSaving] = useState(false);
  const [ruleDraft, setRuleDraft] = useState(EMPTY_RULE);
  const [excDraft, setExcDraft] = useState(EMPTY_EXC);

  async function load() {
    try {
      const [t, locs, sellable] = await Promise.all([
        api.openTours.get(templateId),
        api.locations.list().catch(() => []),
        api.openTours.sellableProducts().catch(() => ({ cards: [] })),
      ]);
      setTpl(t);
      setLocations(locs);
      setCards(sellable.cards || []);
      setScalars({
        nameHe: t.nameHe || '',
        locationId: t.locationId || '',
        meetingPoint: t.meetingPoint || '',
        tourLanguage: t.tourLanguage || 'he',
        durationHoursOverride: t.durationHoursOverride ?? '',
        capacity: t.capacity ?? '',
        registrationCloseMinutes: t.registrationCloseMinutes ?? '',
        defaultLeadGuides: t.defaultLeadGuides ?? 1,
      });
    } catch (e) {
      alert(errText(e));
      onClose();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [templateId]);

  async function reloadTpl() {
    const t = await api.openTours.get(templateId);
    setTpl(t);
  }

  async function saveScalars() {
    setSaving(true);
    try {
      await api.openTours.update(templateId, {
        nameHe: scalars.nameHe,
        locationId: scalars.locationId || null,
        meetingPoint: scalars.meetingPoint,
        tourLanguage: scalars.tourLanguage,
        durationHoursOverride: scalars.durationHoursOverride === '' ? null : Number(scalars.durationHoursOverride),
        capacity: scalars.capacity === '' ? null : Number(scalars.capacity),
        registrationCloseMinutes:
          scalars.registrationCloseMinutes === '' ? null : Number(scalars.registrationCloseMinutes),
        defaultLeadGuides: Number(scalars.defaultLeadGuides),
      });
      await reloadTpl();
    } catch (e) {
      alert(errText(e));
    } finally {
      setSaving(false);
    }
  }

  // Offered products: selection derived from tpl.products; a checkbox toggles a
  // card, a radio marks the base (isDefault). Persisted via replace-sync.
  const selectedVariantIds = new Set((tpl?.products || []).map((p) => p.productVariantId));
  const defaultVariantId = (tpl?.products || []).find((p) => p.isDefault)?.productVariantId || null;

  async function saveProducts(nextSelected, nextDefault) {
    const rows = cards
      .filter((c) => nextSelected.has(c.productVariantId))
      .map((c, i) => ({
        productVariantId: c.productVariantId,
        priceRuleId: c.priceRuleId || null,
        cardGroupId: c.cardGroupId || null,
        isDefault: c.productVariantId === nextDefault,
        sortOrder: i,
      }));
    try {
      await api.openTours.setProducts(templateId, rows);
      await reloadTpl();
    } catch (e) {
      alert(errText(e));
    }
  }

  function toggleCard(card) {
    const next = new Set(selectedVariantIds);
    let nextDefault = defaultVariantId;
    if (next.has(card.productVariantId)) {
      next.delete(card.productVariantId);
      if (nextDefault === card.productVariantId) nextDefault = [...next][0] || null;
    } else {
      next.add(card.productVariantId);
      if (!nextDefault) nextDefault = card.productVariantId;
    }
    saveProducts(next, nextDefault);
  }

  async function addRule() {
    try {
      await api.openTours.createRule(templateId, {
        weekday: ruleDraft.weekday,
        startTime: ruleDraft.startTime,
        validFrom: ruleDraft.validFrom || null,
        validUntil: ruleDraft.validUntil || null,
        season: ruleDraft.season || null,
      });
      setRuleDraft(EMPTY_RULE);
      await reloadTpl();
    } catch (e) {
      alert(errText(e));
    }
  }

  async function removeRule(ruleId) {
    try {
      await api.openTours.removeRule(ruleId);
      await reloadTpl();
    } catch (e) {
      alert(errText(e));
    }
  }

  async function addException() {
    try {
      await api.openTours.createException(templateId, {
        date: excDraft.date,
        type: excDraft.type,
        time: excDraft.type === 'cancel' ? null : excDraft.time,
      });
      setExcDraft(EMPTY_EXC);
      await reloadTpl();
    } catch (e) {
      alert(errText(e));
    }
  }

  async function removeException(exceptionId) {
    try {
      await api.openTours.removeException(exceptionId);
      await reloadTpl();
    } catch (e) {
      alert(errText(e));
    }
  }

  return (
    <Dialog open onClose={onClose} title="עריכת תבנית סיור פתוח" size="2xl">
      {loading || !scalars ? (
        <div className="py-10 text-center text-sm text-gray-400">טוען…</div>
      ) : (
        <div className="space-y-6">
          {/* Scalars */}
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-gray-700">פרטי התבנית</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 block">
                <span className={FIELD_LABEL}>שם</span>
                <input value={scalars.nameHe} onChange={(e) => setScalars((s) => ({ ...s, nameHe: e.target.value }))} className={INPUT} />
              </label>
              <label className="block">
                <span className={FIELD_LABEL}>עיר / מיקום</span>
                <select value={scalars.locationId} onChange={(e) => setScalars((s) => ({ ...s, locationId: e.target.value }))} className={INPUT + ' bg-white'}>
                  <option value="">— ללא —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.nameHe}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={FIELD_LABEL}>שפה</span>
                <select value={scalars.tourLanguage} onChange={(e) => setScalars((s) => ({ ...s, tourLanguage: e.target.value }))} className={INPUT + ' bg-white'}>
                  {TOUR_LANGS.map((l) => (
                    <option key={l.key} value={l.key}>{l.label}</option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 block">
                <span className={FIELD_LABEL}>נקודת מפגש</span>
                <input value={scalars.meetingPoint} onChange={(e) => setScalars((s) => ({ ...s, meetingPoint: e.target.value }))} placeholder="למשל: כיכר דיזנגוף, ליד המזרקה" className={INPUT} />
              </label>
              <label className="block">
                <span className={FIELD_LABEL}>משך קבוע (שעות)</span>
                <input type="number" min="0" step="0.5" value={scalars.durationHoursOverride} onChange={(e) => setScalars((s) => ({ ...s, durationHoursOverride: e.target.value }))} placeholder="נגזר מהמוצר" className={INPUT} />
              </label>
              <label className="block">
                <span className={FIELD_LABEL}>קיבולת</span>
                <input type="number" min="1" value={scalars.capacity} onChange={(e) => setScalars((s) => ({ ...s, capacity: e.target.value }))} placeholder="ברירת מחדל" className={INPUT} />
              </label>
              <label className="block">
                <span className={FIELD_LABEL}>סגירת הרשמה (דק' לפני)</span>
                <input type="number" min="0" value={scalars.registrationCloseMinutes} onChange={(e) => setScalars((s) => ({ ...s, registrationCloseMinutes: e.target.value }))} placeholder="ללא" className={INPUT} />
              </label>
              <label className="block">
                <span className={FIELD_LABEL}>מדריכים ראשיים</span>
                <input type="number" min="0" max="20" value={scalars.defaultLeadGuides} onChange={(e) => setScalars((s) => ({ ...s, defaultLeadGuides: e.target.value }))} className={INPUT} />
              </label>
            </div>
            <div className="mt-2.5 flex justify-end">
              <button type="button" disabled={saving} onClick={saveScalars} className={PRIMARY}>
                {saving ? 'שומר…' : 'שמירת פרטים'}
              </button>
            </div>
          </section>

          {/* Products */}
          <section className="border-t border-gray-100 pt-5">
            <h3 className="mb-1 text-[13px] font-semibold text-gray-700">מוצרים למכירה</h3>
            <p className="mb-2 text-[12px] text-gray-500">
              בחרו אילו כרטיסים (Pricing Cards שסומנו למכירת כרטיסים) נמכרים בסיור זה. סמנו כרטיס אחד
              כ״בסיס״ — הוא המוצר התפעולי כשאין הרשמות.
            </p>
            {cards.length === 0 ? (
              <p className="text-[12.5px] text-amber-600">אין כרטיסים זמינים — סמנו כרטיס תמחור כ״זמין למכירת כרטיסים״ במסך התמחור.</p>
            ) : (
              <div className="space-y-1.5">
                {cards.map((c) => {
                  const on = selectedVariantIds.has(c.productVariantId);
                  return (
                    <div key={c.cardGroupId || c.productVariantId} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
                      <input type="checkbox" checked={on} onChange={() => toggleCard(c)} className="h-4 w-4" />
                      <span className="flex-1 text-[13.5px] text-gray-800">{c.title}</span>
                      <label className={'flex items-center gap-1 text-[12px] ' + (on ? 'text-gray-600' : 'text-gray-300')}>
                        <input
                          type="radio"
                          name="baseProduct"
                          disabled={!on}
                          checked={defaultVariantId === c.productVariantId}
                          onChange={() => saveProducts(selectedVariantIds, c.productVariantId)}
                        />
                        בסיס
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Schedule rules */}
          <section className="border-t border-gray-100 pt-5">
            <h3 className="mb-2 text-[13px] font-semibold text-gray-700">כללי תזמון שבועיים</h3>
            <div className="mb-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
              {(tpl.scheduleRules || []).length === 0 ? (
                <p className="px-3 py-3 text-center text-[12.5px] text-gray-400">אין כללים עדיין.</p>
              ) : (
                tpl.scheduleRules.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                    <span className="flex-1 text-gray-800">
                      כל יום {WEEKDAY_LABELS[r.weekday]} · <span dir="ltr" className="tabular-nums">{r.startTime}</span>
                      {(r.validFrom || r.validUntil) && (
                        <span className="text-gray-400">
                          {' '}({r.validFrom || '…'} → {r.validUntil || '…'})
                        </span>
                      )}
                      {r.season && <span className="text-gray-400"> · {r.season}</span>}
                    </span>
                    <button type="button" onClick={() => removeRule(r.id)} className="h-7 w-7 rounded text-gray-400 hover:bg-red-50 hover:text-red-600">🗑</button>
                  </div>
                ))
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <select value={ruleDraft.weekday} onChange={(e) => setRuleDraft((d) => ({ ...d, weekday: Number(e.target.value) }))} className={INPUT + ' bg-white'}>
                {WEEKDAY_LABELS.map((label, i) => (
                  <option key={i} value={i}>יום {label}</option>
                ))}
              </select>
              <TimeField value={ruleDraft.startTime} onChange={(v) => setRuleDraft((d) => ({ ...d, startTime: v }))} clearable={false} />
              <input value={ruleDraft.season} onChange={(e) => setRuleDraft((d) => ({ ...d, season: e.target.value }))} placeholder="עונה (רשות)" className={INPUT} />
              <DateField value={ruleDraft.validFrom} onChange={(v) => setRuleDraft((d) => ({ ...d, validFrom: v }))} placeholder="בתוקף מ־" />
              <DateField value={ruleDraft.validUntil} onChange={(v) => setRuleDraft((d) => ({ ...d, validUntil: v }))} placeholder="בתוקף עד" />
              <button type="button" onClick={addRule} className={PRIMARY}>+ כלל</button>
            </div>
          </section>

          {/* Exceptions */}
          <section className="border-t border-gray-100 pt-5">
            <h3 className="mb-2 text-[13px] font-semibold text-gray-700">חריגים חד-פעמיים</h3>
            <div className="mb-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
              {(tpl.exceptions || []).length === 0 ? (
                <p className="px-3 py-3 text-center text-[12.5px] text-gray-400">אין חריגים.</p>
              ) : (
                tpl.exceptions.map((x) => (
                  <div key={x.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                    <span className="flex-1 text-gray-800">
                      {EXCEPTION_TYPE_LABELS[x.type] || x.type} · {fmtTourDate(x.date)}
                      {x.time && <span dir="ltr" className="tabular-nums text-gray-500"> · {x.time}</span>}
                    </span>
                    <button type="button" onClick={() => removeException(x.id)} className="h-7 w-7 rounded text-gray-400 hover:bg-red-50 hover:text-red-600">🗑</button>
                  </div>
                ))
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <select value={excDraft.type} onChange={(e) => setExcDraft((d) => ({ ...d, type: e.target.value }))} className={INPUT + ' bg-white'}>
                {Object.entries(EXCEPTION_TYPE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
              <DateField value={excDraft.date} onChange={(v) => setExcDraft((d) => ({ ...d, date: v }))} placeholder="תאריך" />
              {excDraft.type !== 'cancel' && (
                <TimeField value={excDraft.time} onChange={(v) => setExcDraft((d) => ({ ...d, time: v }))} clearable={false} />
              )}
              <button type="button" disabled={!excDraft.date} onClick={addException} className={PRIMARY}>+ חריג</button>
            </div>
          </section>
        </div>
      )}
    </Dialog>
  );
}

// ── WooCommerce product mapping (sellable card → Woo Variable Product) ────────
// Minimal management surface: for every sellable Pricing Card, the Woo product
// id it maps to. GOS holds the mapping; the sync worker mirrors each concrete
// TourEvent occurrence to a variation of that product. Nothing here is hardcoded.
function WooMappingsSection() {
  const [cards, setCards] = useState([]);
  // cardGroupId → { wooProductId, active, configText }
  const [byCard, setByCard] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingCard, setSavingCard] = useState(null);
  const [structure, setStructure] = useState({}); // cardGroupId → discovery result
  const [inspecting, setInspecting] = useState(null);
  const [building, setBuilding] = useState(null);
  const [gate, setGate] = useState(null); // { configured, writeEnabled, bulkEnabled }
  const [candidates, setCandidates] = useState({}); // cardGroupId → slot list
  const [loadingCand, setLoadingCand] = useState(null);
  const [syncingTour, setSyncingTour] = useState(null);

  async function load() {
    try {
      const [sellable, mappings, g] = await Promise.all([
        api.openTours.sellableProducts().catch(() => ({ cards: [] })),
        api.openTours.wooMappings().catch(() => []),
        api.openTours.wooGate().catch(() => null),
      ]);
      setCards(sellable.cards || []);
      setGate(g);
      const map = {};
      for (const m of mappings) {
        map[m.cardGroupId] = {
          wooProductId: String(m.wooProductId),
          active: m.active,
          configText: m.config ? JSON.stringify(m.config, null, 2) : '',
        };
      }
      setByCard(map);
    } finally {
      setLoading(false);
    }
  }

  async function loadCandidates(card) {
    setLoadingCand(card.cardGroupId);
    try {
      const { candidates: list } = await api.openTours.wooCandidates(card.cardGroupId, 20);
      setCandidates((m) => ({ ...m, [card.cardGroupId]: list || [] }));
    } catch (e) {
      alert(errText(e));
    } finally {
      setLoadingCand(null);
    }
  }

  async function syncOne(card, tourEventId) {
    setSyncingTour(tourEventId);
    try {
      await api.openTours.wooSyncOne(tourEventId);
      await loadCandidates(card); // refresh status
    } catch (e) {
      alert(errText(e));
    } finally {
      setSyncingTour(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function parseConfig(configText) {
    const t = (configText || '').trim();
    if (!t) return { config: null };
    try {
      const config = JSON.parse(t);
      return { config };
    } catch {
      return { error: 'config_json_invalid' };
    }
  }

  async function save(card) {
    const st = byCard[card.cardGroupId] || {};
    if (!st.wooProductId) return;
    const { config, error } = parseConfig(st.configText);
    if (error) return alert('JSON לא תקין בהגדרות התאימות (config).');
    setSavingCard(card.cardGroupId);
    try {
      const body = { wooProductId: Number(st.wooProductId), active: st.active !== false, config };
      try {
        await api.openTours.setWooMapping(card.cardGroupId, body);
      } catch (e) {
        // Phase-7 safety: moving an active mapping with live variations needs a
        // confirm; the server surfaces how many future occurrences will move.
        if (e.status === 409 && e.payload?.error === 'mapping_move_requires_confirm') {
          const ok = window.confirm(
            `שינוי המיפוי יעביר ${e.payload.moved} מועדים עתידיים ממוצר ${e.payload.fromProductId} למוצר ${st.wooProductId}. ` +
              `הווריאציות במוצר הישן יושבתו (לא יימחקו). להמשיך?`,
          );
          if (!ok) return;
          await api.openTours.setWooMapping(card.cardGroupId, { ...body, confirmMove: true });
        } else {
          throw e;
        }
      }
      await load();
    } catch (e) {
      alert(errText(e));
    } finally {
      setSavingCard(null);
    }
  }

  async function clear(card) {
    setSavingCard(card.cardGroupId);
    try {
      await api.openTours.removeWooMapping(card.cardGroupId);
      await load();
    } catch (e) {
      alert(errText(e));
    } finally {
      setSavingCard(null);
    }
  }

  async function inspect(card) {
    const st = byCard[card.cardGroupId] || {};
    if (!st.wooProductId) return alert('הזינו מזהה מוצר Woo לבדיקה.');
    setInspecting(card.cardGroupId);
    try {
      const s = await api.openTours.wooProductStructure(Number(st.wooProductId));
      setStructure((m) => ({ ...m, [card.cardGroupId]: s }));
    } catch (e) {
      alert(errText(e));
    } finally {
      setInspecting(null);
    }
  }

  // Auto-build the complete config (real ticketTypeIds + exact store encoding) and
  // drop it into the editor — no placeholders, ready to save.
  async function buildConfig(card) {
    const st = byCard[card.cardGroupId] || {};
    if (!st.wooProductId) return alert('הזינו מזהה מוצר Woo תחילה.');
    setBuilding(card.cardGroupId);
    try {
      const r = await api.openTours.wooSuggestConfig(card.cardGroupId, Number(st.wooProductId));
      const configText = JSON.stringify(r.config, null, 2);
      setByCard((m) => ({ ...m, [card.cardGroupId]: { ...(m[card.cardGroupId] || st), configText } }));
      if (r.warnings?.length) {
        alert('ההגדרה נבנתה, אך שימו לב:\n• ' + r.warnings.join('\n• '));
      }
    } catch (e) {
      alert(errText(e));
    } finally {
      setBuilding(null);
    }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-2xl shadow-sm mb-6">
      <div className="px-5 pt-4 pb-3 border-b border-gray-100">
        <h2 className="text-[15px] font-semibold text-gray-900">WooCommerce — מיפוי מוצרים</h2>
        <p className="text-[12.5px] text-gray-500 mt-0.5">
          לכל כרטיס תמחור שנמכר, מזהה המוצר (Variable Product) באתר. כרטיס = ערך פעילות אחד (pa_פעילות)
          בתוך מוצר עירוני, וכל סוג כרטיס (מבוגר/ילד) הופך לווריאציית גיל (pa_גיל) במחירו הקנוני. GOS
          הוא מקור האמת — הסנכרון בפועל פועל רק כשמוגדרים פרטי החיבור <span dir="ltr">WOOCOMMERCE_*</span>{' '}
          וגם דגל ההפעלה <span dir="ltr">WOO_SYNC_ENABLED</span>.
        </p>
        {gate && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            <GateChip on={gate.configured} label="חיבור מוגדר" />
            <GateChip on={gate.writeEnabled} label="כתיבה מאופשרת (WOO_SYNC_ENABLED)" />
            <GateChip on={gate.bulkEnabled} label="סנכרון מלא (WOO_SYNC_BULK_ENABLED)" warnOff={false} />
          </div>
        )}
      </div>
      {loading ? (
        <div className="px-5 py-6 text-center text-sm text-gray-400">טוען…</div>
      ) : cards.length === 0 ? (
        <p className="px-5 py-6 text-center text-[13px] text-gray-400">
          אין כרטיסים זמינים למכירת כרטיסים — סמנו כרטיס תמחור כ״זמין למכירת כרטיסים״ במסך התמחור.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {cards.map((c) => {
            const st = byCard[c.cardGroupId] || { wooProductId: '', active: true, configText: '' };
            const mapped = byCard[c.cardGroupId] != null;
            const s = structure[c.cardGroupId];
            return (
              <div key={c.cardGroupId} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1 text-[13.5px] font-medium text-gray-800">{c.title}</span>
                  <label className="flex items-center gap-1.5 text-[12px] text-gray-600">
                    מזהה מוצר Woo
                    <input
                      type="number"
                      min="1"
                      value={st.wooProductId}
                      onChange={(e) =>
                        setByCard((m) => ({ ...m, [c.cardGroupId]: { ...st, wooProductId: e.target.value } }))
                      }
                      className={INPUT + ' w-28'}
                      dir="ltr"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={inspecting === c.cardGroupId || !st.wooProductId}
                    onClick={() => inspect(c)}
                    className="h-8 rounded-md px-2 text-[13px] font-medium text-gray-600 hover:bg-gray-100"
                    title="קריאה בלבד — מבנה המוצר החי (תכונות ומונחים)"
                  >
                    {inspecting === c.cardGroupId ? 'בודק…' : 'בדיקת מבנה'}
                  </button>
                  <button
                    type="button"
                    disabled={building === c.cardGroupId || !st.wooProductId}
                    onClick={() => buildConfig(c)}
                    className="h-8 rounded-md px-2 text-[13px] font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                    title="בונה אוטומטית את הגדרות התאימות עם מזהי סוגי הכרטיסים האמיתיים"
                  >
                    {building === c.cardGroupId ? 'בונה…' : 'בנה הגדרה'}
                  </button>
                  <button
                    type="button"
                    disabled={savingCard === c.cardGroupId || !st.wooProductId}
                    onClick={() => save(c)}
                    className={PRIMARY}
                  >
                    {savingCard === c.cardGroupId ? 'שומר…' : mapped ? 'עדכון' : 'שמירה'}
                  </button>
                  {mapped && (
                    <button
                      type="button"
                      onClick={() => clear(c)}
                      className="h-8 rounded-md px-2 text-[13px] text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      ניתוק
                    </button>
                  )}
                </div>

                {/* Compatibility config (per-product attribute identities + ticket→age map) */}
                <details className="mt-2">
                  <summary className="cursor-pointer text-[12px] text-gray-500 hover:text-gray-700">
                    הגדרות תאימות (config JSON)
                  </summary>
                  <textarea
                    value={st.configText}
                    onChange={(e) =>
                      setByCard((m) => ({ ...m, [c.cardGroupId]: { ...st, configText: e.target.value } }))
                    }
                    placeholder='{"taxonomyMode":"global","date":{"attrId":1},"time":{"attrId":2},"activity":{"attrId":3,"option":"סיור-בלבד"},"age":{"attrId":5},"ticketAge":{"<ticketTypeId>":{"option":"מבוגר"}}}'
                    dir="ltr"
                    rows={6}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                  {/* This card's ticket types — the ids for the ticketAge map. */}
                  {(c.rows || []).length > 0 && (
                    <div className="mt-1 text-[11px] text-gray-500" dir="ltr">
                      ticket types:{' '}
                      {c.rows.map((r) => `${r.label}=${r.ticketTypeId} (₪${(r.unitPriceMinor / 100).toFixed(0)})`).join('  |  ')}
                    </div>
                  )}
                </details>

                {s && (
                  <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600" dir="ltr">
                    <div className="font-semibold text-gray-700">
                      #{s.productId} · {s.type} · {s.status} — {s.name}
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {s.attributes.map((a) => (
                        <li key={a.id || a.name}>
                          <span className="font-medium">{a.name}</span> · id={a.id ?? '—'} · {a.taxonomy}
                          {a.variation ? ' · variation' : ''} ·{' '}
                          {(a.terms.length ? a.terms.map((t) => `${t.name}→${t.slug}`) : a.options)
                            .slice(0, 8)
                            .join('  |  ')}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Controlled sync + status: nearest future occurrences of this card */}
                {mapped && (
                  <details className="mt-2" onToggle={(e) => e.currentTarget.open && !candidates[c.cardGroupId] && loadCandidates(c)}>
                    <summary className="cursor-pointer text-[12px] text-gray-500 hover:text-gray-700">
                      מועדים קרובים וסטטוס סנכרון
                    </summary>
                    {loadingCand === c.cardGroupId ? (
                      <div className="mt-1 text-[12px] text-gray-400">טוען…</div>
                    ) : (candidates[c.cardGroupId] || []).length === 0 ? (
                      <div className="mt-1 text-[12px] text-gray-400">אין מועדים עתידיים.</div>
                    ) : (
                      <div className="mt-1 divide-y divide-gray-100 rounded-lg border border-gray-200">
                        {candidates[c.cardGroupId].map((t) => (
                          <div key={t.id} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-[12px]">
                            <span className="tabular-nums text-gray-700" dir="ltr">
                              {fmtTourDate(t.date)} {t.startTime}
                            </span>
                            <span className="text-gray-400">
                              {t.status} · {t.remaining == null ? '∞' : t.remaining}/{t.capacity ?? '—'} מקומות
                            </span>
                            <SyncStatusChip status={t.wooSyncStatus} error={t.wooSyncError} />
                            {(t.wooVariationLinks || []).length > 0 && (
                              <span className="text-gray-400" dir="ltr" title="variation ids">
                                {t.wooVariationLinks.map((l) => `${l.variantKey.slice(0, 6)}→${l.wooVariationId ?? '—'}`).join(' ')}
                              </span>
                            )}
                            <button
                              type="button"
                              disabled={syncingTour === t.id}
                              onClick={() => syncOne(c, t.id)}
                              className="ms-auto h-7 rounded-md px-2 text-[12px] font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                              title="סימון סנכרון מבוקר של מועד זה בלבד"
                            >
                              {syncingTour === t.id ? 'מסמן…' : 'סנכרן מועד זה'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function GateChip({ on, label }) {
  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ' +
        (on ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500')
      }
    >
      <span className={'h-1.5 w-1.5 rounded-full ' + (on ? 'bg-green-500' : 'bg-gray-400')} />
      {label}
    </span>
  );
}

const SYNC_CHIP = {
  synced: 'bg-green-50 text-green-700',
  pending: 'bg-amber-50 text-amber-700',
  failed: 'bg-red-50 text-red-700',
  skipped: 'bg-gray-100 text-gray-500',
};
const SYNC_LABEL = { synced: 'מסונכרן', pending: 'ממתין', failed: 'נכשל', skipped: 'לא נמכר' };
function SyncStatusChip({ status, error }) {
  if (!status) return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-400">—</span>;
  return (
    <span className={'rounded-full px-2 py-0.5 font-medium ' + (SYNC_CHIP[status] || 'bg-gray-100 text-gray-500')} title={error || ''}>
      {SYNC_LABEL[status] || status}
    </span>
  );
}
