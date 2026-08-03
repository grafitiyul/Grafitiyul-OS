import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import SettingsShell from '../../settings/SettingsShell.jsx';
import SaveBar from '../../settings/SaveBar.jsx';
import ReorderableList from '../../common/ReorderableList.jsx';
import Dialog from '../../common/Dialog.jsx';
import { SettingsCard } from './catalogKit.jsx';
import RichEditor from '../../../editor/RichEditor.jsx';
import { ACTIVITY_TYPE_LABELS } from '../../deals/config.js';
import { TYPE_LABEL, htmlPreview } from '../../shared-content/sharedContentMeta.js';
import ConfirmationTestSendDialog from './ConfirmationTestSendDialog.jsx';
import VariableMenu from '../../communication/VariableMenu.jsx';
import TranslateButton from '../../common/TranslateButton.jsx';
import { registerDynamicFields, getDynamicFieldByKey } from '../../../lib/dynamicFields.js';
import { normalizeTokensToChips } from '../../../../../shared/variableTokens.mjs';

// CRM settings → מייל אישור — the Confirmation Email module's template
// management. A DEDICATED module (not the Communication Center): templates are
// scoped by product / activity type / org type (empty = everything), and
// exactly ONE template must resolve per deal — equally-specific overlaps are
// flagged here at save time (the server refuses them again at send time).
// Reusable content blocks live in the Shared Content Library and are only
// REFERENCED here.

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';
const LABEL = 'block text-[12px] font-medium text-gray-600 mb-1';

const ERROR_TEXT = {
  internalName_required: 'שם התבנית חסר.',
  default_required: 'חייבת להיות תבנית ברירת מחדל — קבעו תבנית אחרת כברירת מחדל במקום.',
  default_must_stay_active: 'תבנית ברירת המחדל חייבת להישאר פעילה.',
  default_template_undeletable: 'לא ניתן למחוק את תבנית ברירת המחדל — קבעו קודם תבנית אחרת.',
  invalid_template: 'הגדרות התבנית אינן תקינות.',
};
const errText = (e) => ERROR_TEXT[e?.payload?.error] || 'שגיאה: ' + (e?.payload?.error || e?.message);

function scopeSummary(t, { productName, orgTypeName }) {
  const parts = [];
  if (t.productIds?.length) parts.push(t.productIds.map(productName).join(', '));
  if (t.activityTypes?.length) parts.push(t.activityTypes.map((a) => ACTIVITY_TYPE_LABELS[a] || a).join(', '));
  if (t.orgTypeIds?.length) parts.push(t.orgTypeIds.map(orgTypeName).join(', '));
  return parts.length ? parts.join(' · ') : 'כל העסקאות';
}

