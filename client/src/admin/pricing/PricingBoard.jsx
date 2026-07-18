import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import SettingsChrome from '../settings/SettingsChrome.jsx';
import RichEditor from '../../editor/RichEditor.jsx';
import Dialog from '../common/Dialog.jsx';
import PricingSimulatorDialog from './PricingSimulatorDialog.jsx';
import { formatMinor, toMinor, minorToInput } from '../../lib/money.js';

// Business-facing Pricing editor (Slice C) — THE pricing screen:
//   version (PriceList) → tab (PricingSegment) → card → model → values → VAT.
// A tab opens straight onto its cards. (The old "הגדרות מתקדמות" engine screen
// was retired; the Pricing Simulator popup replaced its calculator.)
//
// A "card" is sibling PriceRules sharing a `cardGroupId`, one per chosen location
// (ProductVariant), with identical model + values + VAT. The tab's stored
// activity/subtype binding is copied onto the card's rules on save; the business
// editor never asks about it. The engine is untouched.

// Width-free base so fixed-width fields can size themselves; INPUT keeps w-full
// for the default full-width inputs. (Appending w-20 to a class that already has
// w-full does NOT work — Tailwind emits .w-full last, so it wins.)
const INPUT_BASE =
  'h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';
const INPUT = `${INPUT_BASE} w-full`;
const LABEL = 'block text-[12px] font-medium text-gray-600 mb-1';

// Friendly model labels — priceModel enum names are never shown.
const MODELS = [
  { value: 'tiered_group', name: 'מדרגות מחיר + משתתף נוסף' },
  { value: 'per_head', name: 'מחיר לאדם' },
  { value: 'fixed', name: 'מחיר קבוע' },
  { value: 'ticket_types', name: 'מחיר כרטיס' },
];
const modelName = (m) => MODELS.find((x) => x.value === m)?.name || m;

// Business VAT choices → engine vatMode.
const VAT_OPTS = [
  { value: 'included', name: 'כולל מע״מ' },
  { value: 'excluded', name: 'לפני מע״מ' },
  { value: 'exempt', name: 'פטור ממע״מ' },
];
const DEFAULT_VAT_RATE = 18;

// Add-on VAT. '' (→ null on save) = inherit from the Add-on catalog, which may
// itself be "כמו כרטיס התמחור" (then the card's VAT applies).
const ADDON_VAT_OPTS = [{ value: '', name: 'כמו הקטלוג' }, ...VAT_OPTS];
const AUTO_APPLY_OPTS = [
  { value: 'manual', name: 'ידני' },
  { value: 'weekdays', name: 'לפי ימים בשבוע' },
  { value: 'sabbath_holiday', name: 'שבת וחג' },
];
// 0=Sun … 6=Sat (matches JS getDay and the server).
const WEEKDAYS = [
  { value: 0, name: 'א׳' }, { value: 1, name: 'ב׳' }, { value: 2, name: 'ג׳' },
  { value: 3, name: 'ד׳' }, { value: 4, name: 'ה׳' }, { value: 5, name: 'ו׳' }, { value: 6, name: 'שבת' },
];
const weekdayName = (n) => WEEKDAYS.find((w) => w.value === Number(n))?.name || n;
function addonNameMap(addons) {
  const m = {};
  (addons || []).forEach((a) => { m[a.id] = a.nameHe; });
  return m;
}

function newCardGroupId() {
  const rnd =
    (globalThis.crypto && globalThis.crypto.randomUUID && globalThis.crypto.randomUUID()) ||
    `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `card_${rnd}`;
}

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400 mt-0.5">{hint}</span>}
    </label>
  );
}

function Select({ value, onChange, options, className = '' }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={`${INPUT} ${className}`}>
      {options.map((o) => (
        <option key={String(o.value)} value={o.value}>{o.name}</option>
      ))}
    </select>
  );
}

function Money({ minor, onChange, placeholder }) {
  return (
    <input
      dir="ltr"
      inputMode="decimal"
      value={minorToInput(minor)}
      onChange={(e) => onChange(toMinor(e.target.value))}
      placeholder={placeholder || '0'}
      className={`${INPUT} text-left`}
    />
  );
}

// ─────────────────────────────── Root ──────────────────────────────────────

export default function PricingBoard() {
  const [lists, setLists] = useState([]);
  const [segments, setSegments] = useState([]);
  const [products, setProducts] = useState([]);
  const [ticketTypes, setTicketTypes] = useState([]);
  const [addons, setAddons] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [orgTypes, setOrgTypes] = useState([]);
  const [orgSubtypes, setOrgSubtypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Pricing Simulator popup — rendered only while open so every open starts clean.
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  // Canonical settings popups for the two formerly-hidden configurations:
  // version settings (name/VAT defaults/live default) and tab bindings.
  const [versionSettingsOpen, setVersionSettingsOpen] = useState(false);
  const [tabSettingsOpen, setTabSettingsOpen] = useState(false);

  const [versionId, setVersionId] = useState(null);
  const [segmentId, setSegmentId] = useState(null);

  const loadLists = useCallback(async () => {
    const l = await api.priceLists.list();
    setLists(l);
    setVersionId((cur) => {
      if (cur && l.some((x) => x.id === cur)) return cur;
      const active = l.filter((x) => x.active);
      const def = active.find((x) => x.isDefault) || active[0] || l[0];
      return def?.id || null;
    });
  }, []);

  const refreshAll = useCallback(async () => {
    setError(null);
    try {
      const [seg, p, tt, ad, at, ot, os] = await Promise.all([
        api.pricingSegments.list(),
        api.products.list(),
        api.ticketTypes.list(),
        api.addons.list(),
        api.activityTypes.list(),
        api.organizationTypes.list(),
        api.organizationSubtypes.list(),
        loadLists(),
      ]);
      setSegments(seg);
      setProducts(p);
      setTicketTypes(tt);
      setAddons(ad);
      setActivityTypes(at);
      setOrgTypes(ot);
      setOrgSubtypes(os);
      setSegmentId((cur) => cur || seg[0]?.id || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [loadLists]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  const version = lists.find((l) => l.id === versionId) || null;
  const segment = segments.find((s) => s.id === segmentId) || null;

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-4xl mx-auto space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <SettingsChrome />
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">תמחור</h1>
          <p className="text-[15px] text-gray-500 mt-1.5">
            נהלו מחירים למוצרים. בחרו גרסה, עברו בין הלשוניות, והוסיפו כרטיסי תמחור.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSimulatorOpen(true)}
          className="shrink-0 mt-1 h-10 inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-4 text-sm font-medium text-blue-700 hover:bg-blue-100"
        >
          🧮 סימולטור תמחור
        </button>
      </header>

      {error && <div className="text-sm text-red-600">שגיאה: {error}</div>}

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">טוען…</div>
      ) : (
        <>
          <VersionBar
            lists={lists}
            versionId={versionId}
            onSelect={setVersionId}
            onChanged={loadLists}
            onSettings={() => setVersionSettingsOpen(true)}
          />

          {version ? (
            <>
              <TabBar
                segments={segments}
                segmentId={segmentId}
                onSelect={setSegmentId}
                onSettings={() => setTabSettingsOpen(true)}
              />
              {segment && (
                <SegmentPanel
                  key={`${version.id}:${segment.id}`}
                  version={version}
                  segment={segment}
                  products={products}
                  ticketTypes={ticketTypes}
                  addons={addons}
                  orgTypes={orgTypes}
                  orgSubtypes={orgSubtypes}
                />
              )}
            </>
          ) : (
            <div className="text-sm text-gray-500">אין גרסאות תמחור פעילות. צרו גרסה חדשה למעלה.</div>
          )}
        </>
      )}

      {simulatorOpen && <PricingSimulatorDialog open onClose={() => setSimulatorOpen(false)} />}

      {versionSettingsOpen && version && (
        <VersionSettingsDialog
          list={version}
          onClose={() => setVersionSettingsOpen(false)}
          onChanged={async () => {
            await loadLists();
          }}
          onDeleted={async () => {
            setVersionSettingsOpen(false);
            setVersionId(null);
            await loadLists();
          }}
        />
      )}
      {tabSettingsOpen && segment && (
        <SegmentBindingDialog
          segment={segment}
          activityTypes={activityTypes}
          orgSubtypes={orgSubtypes}
          onClose={() => setTabSettingsOpen(false)}
          onSaved={async () => {
            setTabSettingsOpen(false);
            setSegments(await api.pricingSegments.list());
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────── Version selector (light bar) ──────────────────────

function VersionBar({ lists, versionId, onSelect, onChanged, onSettings }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const active = lists.filter((l) => l.active);

  async function create(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const created = await api.priceLists.create({ nameHe: name.trim() });
      setName(''); setAdding(false);
      await onChanged();
      if (created?.id) onSelect(created.id);
    } catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] font-medium text-gray-500 ms-1">גרסת תמחור:</span>
      {active.length === 0 && <span className="text-[13px] text-gray-400">אין גרסאות פעילות.</span>}
      {active.map((l) => (
        <button key={l.id} onClick={() => onSelect(l.id)}
          className={`h-9 rounded-full px-4 text-[13px] font-medium transition ${
            versionId === l.id
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'
          }`}>
          {l.nameHe}{l.isDefault && <span className="ms-1.5 text-[10px] opacity-80">★</span>}
        </button>
      ))}
      {adding ? (
        <form onSubmit={create} className="flex items-center gap-1.5">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); }}
            placeholder="שם גרסה" className="h-9 w-36 rounded-full border border-gray-300 px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <button type="submit" disabled={busy || !name.trim()}
            className="h-9 rounded-full bg-blue-600 px-3 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? '…' : 'צור'}</button>
          <button type="button" onClick={() => setAdding(false)} className="h-9 rounded-full px-2 text-[13px] text-gray-400 hover:text-gray-600">ביטול</button>
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="h-9 rounded-full border border-dashed border-gray-300 px-3 text-[13px] text-gray-500 hover:bg-gray-50">+ גרסה</button>
      )}
      {versionId && (
        <button
          type="button"
          onClick={onSettings}
          title="הגדרות הגרסה — שם, מע״מ ברירת מחדל, גרסה פעילה"
          className="h-9 w-9 inline-flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-50"
        >
          ⚙
        </button>
      )}
    </div>
  );
}

// ───────────────────────── Version settings dialog ─────────────────────────
// Canonical home for the per-version configuration that used to hide in the
// retired הגדרות מתקדמות screen: name, VAT defaults, live-default flag, and a
// guarded delete. The VAT default's only pricing role is builder lines set to
// "inherit" — pricing cards always carry explicit VAT.

const LIST_VAT_OPTS = [
  { value: 'included', name: 'כולל מע״מ' },
  { value: 'excluded', name: 'לפני מע״מ' },
];

function VersionSettingsDialog({ list, onClose, onChanged, onDeleted }) {
  const [nameHe, setNameHe] = useState(list.nameHe || '');
  const [vatMode, setVatMode] = useState(list.defaultVatMode || 'included');
  const [vatRate, setVatRate] = useState(list.defaultVatRate ?? DEFAULT_VAT_RATE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const ruleCount = list._count?.rules ?? 0;

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.priceLists.update(list.id, {
        nameHe,
        defaultVatMode: vatMode,
        defaultVatRate: Number(vatRate) || 0,
      });
      await onChanged();
      onClose();
    } catch (e) {
      setErr(e.payload?.error || e.message);
    } finally {
      setBusy(false);
    }
  }
  async function makeDefault() {
    setBusy(true);
    setErr(null);
    try {
      await api.priceLists.setDefault(list.id);
      await onChanged();
      onClose();
    } catch (e) {
      setErr(e.payload?.error || e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm(`למחוק את הגרסה "${list.nameHe}"?`)) return;
    setBusy(true);
    setErr(null);
    try {
      await api.priceLists.remove(list.id);
      await onDeleted();
    } catch (e) {
      setErr(e.payload?.error === 'has_rules' ? 'לא ניתן למחוק גרסה שיש בה כרטיסי תמחור.' : e.payload?.error || e.message);
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`הגדרות גרסה — ${list.nameHe}`}
      footer={
        <>
          <button type="button" onClick={onClose} className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-2 hover:bg-gray-50">ביטול</button>
          <button type="button" onClick={save} disabled={busy || !nameHe.trim()} className="bg-blue-600 text-white text-sm font-semibold rounded-md px-6 py-2 hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'שומר…' : 'שמירה'}
          </button>
        </>
      }
    >
      <div className="space-y-4 px-1 py-1">
        {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">שגיאה: {err}</div>}
        <Field label="שם הגרסה">
          <input value={nameHe} onChange={(e) => setNameHe(e.target.value)} className={INPUT} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="מע״מ ברירת מחדל"><Select value={vatMode} onChange={setVatMode} options={LIST_VAT_OPTS} /></Field>
          <Field label="שיעור מע״מ %">
            <input dir="ltr" inputMode="numeric" value={vatRate}
              onChange={(e) => setVatRate(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))}
              className={`${INPUT} text-left`} />
          </Field>
        </div>
        <p className="text-[12px] text-gray-400 leading-relaxed">
          מע״מ ברירת המחדל חל רק על שורות בבונה המחיר שלא נקבע להן מע״מ מפורש. כרטיסי תמחור תמיד קובעים מע״מ במפורש בכרטיס עצמו.
        </p>

        <div className="border-t border-gray-100 pt-3 space-y-2">
          {list.isDefault ? (
            <p className="text-[13px] text-emerald-700">★ זו הגרסה הפעילה — המנוע מתמחר לפיה.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={makeDefault} disabled={busy} className="text-[13px] font-medium text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-1.5 hover:bg-emerald-100 disabled:opacity-50">
                ★ קבע כגרסה הפעילה
              </button>
              <button type="button" onClick={remove} disabled={busy || ruleCount > 0}
                title={ruleCount > 0 ? 'לא ניתן למחוק גרסה שיש בה כרטיסים' : 'מחיקת הגרסה'}
                className="text-[13px] text-red-600 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50 disabled:opacity-40">
                מחק גרסה
              </button>
            </div>
          )}
          {!list.isDefault && (
            <p className="text-[12px] text-gray-400">קביעת גרסה כפעילה מחליפה את הגרסה הפעילה הנוכחית באופן מיידי לכל התמחור במערכת.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

// ───────────────────────── Tab binding dialog ───────────────────────────────
// Canonical home for the tab→scope binding: the activity type / org subtype a
// tab stamps onto every card saved under it (this IS engine matching scope).
// Saving propagates the new scope to the tab's EXISTING cards too, so old and
// new cards always resolve consistently.

function SegmentBindingDialog({ segment, activityTypes, orgSubtypes, onClose, onSaved }) {
  const [activityTypeId, setActivityTypeId] = useState(segment.activityType?.id || '');
  const [organizationSubtypeId, setOrganizationSubtypeId] = useState(segment.organizationSubtype?.id || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.pricingSegments.update(segment.id, { activityTypeId, organizationSubtypeId });
      await onSaved();
    } catch (e) {
      setErr(e.payload?.error || e.message);
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`שיוך לשונית — ${segment.nameHe}`}
      footer={
        <>
          <button type="button" onClick={onClose} className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-2 hover:bg-gray-50">ביטול</button>
          <button type="button" onClick={save} disabled={busy} className="bg-blue-600 text-white text-sm font-semibold rounded-md px-6 py-2 hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'שומר…' : 'שמירה'}
          </button>
        </>
      }
    >
      <div className="space-y-4 px-1 py-1">
        {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">שגיאה: {err}</div>}
        <Field label="סוג פעילות">
          <Select value={activityTypeId} onChange={setActivityTypeId}
            options={[{ value: '', name: '— ללא שיוך (כל הפעילויות) —' }, ...activityTypes.map((a) => ({ value: a.id, name: a.nameHe }))]} />
        </Field>
        <Field label="תת-סוג ארגון">
          <Select value={organizationSubtypeId} onChange={setOrganizationSubtypeId}
            options={[{ value: '', name: '— ללא שיוך —' }, ...orgSubtypes.map((s) => ({ value: s.id, name: s.label }))]} />
        </Field>
        <p className="text-[12px] text-gray-400 leading-relaxed">
          השיוך קובע את טווח ההתאמה של כרטיסי הלשונית במנוע התמחור (איזה כרטיס מנצח לאיזה דיל).
          שינוי כאן מעדכן אוטומטית גם את כל הכרטיסים הקיימים בלשונית, כדי שכרטיס ישן לעולם לא יתומחר אחרת מכרטיס חדש.
        </p>
      </div>
    </Dialog>
  );
}

// ─────────────────────────────── Tab bar ───────────────────────────────────

function TabBar({ segments, segmentId, onSelect, onSettings }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-200">
      {segments.map((s) => (
        <button key={s.id} onClick={() => onSelect(s.id)}
          className={`h-10 rounded-t-lg px-4 text-sm font-medium transition -mb-px border-b-2 ${
            segmentId === s.id
              ? 'text-blue-700 border-blue-600'
              : 'text-gray-500 border-transparent hover:text-gray-800'
          }`}>
          {s.nameHe}
        </button>
      ))}
      {segmentId && (
        <button
          type="button"
          onClick={onSettings}
          title="שיוך הלשונית — סוג פעילות ותת-סוג ארגון לכרטיסי הלשונית"
          className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 -mb-px"
        >
          ⚙
        </button>
      )}
    </div>
  );
}

// ───────────────────────────── Segment panel ───────────────────────────────

function SegmentPanel({ version, segment, products, ticketTypes, addons, orgTypes, orgSubtypes }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [productCache, setProductCache] = useState({});
  const [adding, setAdding] = useState(false);
  const [editingCardId, setEditingCardId] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const all = await api.priceRules.list(version.id);
      setRules(all.filter((r) => r.pricingSegmentId === segment.id && r.cardGroupId));
    } finally {
      setLoading(false);
    }
  }, [version.id, segment.id]);
  useEffect(() => { refresh(); }, [refresh]);

  const cards = useMemo(() => groupCards(rules), [rules]);

  // Prefetch product details (variants → location names) for products in cards.
  useEffect(() => {
    const ids = [...new Set(cards.map((c) => c.productId).filter(Boolean))];
    const missing = ids.filter((id) => !productCache[id]);
    if (!missing.length) return;
    let alive = true;
    Promise.all(missing.map((id) => api.products.get(id).catch(() => null))).then((loaded) => {
      if (!alive) return;
      setProductCache((prev) => {
        const next = { ...prev };
        loaded.forEach((p) => { if (p) next[p.id] = p; });
        return next;
      });
    });
    return () => { alive = false; };
  }, [cards, productCache]);

  // Reorder a card within this tab: swap with its neighbour, persist the whole
  // tab's order (only these cardGroupIds), then refresh. Other tabs untouched.
  async function moveCard(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= cards.length) return;
    const ids = cards.map((c) => c.cardGroupId);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try { await api.priceRules.cardOrder(ids); await refresh(); }
    catch (e) { alert('שגיאה בעדכון הסדר: ' + (e.payload?.error || e.message)); }
  }
  const nextSortOrder = cards.length ? Math.max(...cards.map((c) => c.cardSortOrder)) + 1 : 0;

  if (products.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
        עדיין אין מוצרים. הוסיפו מוצרים במסך המוצרים כדי לתמחר אותם.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">טוען כרטיסים…</div>
      ) : (
        <>
          {cards.length === 0 && !adding && (
            <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
              אין עדיין כרטיסי תמחור בלשונית "{segment.nameHe}".
            </div>
          )}

          {cards.map((card, index) =>
            editingCardId === card.cardGroupId ? (
              <CardEditor key={card.cardGroupId} version={version} segment={segment}
                products={products} ticketTypes={ticketTypes} addons={addons} orgTypes={orgTypes} orgSubtypes={orgSubtypes}
                productCache={productCache} setProductCache={setProductCache}
                card={card} onClose={() => setEditingCardId(null)}
                onSaved={() => { setEditingCardId(null); refresh(); }} />
            ) : (
              <CardView key={card.cardGroupId} version={version} card={card}
                productCache={productCache} ticketTypes={ticketTypes} addons={addons}
                isFirst={index === 0} isLast={index === cards.length - 1}
                onMoveUp={() => moveCard(index, -1)} onMoveDown={() => moveCard(index, 1)}
                onEdit={() => setEditingCardId(card.cardGroupId)}
                onChanged={refresh} />
            ),
          )}

          {adding ? (
            <CardEditor version={version} segment={segment}
              products={products} ticketTypes={ticketTypes} addons={addons} orgTypes={orgTypes} orgSubtypes={orgSubtypes}
              productCache={productCache} setProductCache={setProductCache}
              nextSortOrder={nextSortOrder}
              onClose={() => setAdding(false)}
              onSaved={() => { setAdding(false); refresh(); }} />
          ) : (
            <button onClick={() => setAdding(true)}
              className="h-12 w-full rounded-xl bg-blue-600 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">
              ＋ כרטיס תמחור
            </button>
          )}
        </>
      )}
    </div>
  );
}

function groupCards(rules) {
  const byGroup = new Map();
  for (const r of rules) {
    if (!byGroup.has(r.cardGroupId)) byGroup.set(r.cardGroupId, []);
    byGroup.get(r.cardGroupId).push(r);
  }
  const cards = [];
  for (const [cardGroupId, siblings] of byGroup) {
    const rep = siblings[0];
    cards.push({
      cardGroupId,
      cardSortOrder: rep.cardSortOrder ?? 0,
      createdAt: rep.createdAt,
      productId: rep.productId,
      priceModel: rep.priceModel,
      adultPriceMinor: rep.adultPriceMinor ?? null,
      childPriceMinor: rep.childPriceMinor ?? null,
      fixedPriceMinor: rep.fixedPriceMinor ?? null,
      perAdditionalParticipantMinor: rep.perAdditionalParticipantMinor ?? null,
      vatMode: rep.vatMode || 'included',
      vatRate: rep.vatRate ?? DEFAULT_VAT_RATE,
      availableForGroupTickets: rep.availableForGroupTickets === true,
      // Rich-text note the calculation writes onto the FIRST builder line this
      // card produces. Duplicated across siblings — the representative's value is
      // the card's value.
      firstLineNote: rep.firstLineNote || '',
      // Default-selection org association (card-level, duplicated across siblings).
      defaultOrgTypeIds: Array.isArray(rep.defaultOrgTypeIds) ? rep.defaultOrgTypeIds : [],
      defaultOrgSubtypeIds: Array.isArray(rep.defaultOrgSubtypeIds) ? rep.defaultOrgSubtypeIds : [],
      tiers: (rep.tiers || []).map((t) => ({
        uptoParticipants: Number(t.uptoParticipants),
        totalPriceMinor: Number(t.totalPriceMinor),
      })),
      ticketPrices: (rep.ticketPrices || []).map((p) => ({
        ticketTypeId: p.ticketTypeId,
        priceMinor: Number(p.priceMinor),
      })),
      addons: (rep.addons || []).map((a) => ({
        addonId: a.addonId,
        enabled: a.enabled !== false,
        priceMinor: a.priceMinor == null ? null : Number(a.priceMinor), // null = inherit
        vatMode: a.vatMode || '', // '' = inherit card
        vatRate: a.vatRate ?? null,
        autoApply: a.autoApply || 'manual',
        autoApplyWeekdays: Array.isArray(a.autoApplyWeekdays) ? a.autoApplyWeekdays.map(Number) : [],
      })),
      variantIds: siblings.map((s) => s.productVariantId).filter(Boolean),
      rules: siblings.map((s) => ({ id: s.id, productVariantId: s.productVariantId })),
    });
  }
  // Display order: business cardSortOrder, then creation time as a stable
  // tiebreak (new cards append, equal-order legacy cards keep insertion order).
  cards.sort(
    (a, b) =>
      (a.cardSortOrder - b.cardSortOrder) ||
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
  );
  return cards;
}

// ──────────────────────────────── Card view ────────────────────────────────

function CardView({ version, card, productCache, ticketTypes, addons, isFirst, isLast, onMoveUp, onMoveDown, onEdit, onChanged }) {
  const product = productCache[card.productId];
  const productName = product?.nameHe || '—';
  const variantNames = card.variantIds.map((vid) => {
    const v = product?.variants?.find((x) => x.id === vid);
    return v?.location?.nameHe || '—';
  });

  async function duplicate() {
    try {
      const rules = await api.priceRules.list(version.id);
      const src = rules.find((r) => r.id === card.rules[0]?.id);
      if (!src) return;
      const cardGroupId = newCardGroupId();
      for (const vid of card.variantIds) {
        await api.priceRules.create({
          priceListId: version.id,
          pricingSegmentId: src.pricingSegmentId,
          productId: src.productId,
          productVariantId: vid,
          activityTypeId: src.activityTypeId,
          organizationSubtypeId: src.organizationSubtypeId,
          cardGroupId,
          cardSortOrder: card.cardSortOrder, // land next to the source (createdAt tiebreak)
          priceModel: card.priceModel,
          adultPriceMinor: card.adultPriceMinor,
          childPriceMinor: card.childPriceMinor,
          perAdditionalParticipantMinor: card.perAdditionalParticipantMinor,
          fixedPriceMinor: card.fixedPriceMinor,
          tiers: card.tiers,
          ticketPrices: card.ticketPrices,
          addons: card.addons,
          vatMode: card.vatMode,
          vatRate: card.vatRate,
          availableForGroupTickets: card.availableForGroupTickets === true,
          active: true,
        });
      }
      onChanged();
    } catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
  }

  async function remove() {
    if (!confirm('למחוק את כרטיס התמחור?')) return;
    try {
      for (const r of card.rules) await api.priceRules.remove(r.id);
      onChanged();
    } catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
  }

  return (
    <div className="rounded-xl bg-white ring-1 ring-gray-200 shadow-sm p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[16px] font-semibold text-gray-900">{productName}</div>
          <div className="text-[12px] text-gray-500 mt-0.5">
            {variantNames.length ? variantNames.join(' · ') : 'ללא מיקומים'}
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            <span className="text-[11px] rounded-full bg-indigo-50 text-indigo-700 px-2.5 py-0.5 ring-1 ring-indigo-100">{modelName(card.priceModel)}</span>
            <span className="text-[11px] rounded-full bg-gray-100 text-gray-600 px-2.5 py-0.5">{vatLabel(card.vatMode, card.vatRate)}</span>
            {card.availableForGroupTickets && (
              <span className="text-[11px] rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 ring-1 ring-emerald-100" title="זמין בכרטיסים לסיור קבוצתי">🎟️ כרטיסים קבוצתיים</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="flex flex-col -my-1 me-1">
            <button onClick={onMoveUp} disabled={isFirst} title="העבר למעלה"
              className="text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:hover:text-gray-400 leading-none px-1">▲</button>
            <button onClick={onMoveDown} disabled={isLast} title="העבר למטה"
              className="text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:hover:text-gray-400 leading-none px-1">▼</button>
          </div>
          <button onClick={onEdit} title="עריכה" className="text-amber-500 hover:bg-amber-50 rounded-md p-1.5">✎</button>
          <button onClick={duplicate} title="שכפול" className="text-gray-500 hover:bg-gray-100 rounded-md p-1.5">⧉</button>
          <button onClick={remove} title="מחיקה" className="text-red-500 hover:bg-red-50 rounded-md p-1.5">🗑</button>
        </div>
      </div>

      <CardNumbers card={card} ticketTypes={ticketTypes} />
      <CardAddonsSummary card={card} addons={addons} />
      <CardPreview version={version} card={card} ticketTypes={ticketTypes} addons={addons} />
    </div>
  );
}

// Compact read-only summary of the card's add-ons. The שבת/חג system surcharge is
// shown separately (inherited unless overridden); ordinary add-ons follow.
function CardAddonsSummary({ card, addons }) {
  const names = addonNameMap(addons);
  const systemAddon = (addons || []).find((a) => a.systemKey === 'sabbath_holiday');
  const sysOverride = systemAddon ? (card.addons || []).find((a) => a.addonId === systemAddon.id) : null;
  const regular = (card.addons || []).filter((a) => !systemAddon || a.addonId !== systemAddon.id);
  if (!regular.length && !systemAddon) return null;

  let sysText = null;
  if (systemAddon) {
    if (sysOverride && sysOverride.enabled === false) sysText = 'כבוי בכרטיס זה';
    else {
      const overridden = !!sysOverride && (sysOverride.priceMinor != null || sysOverride.vatMode);
      const price = sysOverride && sysOverride.priceMinor != null ? sysOverride.priceMinor : systemAddon.defaultPriceMinor;
      sysText = `${formatMinor(price)} · ${overridden ? 'מותאם' : 'יורש'}`;
    }
  }

  return (
    <div className="text-[12px] text-gray-600 flex flex-wrap gap-x-3 gap-y-0.5">
      <span className="text-gray-400">תוספות:</span>
      {systemAddon && (
        <span className={sysOverride?.enabled === false ? 'text-gray-400' : ''}>
          🕯️ שבת/חג: <b>{sysText}</b>
        </span>
      )}
      {regular.map((a) => {
        const auto = a.autoApply === 'sabbath_holiday'
          ? ' (שבת/חג)'
          : a.autoApply === 'weekdays' && a.autoApplyWeekdays.length
          ? ` (${a.autoApplyWeekdays.map(weekdayName).join('/')})`
          : '';
        return (
          <span key={a.addonId} className={a.enabled === false ? 'line-through text-gray-300' : ''}>
            {names[a.addonId] || 'תוספת'}: <b>{formatMinor(a.priceMinor)}</b>{auto}
          </span>
        );
      })}
    </div>
  );
}

function ticketNameMap(ticketTypes) {
  const m = {};
  (ticketTypes || []).forEach((t) => { m[t.id] = t.nameHe; });
  return m;
}

function vatLabel(mode, rate) {
  if (mode == null || mode === '') return 'כמו כרטיס התמחור';
  if (mode === 'exempt') return 'פטור ממע״מ';
  if (mode === 'excluded') return `לפני מע״מ ${rate}%`;
  return `כולל מע״מ ${rate}%`;
}

function CardNumbers({ card, ticketTypes }) {
  if (card.priceModel === 'fixed') {
    return <div className="text-[13px] text-gray-700">מחיר קבוע כולל: <b>{formatMinor(card.fixedPriceMinor)}</b></div>;
  }
  if (card.priceModel === 'per_head') {
    return <div className="text-[13px] text-gray-700">מחיר למשתתף: <b>{formatMinor(card.adultPriceMinor)}</b></div>;
  }
  if (card.priceModel === 'ticket_types') {
    const names = ticketNameMap(ticketTypes);
    return (
      <div className="text-[13px] text-gray-700 flex flex-wrap gap-x-3 gap-y-0.5">
        {card.ticketPrices.map((p) => (
          <span key={p.ticketTypeId}>{names[p.ticketTypeId] || 'כרטיס'}: <b>{formatMinor(p.priceMinor)}</b></span>
        ))}
      </div>
    );
  }
  const sorted = [...card.tiers].sort((a, b) => a.uptoParticipants - b.uptoParticipants);
  return (
    <div className="text-[13px] text-gray-700 space-y-0.5">
      {sorted.map((t, i) => (
        <div key={i}>עד {t.uptoParticipants} משתתפים = <b>{formatMinor(t.totalPriceMinor)}</b></div>
      ))}
      {sorted.length > 0 && card.perAdditionalParticipantMinor != null && (
        <div>כל משתתף נוסף מעל {sorted[sorted.length - 1].uptoParticipants} = <b>{formatMinor(card.perAdditionalParticipantMinor)}</b></div>
      )}
    </div>
  );
}

// ─────────────────────── Per-card quote-style preview ──────────────────────

function CardPreview({ version, card, ticketTypes, addons }) {
  const isTicket = card.priceModel === 'ticket_types';
  const [count, setCount] = useState(10);
  const [groupCount, setGroupCount] = useState(1);
  const [quantities, setQuantities] = useState(() => {
    const m = {};
    (card.ticketPrices || []).forEach((p) => { m[p.ticketTypeId] = 1; });
    return m;
  });
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('16:00');
  const [manualOn, setManualOn] = useState({}); // addonId -> bool
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const cardAddons = card.addons || [];
  const manualAddons = cardAddons.filter((a) => a.enabled !== false && a.autoApply === 'manual');
  const manualAddonIds = manualAddons.filter((a) => manualOn[a.addonId]).map((a) => a.addonId);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      const base = {
        priceModel: card.priceModel, vatMode: card.vatMode, vatRate: card.vatRate,
        addons: cardAddons,
        date, time, // server derives weekday + runs the שעות שבת וחג detector
        manualAddonIds,
      };
      const payload = isTicket
        ? { ...base, ticketPrices: card.ticketPrices, ticketQuantities: quantities }
        : {
            ...base,
            adultPriceMinor: card.adultPriceMinor,
            childPriceMinor: card.childPriceMinor,
            perAdditionalParticipantMinor: card.perAdditionalParticipantMinor,
            fixedPriceMinor: card.fixedPriceMinor,
            tiers: card.tiers,
            participantCount: Number(count) || 0,
            adultCount: Number(count) || 0,
            childCount: 0,
            groupCount: Number(groupCount) || 1,
          };
      setRes(await api.pricing.preview(payload));
    } catch (e) { setRes({ ok: false, error: e.message }); }
    finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, isTicket, count, groupCount, quantities, date, time, JSON.stringify(manualAddonIds)]);

  useEffect(() => { run(); }, [run]);

  const cur = version.currency;
  const names = ticketNameMap(ticketTypes);
  const hasWeekdayAddon = cardAddons.some((a) => a.enabled !== false && a.autoApply === 'weekdays');
  // The שבת/חג surcharge applies to every card (the route injects it from the
  // catalog), so show the date/time + window note whenever it's globally active —
  // even on cards with no per-card override row.
  const hasSystemSurcharge = (addons || []).some((a) => a.systemKey === 'sabbath_holiday' && a.active);
  const showWindow = cardAddons.some((a) => a.enabled !== false && a.autoApply === 'sabbath_holiday') || hasSystemSurcharge;
  const needsDate = hasWeekdayAddon || showWindow;
  return (
    <div className="rounded-lg bg-gray-50 ring-1 ring-gray-100 p-3">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <span className="text-[12px] font-medium text-gray-500">הצעת מחיר</span>
        {isTicket ? (
          (card.ticketPrices || []).map((p) => (
            <label key={p.ticketTypeId} className="flex items-center gap-1 text-[12px] text-gray-600">
              {names[p.ticketTypeId] || 'כרטיס'}
              <input dir="ltr" value={quantities[p.ticketTypeId] ?? ''}
                onChange={(e) => setQuantities((q) => ({ ...q, [p.ticketTypeId]: e.target.value.replace(/\D/g, '') }))}
                className="h-8 w-14 rounded border border-gray-300 px-2 text-center text-sm" />
            </label>
          ))
        ) : (
          <>
            <label className="flex items-center gap-1 text-[12px] text-gray-600">
              משתתפים
              <input dir="ltr" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))}
                className="h-8 w-16 rounded border border-gray-300 px-2 text-center text-sm" />
            </label>
            <label className="flex items-center gap-1 text-[12px] text-gray-600">
              קבוצות
              <input dir="ltr" value={groupCount} onChange={(e) => setGroupCount(e.target.value.replace(/\D/g, ''))}
                className="h-8 w-14 rounded border border-gray-300 px-2 text-center text-sm" />
            </label>
          </>
        )}
        {busy && <span className="text-[11px] text-gray-400">מחשב…</span>}
      </div>

      {(needsDate || manualAddons.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 mb-2 text-[12px] text-gray-600">
          <span className="text-gray-400">תוספות:</span>
          {needsDate && (
            <label className="flex items-center gap-1">
              תאריך
              <input dir="ltr" type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="h-8 rounded border border-gray-300 px-2 text-sm" />
            </label>
          )}
          {showWindow && (
            <label className="flex items-center gap-1">
              שעה
              <input dir="ltr" type="time" value={time} onChange={(e) => setTime(e.target.value)}
                className="h-8 rounded border border-gray-300 px-2 text-sm" />
            </label>
          )}
          {manualAddons.map((a) => (
            <label key={a.addonId} className="flex items-center gap-1">
              <input type="checkbox" checked={!!manualOn[a.addonId]}
                onChange={(e) => setManualOn((m) => ({ ...m, [a.addonId]: e.target.checked }))} />
              {addonNameMap(addons)[a.addonId] || 'תוספת'}
            </label>
          ))}
        </div>
      )}

      {showWindow && res?.ok && (
        <div className={`mb-2 text-[12px] rounded-md px-2.5 py-1.5 ${
          res.sabbathHoliday?.applies ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-500'
        }`}>
          {res.sabbathHoliday?.applies
            ? `🕯️ ${res.sabbathHoliday.label || 'שבת/חג'} — תוספת שבת/חג חלה`
            : 'התאריך/שעה שנבחרו אינם שבת/חג — תוספת שבת/חג לא חלה'}
        </div>
      )}

      {res && res.ok ? (
        <QuoteLines res={res} card={card} count={Number(count) || 0} groupCount={Number(groupCount) || 1}
          currency={cur} ticketTypes={ticketTypes} addons={addons} />
      ) : res ? (
        <div className="text-[12px] text-red-600">{previewError(res.error)}</div>
      ) : null}
    </div>
  );
}

// Render the preview as a quote: line items, VAT, total — adapting to VAT mode.
// All amounts come from the engine response (no re-derivation of pricing).
function QuoteLines({ res, card, count, groupCount, currency, ticketTypes, addons }) {
  const f = (m) => formatMinor(m, currency);
  const d = res.debug || {};
  const g = groupCount || 1;
  const lines = [];
  const addonLines = res.addonLines || [];
  const hasAddons = addonLines.length > 0;
  const addonNames = addonNameMap(addons);
  const addonVatHint = (m) => (m === 'exempt' ? 'פטור' : m === 'excluded' ? 'לפני מע״מ' : 'כולל מע״מ');

  if (card.priceModel === 'fixed') {
    lines.push({ label: g > 1 ? `מחיר קבוע × ${g}` : 'מחיר קבוע', value: res.baseAmountMinor });
  } else if (card.priceModel === 'per_head') {
    const unit = Number(card.adultPriceMinor || 0);
    lines.push({ label: `${count} משתתפים × ${f(unit)}`, value: res.baseAmountMinor });
  } else if (card.priceModel === 'ticket_types') {
    const names = ticketNameMap(ticketTypes);
    (d.lines || []).forEach((ln) => {
      lines.push({
        label: `${names[ln.ticketTypeId] || 'כרטיס'}: ${ln.quantity} × ${f(ln.priceMinor)}`,
        value: ln.lineMinor,
      });
    });
  } else {
    // tiered_group: base tier line + (optional) additional-participants line.
    const tierTotal = Number(d.tierTotalMinor || 0) * g;
    const additional = Number(res.baseAmountMinor) - tierTotal;
    lines.push({ label: `מחיר בסיס (עד ${d.tierUpto} משתתפים)${g > 1 ? ` × ${g}` : ''}`, value: tierTotal });
    if (d.extraParticipants > 0) {
      lines.push({ label: `${d.extraParticipants} משתתפים נוספים`, value: additional });
    }
  }

  const isExempt = res.vatMode === 'exempt';
  const isAdded = res.vatMode === 'excluded';

  return (
    <div className="rounded-md bg-white p-3 shadow-sm space-y-1.5 text-[13px]">
      {lines.map((ln, i) => (
        <Row key={i} label={ln.label} value={f(ln.value)} />
      ))}
      {isExempt ? (
        <Row label="מע״מ" value="פטור" muted />
      ) : isAdded ? (
        <Row label={`מע״מ ${res.vatRate}%`} value={`+ ${f(res.vatMinor)}`} muted />
      ) : (
        <Row label={`כולל מע״מ ${res.vatRate}%`} value={f(res.vatMinor)} muted />
      )}

      {hasAddons && (
        <>
          <div className="border-t border-gray-100 pt-1.5">
            <Row label="סה״כ ביניים" value={f(res.grossMinor)} />
          </div>
          {addonLines.map((ln) => (
            <Row key={ln.addonId}
              label={`${addonNames[ln.addonId] || 'תוספת'} (${addonVatHint(ln.vatMode)})`}
              value={f(ln.grossMinor)} />
          ))}
        </>
      )}

      <div className="border-t border-gray-100 pt-1.5">
        <Row label="סה״כ לתשלום" value={f(hasAddons ? res.totalGrossMinor : res.grossMinor)} strong />
      </div>
    </div>
  );
}

function Row({ label, value, muted, strong }) {
  return (
    <div className={`flex items-center justify-between ${muted ? 'text-gray-400' : strong ? 'text-gray-900' : 'text-gray-700'}`}>
      <span className={strong ? 'font-semibold' : ''}>{label}</span>
      <span dir="ltr" className={strong ? 'font-bold text-[15px]' : ''}>{value}</span>
    </div>
  );
}

function previewError(code) {
  return {
    rule_incomplete: 'חסרים שדות מחיר — מלאו את הערכים כדי לראות הצעת מחיר.',
    unknown_price_model: 'מודל תמחור לא מוכר.',
  }[code] || ('שגיאה: ' + code);
}

// ────────────────────────────── Card editor ────────────────────────────────

function CardEditor({ version, segment, products, ticketTypes, addons, orgTypes = [], orgSubtypes = [], productCache, setProductCache, card, nextSortOrder = 0, onClose, onSaved }) {
  const [productId, setProductId] = useState(card?.productId || '');
  const [variantIds, setVariantIds] = useState(card?.variantIds || []);
  const [priceModel, setPriceModel] = useState(card?.priceModel || 'tiered_group');
  const [adultPriceMinor, setAdult] = useState(card?.adultPriceMinor ?? null);
  const [fixedPriceMinor, setFixed] = useState(card?.fixedPriceMinor ?? null);
  const [perAdd, setPerAdd] = useState(card?.perAdditionalParticipantMinor ?? null);
  const [tiers, setTiers] = useState(
    card?.tiers?.length ? card.tiers.map((t) => ({ ...t })) : [{ uptoParticipants: null, totalPriceMinor: null }],
  );
  // ticket_types: priceMinor per ticketTypeId. Show active types + any already
  // priced on this card (so an inactive-but-priced type stays editable).
  const [ticketPrices, setTicketPrices] = useState(() => {
    const m = {};
    (card?.ticketPrices || []).forEach((p) => { m[p.ticketTypeId] = Number(p.priceMinor); });
    return m;
  });
  const editorTicketTypes = useMemo(() => {
    const priced = new Set((card?.ticketPrices || []).map((p) => p.ticketTypeId));
    return (ticketTypes || []).filter((t) => t.active || priced.has(t.id));
  }, [ticketTypes, card]);
  const setTicketPrice = (id, v) => setTicketPrices((m) => ({ ...m, [id]: v }));

  // The שבת/חג system surcharge is handled by its own dedicated row, NOT the
  // generic add-ons list. Split it out and exclude it everywhere below.
  const systemAddon = (addons || []).find((a) => a.systemKey === 'sabbath_holiday') || null;
  const sysRow = systemAddon ? (card?.addons || []).find((a) => a.addonId === systemAddon.id) : null;
  const [sabbath, setSabbath] = useState(() => ({
    enabled: sysRow ? sysRow.enabled !== false : true,
    priceMinor: sysRow ? (sysRow.priceMinor ?? null) : null, // null = inherit catalog
    vatMode: sysRow ? (sysRow.vatMode || '') : '',           // '' = inherit catalog
    vatRate: sysRow ? (sysRow.vatRate ?? null) : null,
  }));
  const sabbathOverridden = sabbath.enabled === false || sabbath.priceMinor != null || sabbath.vatMode !== '';
  const resetSabbath = () => setSabbath({ enabled: true, priceMinor: null, vatMode: '', vatRate: null });

  // Add-ons configured on this card (model-independent). Catalog = `addons`.
  const [addonEntries, setAddonEntries] = useState(() =>
    (card?.addons || [])
      .filter((a) => !systemAddon || a.addonId !== systemAddon.id)
      .map((a) => ({ ...a, autoApplyWeekdays: [...(a.autoApplyWeekdays || [])] })),
  );
  const usedAddonIds = new Set(addonEntries.map((e) => e.addonId));
  const availableAddons = (addons || []).filter((a) => a.active && !a.systemKey && !usedAddonIds.has(a.id));
  function addAddon(addonId) {
    const cat = (addons || []).find((a) => a.id === addonId);
    setAddonEntries((cur) => [...cur, {
      addonId,
      enabled: true,
      priceMinor: cat?.defaultPriceMinor != null ? Number(cat.defaultPriceMinor) : null,
      vatMode: '', // inherit from card
      vatRate: null,
      autoApply: 'manual',
      autoApplyWeekdays: [],
    }]);
  }
  const removeAddon = (addonId) => setAddonEntries((cur) => cur.filter((e) => e.addonId !== addonId));
  const setAddonField = (addonId, key, val) =>
    setAddonEntries((cur) => cur.map((e) => (e.addonId === addonId ? { ...e, [key]: val } : e)));
  const toggleAddonWeekday = (addonId, wd) =>
    setAddonEntries((cur) => cur.map((e) => {
      if (e.addonId !== addonId) return e;
      const has = e.autoApplyWeekdays.includes(wd);
      return { ...e, autoApplyWeekdays: has ? e.autoApplyWeekdays.filter((x) => x !== wd) : [...e.autoApplyWeekdays, wd] };
    }));
  const [vatMode, setVatMode] = useState(card?.vatMode || version.defaultVatMode || 'included');
  const [vatRate, setVatRate] = useState(card?.vatRate ?? version.defaultVatRate ?? DEFAULT_VAT_RATE);
  // Business capability — offer this card in the Group Ticket Builder. Default OFF.
  const [availableForGroupTickets, setAvailGroup] = useState(card?.availableForGroupTickets === true);
  // First-line note template — written by automatic calculation onto the first
  // builder line this card produces. Rich text (same format as line notes) so the
  // builder displays exactly what is authored here. Empty = no automatic note.
  const [firstLineNote, setFirstLineNote] = useState(card?.firstLineNote || '');
  // Default-selection association (many-to-many): the org types/subtypes this
  // card is the automatic default for. Empty = neutral card. Preference only —
  // every card stays manually selectable on any Deal.
  const [defaultOrgTypeIds, setDefaultOrgTypeIds] = useState(card?.defaultOrgTypeIds || []);
  const [defaultOrgSubtypeIds, setDefaultOrgSubtypeIds] = useState(card?.defaultOrgSubtypeIds || []);
  const toggleIn = (setter) => (id) =>
    setter((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const product = productCache[productId];

  useEffect(() => {
    if (!productId || productCache[productId]) return;
    let alive = true;
    api.products.get(productId).then((p) => {
      if (alive && p) setProductCache((prev) => ({ ...prev, [p.id]: p }));
    }).catch(() => {});
    return () => { alive = false; };
  }, [productId, productCache, setProductCache]);

  const variants = product?.variants || [];

  // Convenience: if the chosen product has exactly one location, auto-select it
  // so the owner isn't forced to click the only option. Deps are (product, count
  // of variants) — NOT variantIds — so this fires once when a product's variants
  // load, but never re-adds a location the owner just toggled off, and never
  // overrides a saved card's existing selection (guarded by cur.length === 0).
  useEffect(() => {
    if (variants.length === 1) {
      setVariantIds((cur) => (cur.length === 0 ? [variants[0].id] : cur));
    }
  }, [productId, variants.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleVariant = (id) =>
    setVariantIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const setTier = (i, key, val) => setTiers((cur) => cur.map((t, idx) => (idx === i ? { ...t, [key]: val } : t)));
  const addTier = () => setTiers((cur) => [...cur, { uptoParticipants: null, totalPriceMinor: null }]);
  const removeTier = (i) => setTiers((cur) => cur.filter((_, idx) => idx !== i));

  function validate() {
    if (!productId) return 'בחרו מוצר.';
    if (variantIds.length === 0) return 'בחרו לפחות מיקום אחד.';
    if (priceModel === 'fixed' && fixedPriceMinor == null) return 'מלאו מחיר קבוע.';
    if (priceModel === 'per_head' && adultPriceMinor == null) return 'מלאו מחיר למשתתף.';
    if (priceModel === 'tiered_group') {
      const valid = tiers.filter((t) => t.uptoParticipants != null && t.totalPriceMinor != null);
      if (valid.length === 0) return 'הוסיפו לפחות מדרגת מחיר אחת.';
    }
    if (priceModel === 'ticket_types') {
      const any = Object.values(ticketPrices).some((v) => v != null);
      if (!any) return 'הזינו מחיר לפחות לסוג כרטיס אחד.';
    }
    return null;
  }

  // All non-model fields nulled so a model switch never leaks stale values into
  // resolution. `tiers: []` / `ticketPrices: []` explicitly clear those join sets.
  function modelPayload() {
    const empty = { adultPriceMinor: null, childPriceMinor: null, fixedPriceMinor: null, basePriceMinor: null, baseParticipants: null, perAdditionalParticipantMinor: null, tiers: [], ticketPrices: [] };
    if (priceModel === 'fixed') {
      return { ...empty, fixedPriceMinor };
    }
    if (priceModel === 'per_head') {
      return { ...empty, adultPriceMinor, childPriceMinor: adultPriceMinor };
    }
    if (priceModel === 'ticket_types') {
      const rows = Object.entries(ticketPrices)
        .filter(([, v]) => v != null)
        .map(([ticketTypeId, priceMinor]) => ({ ticketTypeId, priceMinor }));
      return { ...empty, ticketPrices: rows };
    }
    const cleanTiers = tiers
      .filter((t) => t.uptoParticipants != null && t.totalPriceMinor != null)
      .sort((a, b) => a.uptoParticipants - b.uptoParticipants)
      .map((t, i) => ({ uptoParticipants: t.uptoParticipants, totalPriceMinor: t.totalPriceMinor, sortOrder: i }));
    return { ...empty, perAdditionalParticipantMinor: perAdd, tiers: cleanTiers };
  }

  async function save() {
    const v = validate();
    if (v) { setErr(v); return; }
    setErr(null); setBusy(true);
    try {
      const addonsPayload = addonEntries.map((e) => ({
        addonId: e.addonId,
        enabled: e.enabled !== false,
        priceMinor: e.priceMinor,
        vatMode: e.vatMode || null,
        vatRate: e.vatMode && e.vatMode !== 'exempt' ? (e.vatRate != null ? Number(e.vatRate) : DEFAULT_VAT_RATE) : null,
        autoApply: e.autoApply,
        autoApplyWeekdays: e.autoApply === 'weekdays' ? e.autoApplyWeekdays : [],
      }));
      // Persist a שבת/חג override row ONLY when the card overrides the default;
      // otherwise no row → the card inherits the catalog default at read time.
      if (systemAddon && sabbathOverridden) {
        addonsPayload.push({
          addonId: systemAddon.id,
          enabled: sabbath.enabled !== false,
          priceMinor: sabbath.priceMinor, // null = inherit catalog price
          vatMode: sabbath.vatMode || null, // null = inherit catalog VAT
          vatRate: sabbath.vatMode && sabbath.vatMode !== 'exempt' ? (sabbath.vatRate != null ? Number(sabbath.vatRate) : DEFAULT_VAT_RATE) : null,
          autoApply: 'sabbath_holiday',
          autoApplyWeekdays: [],
        });
      }
      const common = {
        priceListId: version.id,
        pricingSegmentId: segment.id,
        productId,
        activityTypeId: segment.activityTypeId || null,
        organizationSubtypeId: segment.organizationSubtypeId || null,
        priceModel,
        vatMode,
        vatRate: vatMode === 'exempt' ? 0 : (Number(vatRate) || 0),
        active: true,
        availableForGroupTickets,
        // Raw rich text; the server normalizes blank markup to null (= no note).
        firstLineNote,
        defaultOrgTypeIds,
        defaultOrgSubtypeIds,
        addons: addonsPayload,
        ...modelPayload(),
      };

      if (card) {
        const cardGroupId = card.cardGroupId;
        const existingByVariant = new Map(card.rules.map((r) => [r.productVariantId, r.id]));
        for (const vid of variantIds) {
          if (existingByVariant.has(vid)) {
            await api.priceRules.update(existingByVariant.get(vid), { ...common, cardGroupId, productVariantId: vid });
          } else {
            await api.priceRules.create({ ...common, cardGroupId, productVariantId: vid });
          }
        }
        for (const r of card.rules) {
          if (!variantIds.includes(r.productVariantId)) await api.priceRules.remove(r.id);
        }
      } else {
        const cardGroupId = newCardGroupId();
        for (const vid of variantIds) {
          await api.priceRules.create({ ...common, cardGroupId, productVariantId: vid, cardSortOrder: nextSortOrder });
        }
      }
      onSaved();
    } catch (e) { setErr(e.payload?.error || e.message); }
    finally { setBusy(false); }
  }

  // Only products with at least one variant are sellable; never offer an
  // unusable (zero-variant) product — it would dead-end with no location to pick.
  const usableProducts = products.filter((p) => (p._count?.variants ?? 0) > 0);
  const noUsableProducts = usableProducts.length === 0;
  const productOpts = [{ value: '', name: '— בחרו מוצר —' }, ...usableProducts.map((p) => ({ value: p.id, name: p.nameHe }))];

  return (
    <div className="rounded-xl bg-blue-50/40 ring-1 ring-blue-100 p-4 space-y-4">
      {noUsableProducts && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          אין מוצרים מוכנים לתמחור. למוצר חייב להיות לפחות מיקום אחד. הוסיפו מיקום למוצר במסך המוצרים.
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="מוצר">
          <Select value={productId} onChange={(v) => { setProductId(v); setVariantIds([]); }} options={productOpts} />
        </Field>
        <Field label="מודל תמחור">
          <Select value={priceModel} onChange={setPriceModel} options={MODELS} />
        </Field>
      </div>

      {productId && (
        <Field label="מיקומים (בחרו אחד או יותר)">
          {variants.length === 0 ? (
            <div className="text-[12px] text-amber-700">המוצר הזה אינו מוכן לשימוש — אין לו אף מיקום. הוסיפו מיקום במסך המוצרים לפני תמחור.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {variants.map((vrt) => (
                <button type="button" key={vrt.id} onClick={() => toggleVariant(vrt.id)}
                  className={`h-9 rounded-lg px-3 text-[13px] transition ring-1 ${
                    variantIds.includes(vrt.id)
                      ? 'bg-blue-600 text-white ring-blue-600'
                      : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
                  }`}>
                  {vrt.location?.nameHe || vrt.id}
                </button>
              ))}
            </div>
          )}
        </Field>
      )}

      {/* Model-specific pricing fields */}
      {priceModel === 'fixed' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="מחיר קבוע כולל"><Money minor={fixedPriceMinor} onChange={setFixed} /></Field>
        </div>
      )}
      {priceModel === 'per_head' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="מחיר למשתתף"><Money minor={adultPriceMinor} onChange={setAdult} /></Field>
        </div>
      )}
      {priceModel === 'tiered_group' && (
        <div className="space-y-2">
          <span className={LABEL}>מדרגות מחיר (מחיר כולל לקבוצה, לא לאדם)</span>
          {tiers.map((t, i) => (
            <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="text-[13px] text-gray-500 shrink-0">עד</span>
              <input dir="ltr" inputMode="numeric" value={t.uptoParticipants ?? ''}
                onChange={(e) => setTier(i, 'uptoParticipants', e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                placeholder="0" className={`${INPUT_BASE} w-20 text-center`} />
              <span className="text-[13px] text-gray-500 shrink-0">משתתפים</span>
              <span className="text-[13px] text-gray-400 shrink-0">=</span>
              <div className="w-36"><Money minor={t.totalPriceMinor} onChange={(v) => setTier(i, 'totalPriceMinor', v)} placeholder="0" /></div>
              <span className="text-[13px] text-gray-500 shrink-0">₪</span>
              <button type="button" onClick={() => removeTier(i)} className="text-red-500 hover:bg-red-50 rounded-md p-1.5 shrink-0" title="הסר מדרגה">🗑</button>
            </div>
          ))}
          <button type="button" onClick={addTier} className="text-[13px] text-blue-600 hover:underline">+ הוסף מדרגה</button>
          <Field label="כל משתתף נוסף מעל המדרגה האחרונה">
            <div className="flex items-center gap-2">
              <div className="w-36"><Money minor={perAdd} onChange={setPerAdd} placeholder="0" /></div>
              <span className="text-[13px] text-gray-500 shrink-0">₪ לכל משתתף</span>
            </div>
          </Field>
        </div>
      )}

      {priceModel === 'ticket_types' && (
        <div className="space-y-2">
          <span className={LABEL}>מחיר לכל סוג כרטיס</span>
          {editorTicketTypes.length === 0 ? (
            <div className="text-[12px] text-gray-400">אין סוגי כרטיסים פעילים. הוסיפו אותם במסך "סוגי כרטיסים".</div>
          ) : (
            editorTicketTypes.map((tt) => (
              <div key={tt.id} className="flex items-center gap-2">
                <span className="text-[13px] text-gray-700 w-28 shrink-0">
                  {tt.nameHe}{!tt.active && <span className="text-gray-400"> (לא פעיל)</span>}
                </span>
                <div className="w-36"><Money minor={ticketPrices[tt.id] ?? null} onChange={(v) => setTicketPrice(tt.id, v)} placeholder="0" /></div>
                <span className="text-[13px] text-gray-500 shrink-0">₪ לכרטיס</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* VAT — business controlled */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-blue-100 pt-3">
        <Field label="מע״מ"><Select value={vatMode} onChange={setVatMode} options={VAT_OPTS} /></Field>
        {vatMode !== 'exempt' && (
          <Field label="שיעור מע״מ %">
            <input dir="ltr" inputMode="numeric" value={vatRate}
              onChange={(e) => setVatRate(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))}
              className={`${INPUT} text-left`} />
          </Field>
        )}
      </div>

      {/* Default org association — which organization kinds auto-select this
          card. Preference only; manual override always allowed on the Deal. */}
      <div className="border-t border-blue-100 pt-3 space-y-2">
        <span className={LABEL}>ברירת מחדל עבור סוגי ארגון (אפשר כמה)</span>
        <div className="flex flex-wrap gap-1.5">
          {orgTypes.map((t) => (
            <button type="button" key={t.id} onClick={() => toggleIn(setDefaultOrgTypeIds)(t.id)}
              className={`h-8 rounded-lg px-2.5 text-[12.5px] transition ring-1 ${
                defaultOrgTypeIds.includes(t.id)
                  ? 'bg-blue-600 text-white ring-blue-600'
                  : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        {orgSubtypes.length > 0 && (
          <>
            <span className={LABEL}>ברירת מחדל עבור תת-סוגים</span>
            <div className="flex flex-wrap gap-1.5">
              {orgSubtypes.map((s) => (
                <button type="button" key={s.id} onClick={() => toggleIn(setDefaultOrgSubtypeIds)(s.id)}
                  className={`h-8 rounded-lg px-2.5 text-[12.5px] transition ring-1 ${
                    defaultOrgSubtypeIds.includes(s.id)
                      ? 'bg-blue-600 text-white ring-blue-600'
                      : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>
          </>
        )}
        <p className="text-[11px] text-gray-400">
          כשדיל שייך לאחד מסוגי הארגון המסומנים — הכרטיס הזה נבחר אוטומטית. ללא סימון הכרטיס הוא ברירת המחדל הכללית. בכל דיל אפשר תמיד לבחור ידנית כרטיס אחר.
        </p>
      </div>

      {/* First-line note — written automatically onto the first builder line this
          card produces during automatic calculation. */}
      <div className="border-t border-blue-100 pt-3 space-y-1.5">
        <span className={LABEL}>הערה אוטומטית לבונה המחיר</span>
        <RichEditor
          value={firstLineNote}
          onChange={setFirstLineNote}
          preset="note"
          toolbar="lite"
          collapsible
          maxHeight="200px"
          ariaLabel="הערה אוטומטית לשורה הראשונה"
          placeholder="הערה שתיכתב אוטומטית בשורה הראשונה שהכרטיס מייצר…"
        />
        <p className="text-[11px] text-gray-400">
          בחישוב אוטומטי ההערה נכתבת על השורה הראשונה שכרטיס התמחור הזה מייצר בבונה המחיר (בלבד). ריק = ללא הערה אוטומטית.
        </p>
      </div>

      {/* Group Ticket Sales — business capability. The flag alone decides whether
          this card appears in the Group Ticket Builder (no hardcoded filtering). */}
      <div className="border-t border-blue-100 pt-3">
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={availableForGroupTickets}
            onChange={(e) => setAvailGroup(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-200"
          />
          <span className="text-[13px] font-medium text-gray-800">🎟️ זמין למכירת כרטיסים קבוצתית</span>
        </label>
        <p className="text-[11px] text-gray-400 mt-1 ps-7">
          כשהאפשרות פעילה, כרטיס התמחור הזה יופיע אוטומטית בכרטיסים לסיור קבוצתי של הדיל.
        </p>
      </div>

      {/* שבת/חג — system surcharge inherited by every card; override per card */}
      {systemAddon && (
        <div className="border-t border-blue-100 pt-3">
          <div className="rounded-lg bg-amber-50/50 ring-1 ring-amber-100 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-gray-800 flex-1">🕯️ תוספת שבת/חג</span>
              <span className={`text-[11px] rounded-full px-2 py-0.5 ${sabbathOverridden ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                {sabbathOverridden ? 'מותאם בכרטיס הזה' : 'יורש מברירת המחדל'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
              <Field label="מחיר">
                {/* While inheriting (priceMinor==null) show the LIVE catalog default
                    as the field value — not a faint "0" placeholder — but keep it
                    as inheritance (no override row). Typing sets a per-card override;
                    clearing returns to inherit. */}
                <div className="flex items-center gap-1.5">
                  <input dir="ltr" inputMode="decimal"
                    value={sabbath.priceMinor != null ? minorToInput(sabbath.priceMinor) : minorToInput(systemAddon.defaultPriceMinor)}
                    onChange={(e) => setSabbath((s) => ({ ...s, priceMinor: toMinor(e.target.value) }))}
                    className={`${INPUT} text-left`} />
                  <span className="text-[12px] text-gray-500 shrink-0">₪</span>
                  {sabbath.priceMinor == null && (
                    <span className="text-[11px] text-gray-400 shrink-0 whitespace-nowrap">ברירת מחדל</span>
                  )}
                </div>
              </Field>
              <Field label="מע״מ">
                <Select value={sabbath.vatMode} onChange={(v) => setSabbath((s) => ({ ...s, vatMode: v }))}
                  options={[{ value: '', name: `כמו ברירת המחדל (${vatLabel(systemAddon.vatMode, systemAddon.vatRate)})` }, ...VAT_OPTS]} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-gray-700 mb-2">
                <input type="checkbox" checked={sabbath.enabled !== false} onChange={(e) => setSabbath((s) => ({ ...s, enabled: e.target.checked }))} />
                פעיל בכרטיס זה
              </label>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-400 flex-1">מופעל אוטומטית לפי הגדרות שעות שבת וחג. מחיר/מע״מ ריקים יורשים מקטלוג התוספות.</span>
              {sabbathOverridden && (
                <button type="button" onClick={resetSabbath} className="text-[12px] text-blue-600 hover:underline shrink-0">אפס לברירת המחדל</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add-ons — per card; label from catalog, price/VAT/auto-apply here */}
      <div className="border-t border-blue-100 pt-3 space-y-2">
        <span className={LABEL}>תוספות נוספות</span>
        {addonEntries.length === 0 && availableAddons.length === 0 && (
          <div className="text-[12px] text-gray-400">אין תוספות בקטלוג. הוסיפו אותן במסך "תוספות".</div>
        )}
        {addonEntries.map((e) => {
          const cat = (addons || []).find((a) => a.id === e.addonId);
          return (
            <div key={e.addonId} className="rounded-lg bg-white ring-1 ring-gray-200 p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-gray-800 flex-1">{cat?.nameHe || 'תוספת'}</span>
                <label className="flex items-center gap-1 text-[12px] text-gray-500">
                  <input type="checkbox" checked={e.enabled !== false} onChange={(ev) => setAddonField(e.addonId, 'enabled', ev.target.checked)} /> פעיל
                </label>
                <button type="button" onClick={() => removeAddon(e.addonId)} className="text-red-500 hover:bg-red-50 rounded-md p-1.5" title="הסר">🗑</button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Field label="מחיר"><Money minor={e.priceMinor} onChange={(v) => setAddonField(e.addonId, 'priceMinor', v)} /></Field>
                <Field label="מע״מ"><Select value={e.vatMode} onChange={(v) => setAddonField(e.addonId, 'vatMode', v)} options={ADDON_VAT_OPTS} /></Field>
                <Field label="חיוב אוטומטי"><Select value={e.autoApply} onChange={(v) => setAddonField(e.addonId, 'autoApply', v)} options={AUTO_APPLY_OPTS} /></Field>
              </div>
              {e.autoApply === 'weekdays' && (
                <div className="flex flex-wrap gap-1">
                  {WEEKDAYS.map((w) => (
                    <button type="button" key={w.value} onClick={() => toggleAddonWeekday(e.addonId, w.value)}
                      className={`h-8 px-2.5 rounded-lg text-[12px] ring-1 ${
                        e.autoApplyWeekdays.includes(w.value) ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
                      }`}>
                      {w.name}
                    </button>
                  ))}
                </div>
              )}
              {e.autoApply === 'sabbath_holiday' && (
                <div className="text-[12px] text-gray-500 bg-gray-50 rounded-md px-2.5 py-1.5">
                  🕯️ מופעל אוטומטית לפי הגדרות <b>שעות שבת וחג</b>. אין צורך להגדיר ימים/שעות בכרטיס.
                </div>
              )}
            </div>
          );
        })}
        {availableAddons.length > 0 && (
          <Select value="" onChange={(v) => { if (v) addAddon(v); }}
            options={[{ value: '', name: '+ הוסף תוספת' }, ...availableAddons.map((a) => ({ value: a.id, name: a.nameHe }))]}
            className="!w-60" />
        )}
      </div>

      {err && <div className="text-[13px] text-red-600">{typeof err === 'string' ? err : 'שגיאה'}</div>}

      <div className="flex gap-1.5">
        <button onClick={save} disabled={busy}
          className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'שומר…' : 'שמור כרטיס'}
        </button>
        <button onClick={onClose} className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50">ביטול</button>
      </div>
    </div>
  );
}