export default function ConfirmationEmailSettings() {
  const [data, setData] = useState(null); // { templates, conflicts, meta }
  const [products, setProducts] = useState([]);
  const [orgTypes, setOrgTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [testSendOpen, setTestSendOpen] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [d, p, ot] = await Promise.all([
        api.confirmationEmail.list(),
        api.products.list(),
        api.organizationTypes.list(),
      ]);
      // Chip labels for the editors — the ONE server catalog, registered into
      // the shared dynamic-field registry before any editor renders.
      registerDynamicFields(
        (d.meta?.variables || []).map((v) => ({ key: v.key, label: v.labelHe, description: v.descriptionHe })),
      );
      setData(d);
      setProducts(p);
      setOrgTypes(ot);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const names = useMemo(() => {
    const productById = Object.fromEntries(products.map((p) => [p.id, p.nameHe]));
    const orgTypeById = Object.fromEntries(orgTypes.map((t) => [t.id, t.label]));
    return {
      productName: (id) => productById[id] || id,
      orgTypeName: (id) => orgTypeById[id] || id,
    };
  }, [products, orgTypes]);
  const templateName = (id) =>
    data?.templates?.find((t) => t.id === id)?.internalName || id;

  async function add(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const created = await api.confirmationEmail.create({ internalName: newName.trim() });
      setNewName('');
      await refresh();
      setEditingId(created.id);
    } catch (e) {
      alert(errText(e));
    } finally {
      setBusy(false);
    }
  }
  async function toggleActive(t) {
    try {
      await api.confirmationEmail.update(t.id, { active: !t.active });
      await refresh();
    } catch (e) {
      alert(errText(e));
    }
  }
  async function makeDefault(t) {
    if (!confirm(`לקבוע את "${t.internalName}" כתבנית ברירת המחדל? ההגבלות שלה יאופסו (ברירת מחדל חלה על הכל).`)) return;
    try {
      // The default must be all-wildcard — clear scopes as part of promotion.
      await api.confirmationEmail.update(t.id, {
        isDefault: true, productIds: [], activityTypes: [], orgTypeIds: [], active: true,
      });
      await refresh();
    } catch (e) {
      alert(errText(e));
    }
  }
  async function remove(t) {
    if (!confirm(`למחוק את התבנית "${t.internalName}"?`)) return;
    try {
      await api.confirmationEmail.remove(t.id);
      if (editingId === t.id) setEditingId(null);
      await refresh();
    } catch (e) {
      alert(errText(e));
    }
  }

  return (
    <SettingsShell
      width="wide"
      title="מייל אישור"
      actions={
        /* QA before go-live: real deal, real resolver, real queue — only
           the recipient differs. */
        <button
          type="button"
          onClick={() => setTestSendOpen(true)}
          className="h-10 shrink-0 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          🧪 שלח מייל בדיקה
        </button>
      }
      subtitle={
        <>
          תבניות מייל האישור ללקוח. לכל עסקה נבחרת בדיוק תבנית אחת — לפי מוצר, סוג
          פעילות וסוג ארגון (הכי ספציפית מנצחת). בלוקי התוכן מנוהלים{' '}
          <a href="/admin/settings/crm/shared-content" className="text-blue-600 hover:underline">
            בספריית התוכן המשותף
          </a>
          .
        </>
      }
    >

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">טוען…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          שגיאה בטעינה: <span dir="ltr" className="font-mono">{error}</span>
        </div>
      ) : (
        <>
          {data.conflicts?.length > 0 && (
            <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-800">
              <div className="font-semibold mb-1">⚠ תבניות חופפות — שליחה תיחסם עבור עסקאות שמתאימות לשתיהן</div>
              <ul className="list-disc pr-5 space-y-0.5">
                {data.conflicts.map((c, i) => (
                  <li key={i}>
                    ״{templateName(c.aId)}״ ↔ ״{templateName(c.bId)}״ — אותה רמת התאמה ואותה עדיפות.
                    שנו את ההגבלות או את העדיפות של אחת מהן.
                  </li>
                ))}
              </ul>
            </div>
          )}

          <SettingsCard
            title="תבניות"
            description="תבנית ברירת המחדל חלה על כל עסקה שאין לה תבנית ממוקדת יותר."
            footer={
              <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="שם תבנית חדשה (לדוגמה: סוכני תיירות)"
                  className={`flex-1 ${INPUT}`}
                />
                <button
                  type="submit"
                  disabled={busy || !newName.trim()}
                  className="h-10 shrink-0 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy ? 'מוסיף…' : 'הוסף תבנית'}
                </button>
              </form>
            }
          >
            {data.templates.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">
                עדיין אין תבניות. התבנית הראשונה תוגדר אוטומטית כברירת המחדל.
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.templates.map((t) => (
                  <li key={t.id}>
                    <div className="flex items-center gap-3 px-2.5 py-3">
                      <button
                        onClick={() => setEditingId(editingId === t.id ? null : t.id)}
                        className="flex-1 min-w-0 text-start"
                      >
                        <span className={`font-medium text-[15px] ${t.active ? 'text-gray-900' : 'text-gray-400'}`}>
                          {t.internalName}
                        </span>
                        {t.isDefault && (
                          <span className="ms-2 text-[11px] rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 font-medium">
                            ברירת מחדל
                          </span>
                        )}
                        <span className="block text-[12px] text-gray-400 mt-0.5">
                          {scopeSummary(t, names)}
                          {t.priority ? ` · עדיפות ${t.priority}` : ''}
                        </span>
                      </button>
                      {!t.active && (
                        <span className="shrink-0 text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">לא פעילה</span>
                      )}
                      {!t.isDefault && (
                        <>
                          <button
                            onClick={() => makeDefault(t)}
                            className="shrink-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md px-2 py-1 text-[12px] font-medium"
                          >
                            קבע כברירת מחדל
                          </button>
                          <button
                            onClick={() => toggleActive(t)}
                            className="shrink-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md px-2 py-1 text-[12px] font-medium"
                          >
                            {t.active ? 'כבה' : 'הפעל'}
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => setEditingId(editingId === t.id ? null : t.id)}
                        className="shrink-0 text-blue-600 hover:bg-blue-50 rounded-md px-2 py-1 text-[12px] font-medium"
                      >
                        {editingId === t.id ? 'סגור' : 'עריכה'}
                      </button>
                      {!t.isDefault && (
                        <button onClick={() => remove(t)} title="מחק" className="shrink-0 text-red-500 hover:bg-red-50 rounded-md p-1.5">
                          🗑
                        </button>
                      )}
                    </div>
                    {editingId === t.id && (
                      <TemplateEditor
                        template={t}
                        meta={data.meta}
                        products={products}
                        orgTypes={orgTypes}
                        onClose={() => setEditingId(null)}
                        onSaved={refresh}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SettingsCard>
        </>
      )}
      {testSendOpen && <ConfirmationTestSendDialog onClose={() => setTestSendOpen(false)} />}
    </SettingsShell>
  );
}

// Pill multi-select over a fixed option list — the PricingBoard CardEditor
// convention (consistency beats novelty; product/org-type counts fit pills).
function PillGroup({ options, selected, onToggle, disabled }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(o.value)}
            className={`rounded-full px-3 py-1 text-[12px] font-medium border transition ${
              on
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Stored/typed raw {{tokens}} → chip nodes before entering TipTap (the
// EmailBodyEditor hydration convention; labels come from the registry).
const hydrate = (html) =>
  normalizeTokensToChips(html || '', (key) => getDynamicFieldByKey(key)?.label || null);

// Readable chip preview under a subject input (tokens stay {{key}} in state).
function SubjectPreview({ value }) {
  const parts = String(value || '').split(/(\{\{[a-z][a-z0-9_]*\}\})/g).filter(Boolean);
  if (parts.length < 2 && !/^\{\{/.test(parts[0] || '')) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[12px] text-gray-500">
      {parts.map((p, i) => {
        const m = /^\{\{([a-z][a-z0-9_]*)\}\}$/.exec(p);
        if (!m) return <span key={i}>{p}</span>;
        const f = getDynamicFieldByKey(m[1]);
        return (
          <span key={i} className="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-800">
            ✦ {f?.label || m[1]}
          </span>
        );
      })}
    </div>
  );
}

function TemplateEditor({ template, meta, products, orgTypes, onClose, onSaved }) {
  const [internalName, setInternalName] = useState(template.internalName);
  const [productIds, setProductIds] = useState(template.productIds || []);
  const [activityTypes, setActivityTypes] = useState(template.activityTypes || []);
  const [orgTypeIds, setOrgTypeIds] = useState(template.orgTypeIds || []);
  const [priority, setPriority] = useState(template.priority || 0);
  const [subjectHe, setSubjectHe] = useState(template.subjectHe || '');
  const [subjectEn, setSubjectEn] = useState(template.subjectEn || '');
  const [greetingHe, setGreetingHe] = useState(() => hydrate(template.greetingHe));
  const [greetingEn, setGreetingEn] = useState(() => hydrate(template.greetingEn));
  const [closingHe, setClosingHe] = useState(() => hydrate(template.closingHe));
  const [closingEn, setClosingEn] = useState(() => hydrate(template.closingEn));
  const subjectHeRef = useRef(null);
  const subjectEnRef = useRef(null);
  const lastSubjectRef = useRef('he');

  function insertIntoSubject(v) {
    const he = lastSubjectRef.current !== 'en';
    const input = he ? subjectHeRef.current : subjectEnRef.current;
    const [value, set] = he ? [subjectHe, setSubjectHe] : [subjectEn, setSubjectEn];
    const token = `{{${v.key}}}`;
    const cur = String(value || '');
    const start = input?.selectionStart ?? cur.length;
    const end = input?.selectionEnd ?? cur.length;
    set(cur.slice(0, start) + token + cur.slice(end));
    setTimeout(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  }
  const [sections, setSections] = useState(() => template.sections || []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // sharedContentId → { internalName, type } — from saved links + picker adds.
  const [blockMap, setBlockMap] = useState(() =>
    Object.fromEntries(
      (template.blockLinks || []).map((l) => [
        l.sharedContent.id,
        { internalName: l.sharedContent.internalName, type: l.sharedContent.type },
      ]),
    ),
  );

  const autoLabel = Object.fromEntries((meta?.autoSections || []).map((s) => [s.key, s.labelHe]));
  const toggle = (setter) => (v) =>
    setter((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  // ReorderableList needs stable ids — synthesize from the entry identity.
  const rows = sections.map((s) => ({
    ...s,
    id: s.kind === 'auto' ? `auto:${s.key}` : `block:${s.sharedContentId}`,
  }));
  function reorder(ids) {
    setSections(ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean).map(({ id, ...s }) => s));
  }
  function toggleHidden(row) {
    setSections((cur) =>
      cur.map((s) => {
        const sid = s.kind === 'auto' ? `auto:${s.key}` : `block:${s.sharedContentId}`;
        return sid === row.id ? { ...s, hidden: !s.hidden } : s;
      }),
    );
  }
  function removeBlock(row) {
    setSections((cur) => cur.filter((s) => !(s.kind === 'block' && `block:${s.sharedContentId}` === row.id)));
  }
  function addBlock(item) {
    setBlockMap((m) => ({ ...m, [item.id]: { internalName: item.internalName, type: item.type } }));
    setSections((cur) =>
      cur.some((s) => s.kind === 'block' && s.sharedContentId === item.id)
        ? cur
        : [...cur, { kind: 'block', sharedContentId: item.id, hidden: false }],
    );
    setPickerOpen(false);
  }

  // Canonical save-state: dirty is DERIVED from the actual payload vs the
  // last-saved baseline — no false "saved", no invisible autosave.
  const buildPayload = () => ({
    internalName: internalName.trim(),
    productIds,
    activityTypes,
    orgTypeIds,
    priority: Number(priority) || 0,
    subjectHe: subjectHe.trim() || null,
    subjectEn: subjectEn.trim() || null,
    greetingHe: greetingHe || null,
    greetingEn: greetingEn || null,
    closingHe: closingHe || null,
    closingEn: closingEn || null,
    sections,
  });
  const [baseline, setBaseline] = useState(() => JSON.stringify(buildPayload()));
  const [saveError, setSaveError] = useState(null);
  const dirty = JSON.stringify(buildPayload()) !== baseline;

  async function save() {
    if (!internalName.trim()) {
      setSaveError('שם התבנית חסר');
      return;
    }
    setBusy(true);
    setSaveError(null);
    try {
      const payload = buildPayload();
      await api.confirmationEmail.update(template.id, payload);
      setBaseline(JSON.stringify(payload)); // clean ONLY after the server said yes
      await onSaved(); // list refresh; the editor stays open showing ✓ נשמר
    } catch (e) {
      setSaveError(errText(e)); // failed save keeps the dirty state
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-2.5 mb-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3 sm:p-4 space-y-5">
      <label className="block max-w-sm">
        <span className={LABEL}>שם התבנית (פנימי)</span>
        <input value={internalName} onChange={(e) => setInternalName(e.target.value)} className={INPUT} />
      </label>

      {/* Scoping — empty selection = everything. Locked on the default template. */}
      <div className="space-y-3">
        <div className="text-[13px] font-semibold text-gray-700">למי התבנית מיועדת</div>
        {template.isDefault ? (
          <p className="text-[12px] text-gray-500">
            זו תבנית ברירת המחדל — היא חלה על כל עסקה שאין לה תבנית ממוקדת יותר. כדי
            למקד קהל, צרו תבנית נוספת.
          </p>
        ) : (
          <>
            <div>
              <span className={LABEL}>מוצרים (ריק = כל המוצרים)</span>
              <PillGroup
                options={products.map((p) => ({ value: p.id, label: p.nameHe }))}
                selected={productIds}
                onToggle={toggle(setProductIds)}
              />
            </div>
            <div>
              <span className={LABEL}>סוג פעילות (ריק = כל הסוגים)</span>
              <PillGroup
                options={(meta?.activityTypes || []).map((a) => ({ value: a, label: ACTIVITY_TYPE_LABELS[a] || a }))}
                selected={activityTypes}
                onToggle={toggle(setActivityTypes)}
              />
            </div>
            <div>
              <span className={LABEL}>סוגי ארגון (ריק = כל הסוגים)</span>
              <PillGroup
                options={orgTypes.map((t) => ({ value: t.id, label: t.label }))}
                selected={orgTypeIds}
                onToggle={toggle(setOrgTypeIds)}
              />
            </div>
            <details>
              <summary className="cursor-pointer text-[12px] text-gray-500">מתקדם — עדיפות</summary>
              <label className="mt-2 block max-w-[10rem]">
                <span className={LABEL}>עדיפות (שובר שוויון בין תבניות באותה רמת התאמה)</span>
                <input
                  type="number"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className={INPUT}
                  dir="ltr"
                />
              </label>
            </details>
          </>
        )}
      </div>

      {/* Subject — side-by-side He/En, with the canonical variable picker. */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[13px] font-semibold text-gray-700">נושא המייל</div>
          <VariableMenu
            variables={meta?.variables || []}
            categories={meta?.variableCategories || {}}
            onInsert={insertIntoSubject}
            label="משתנה בנושא"
            showKeys={false}
          />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <label className="block">
            <span className={LABEL}>עברית</span>
            <input
              ref={subjectHeRef}
              onFocus={() => { lastSubjectRef.current = 'he'; }}
              value={subjectHe}
              onChange={(e) => setSubjectHe(e.target.value)}
              className={INPUT}
              placeholder="אישור הזמנה — גרפיטיול"
            />
            <SubjectPreview value={subjectHe} />
          </label>
          <label className="block">
            <span className={`${LABEL} flex items-center justify-between`}>
              English
              <TranslateButton getSource={() => subjectHe} getTarget={() => subjectEn} onResult={setSubjectEn} format="text" />
            </span>
            <input
              ref={subjectEnRef}
              onFocus={() => { lastSubjectRef.current = 'en'; }}
              value={subjectEn}
              onChange={(e) => setSubjectEn(e.target.value)}
              dir="ltr"
              className={INPUT}
              placeholder="Booking confirmation — Grafitiyul"
            />
            <SubjectPreview value={subjectEn} />
          </label>
        </div>
      </div>

      {/* Sections — order + visibility; blocks referenced from the library. */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[13px] font-semibold text-gray-700">מבנה המייל</div>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="text-[12px] font-medium text-blue-600 hover:bg-blue-50 rounded-md px-2 py-1"
          >
            + הוסף בלוק תוכן
          </button>
        </div>
        <ReorderableList
          items={rows}
          onReorder={reorder}
          emptyText="אין מקטעים."
          renderRow={(row, { handle }) => (
            <div className="flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-white">
              {handle}
              <span className={`flex-1 text-[14px] ${row.hidden ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                {row.kind === 'auto'
                  ? autoLabel[row.key] || row.key
                  : blockMap[row.sharedContentId]?.internalName || 'בלוק תוכן'}
              </span>
              {row.kind === 'auto' ? (
                <span className="shrink-0 text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">אוטומטי</span>
              ) : (
                <span className="shrink-0 text-[11px] rounded-full bg-teal-50 text-teal-700 px-2 py-0.5">
                  {TYPE_LABEL[blockMap[row.sharedContentId]?.type] || 'ספריית תוכן'}
                </span>
              )}
              <button
                type="button"
                onClick={() => toggleHidden(row)}
                className="shrink-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md px-2 py-1 text-[12px] font-medium"
              >
                {row.hidden ? 'הצג' : 'הסתר'}
              </button>
              {row.kind === 'block' && (
                <button type="button" onClick={() => removeBlock(row)} title="הסר מהתבנית" className="shrink-0 text-red-500 hover:bg-red-50 rounded-md p-1">
                  ✕
                </button>
              )}
            </div>
          )}
        />
        <p className="text-[11px] text-gray-400 mt-1.5">
          ״תנאים מיוחדים שסוכמו״ מופיע במייל רק כשלעסקה יש פילרים מתאימים.
        </p>
      </div>

      {/* Greeting / closing wording overrides — side-by-side rich editors with
          the canonical customer-variable picker per language. */}
      <BilingualRich label="פתיח (ריק = נוסח ברירת המחדל)" he={greetingHe} en={greetingEn} onHe={setGreetingHe} onEn={setGreetingEn} meta={meta} />
      <BilingualRich label="סגיר (ריק = נוסח ברירת המחדל)" he={closingHe} en={closingEn} onHe={setClosingHe} onEn={setClosingEn} meta={meta} />

      <div className="flex items-center gap-3 border-t border-blue-100 pt-3">
        <SaveBar dirty={dirty} saving={busy} error={saveError} onSave={save} label="שמור תבנית" className="flex-1" />
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50">
          סגור
        </button>
      </div>

      {pickerOpen && (
        <BlockPicker
          blockTypes={meta?.blockTypes || []}
          usedIds={sections.filter((s) => s.kind === 'block').map((s) => s.sharedContentId)}
          onPick={addBlock}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// Side-by-side bilingual rich editing (the VariantEditor BiEditor convention),
// with the canonical customer-variable picker above each language column.
function BilingualRich({ label, he, en, onHe, onEn, meta }) {
  const heRef = useRef(null);
  const enRef = useRef(null);
  const variables = meta?.variables || [];
  const categories = meta?.variableCategories || {};
  return (
    <div>
      <div className="text-[13px] font-semibold text-gray-700 mb-2">{label}</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className={LABEL}>עברית</span>
            <VariableMenu variables={variables} categories={categories} editorRef={heRef} showKeys={false} />
          </div>
          <RichEditor
            value={he}
            onChange={onHe}
            ariaLabel={`${label} — עברית`}
            minContentHeight={100}
            onEditorReady={(editor) => { heRef.current = editor; }}
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className={LABEL}>English</span>
            <span className="flex items-center gap-1.5">
              <TranslateButton getSource={() => he} getTarget={() => en} onResult={(v) => onEn(hydrate(v))} />
              <VariableMenu variables={variables} categories={categories} editorRef={enRef} showKeys={false} />
            </span>
          </div>
          <div dir="ltr">
            <RichEditor
              value={en}
              onChange={onEn}
              ariaLabel={`${label} — English`}
              minContentHeight={100}
              placeholder="Write here..."
              onEditorReady={(editor) => { enRef.current = editor; }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Library picker — confirmation-type blocks only, text-filtered. Content is
// created/edited in the Shared Content Library, never here.
function BlockPicker({ blockTypes, usedIds, onPick, onClose }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    let on = true;
    api.sharedContent
      .list()
      .then((all) => {
        if (!on) return;
        setRows(all.filter((r) => blockTypes.includes(r.type) && r.active));
      })
      .catch(() => on && setRows([]));
    return () => {
      on = false;
    };
  }, [blockTypes]);

  const needle = q.trim().toLowerCase();
  const filtered = (rows || []).filter(
    (r) =>
      !needle ||
      r.internalName.toLowerCase().includes(needle) ||
      (r.bodyHe || '').toLowerCase().includes(needle) ||
      (r.bodyEn || '').toLowerCase().includes(needle),
  );

  return (
    <Dialog open onClose={onClose} title="הוספת בלוק תוכן" size="md-wide">
      <div className="space-y-3">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש…"
          className={INPUT}
        />
        {rows === null ? (
          <div className="py-8 text-center text-sm text-gray-400">טוען…</div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">
            אין בלוקים מתאימים.{' '}
            <a href="/admin/settings/crm/shared-content" className="text-blue-600 hover:underline">
              צרו תוכן בספריית התוכן המשותף
            </a>{' '}
            (סוגי ״מייל אישור״).
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 max-h-[50vh] overflow-y-auto">
            {filtered.map((r) => {
              const used = usedIds.includes(r.id);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={used}
                    onClick={() => onPick(r)}
                    className={`w-full text-start px-2.5 py-2.5 rounded-lg ${used ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50'}`}
                  >
                    <span className="font-medium text-[14px] text-gray-900">{r.internalName}</span>
                    <span className="ms-2 text-[11px] rounded-full bg-teal-50 text-teal-700 px-2 py-0.5">
                      {TYPE_LABEL[r.type] || r.type}
                    </span>
                    {used && <span className="ms-2 text-[11px] text-gray-400">כבר בתבנית</span>}
                    <span className="block text-[12px] text-gray-400 mt-0.5">{htmlPreview(r.bodyHe || r.bodyEn, 90)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
