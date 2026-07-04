import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api.js';
import SettingsChrome from '../../settings/SettingsChrome.jsx';
import ReorderableList from '../../common/ReorderableList.jsx';
import { SettingsCard } from './catalogKit.jsx';
import { SingleImage } from '../../products/ImageUploader.jsx';
import { useDirtyWhen } from '../../../lib/dirtyForms.js';

// CRM settings → Quote Layout & Sections. The GLOBAL default quote composition
// control center. Today it manages the Hero, the section order/visibility, and
// the Technical-Details fields. It is intentionally built as a tabbed shell so
// future controls (colors, fonts, PDF, branding) become new tabs without a
// rearchitecture — the whole layout is one JSON record on the server.
//
// This is the DEFAULT template, NOT the per-quote editor: editing a specific
// quote still overrides its own section order. See server quoteTemplate.js.

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';
const LABEL = 'block text-[12px] font-medium text-gray-600 mb-1';

// Display metadata (server owns the stable keys; labels live here).
const SECTION_LABELS = {
  hero: 'כותרת ראשית (Hero)',
  personal_intro: 'פתיח אישי',
  tour_details: 'פרטים טכניים',
  product_marketing: 'תיאור המוצר',
  why_grafitiyul: 'למה גרפיטיול',
  classification: 'תוכן לפי סוג ארגון',
  pricing: 'תמחור',
  payment_terms: 'תנאי תשלום',
  faq: 'שאלות נפוצות',
  cancellation: 'מדיניות ביטול',
  participant_policy: 'מדיניות משתתפים',
  signature: 'חתימה',
};
// Structurally required blocks — always shown, cannot be hidden (hiding pricing
// would break the quote). Hero is handled separately (the document header), so
// it is not in this list.
const REQUIRED_SECTIONS = new Set(['tour_details', 'pricing']);

const TECH_LABELS = {
  city: 'עיר',
  date: 'תאריך',
  time: 'שעה',
  participants: 'משתתפים',
  duration: 'משך הסיור',
  language: 'שפת הסיור',
};

const TABS = [
  { key: 'hero', label: 'כותרת ראשית' },
  { key: 'sections', label: 'סעיפים' },
  { key: 'technical', label: 'פרטים טכניים' },
];

export default function QuoteLayoutSettings() {
  const [layout, setLayout] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('hero');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const data = await api.quoteTemplate.get();
      setLayout(data);
      setBaseline(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const dirty = !!layout && JSON.stringify(layout) !== JSON.stringify(baseline);
  useDirtyWhen(layout, baseline, { active: !!layout });

  // Shallow-immutable updaters — every edit produces a new layout object.
  const patchHero = (patch) => setLayout((l) => ({ ...l, hero: { ...l.hero, ...patch } }));
  const setSections = (sections) => setLayout((l) => ({ ...l, sections }));
  const setTechFields = (fields) => setLayout((l) => ({ ...l, technical: { ...l.technical, fields } }));

  async function save() {
    if (!dirty) return;
    setSaving(true);
    try {
      const saved = await api.quoteTemplate.update(layout);
      setLayout(saved);
      setBaseline(saved);
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-6">
        <SettingsChrome />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">
          מבנה הצעת מחיר
        </h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          מרכז השליטה בהרכב ברירת המחדל של הצעות המחיר — כותרת ראשית, סדר וגלוי
          הסעיפים, והשדות בכרטיס הפרטים הטכניים. אלו הגדרות ברירת מחדל; עריכה של
          הצעה מסוימת עדיין גוברת עליה עבור אותה הצעה בלבד.
        </p>
      </header>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">טוען…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          שגיאה בטעינה: <span dir="ltr" className="font-mono">{error}</span>
        </div>
      ) : (
        <>
          <div className="mb-5 flex gap-1 rounded-xl bg-gray-100 p-1">
            {TABS.map((tItem) => (
              <button
                key={tItem.key}
                onClick={() => setTab(tItem.key)}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
                  tab === tItem.key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tItem.label}
              </button>
            ))}
          </div>

          {tab === 'hero' && <HeroTab hero={layout.hero} onChange={patchHero} />}
          {tab === 'sections' && (
            <SectionsTab sections={layout.sections} onChange={setSections} />
          )}
          {tab === 'technical' && (
            <TechnicalTab fields={layout.technical.fields} onChange={setTechFields} />
          )}

          {/* Sticky save — one JSON record, saved as a whole. */}
          <div className="sticky bottom-4 mt-6 flex items-center justify-end gap-3">
            {dirty && (
              <span className="text-[12px] text-amber-600">יש שינויים שלא נשמרו</span>
            )}
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="h-11 rounded-xl bg-blue-600 px-6 text-sm font-medium text-white shadow-lg transition hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'שומר…' : 'שמור שינויים'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Small, reliable controls (direction-agnostic) ────────────────────────────
function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition ${
            value === o.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}
    >
      <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ insetInlineStart: checked ? '1.375rem' : '0.125rem' }} />
    </button>
  );
}

function ColorField({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-10 cursor-pointer rounded-md border border-gray-300 bg-white p-0.5" />
      <input value={value} onChange={(e) => onChange(e.target.value)} dir="ltr" className="h-9 w-28 rounded-lg border border-gray-300 px-2 text-[13px] font-mono text-gray-700" />
    </div>
  );
}

function SliderField({ value, onChange, min = 0, max = 100 }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1.5 flex-1 cursor-pointer accent-blue-600" />
      <span className="w-12 shrink-0 text-end text-[13px] tabular-nums text-gray-600">{value}%</span>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <span className={LABEL}>{label}</span>
      {children}
    </div>
  );
}

function HeroTab({ hero, onChange }) {
  const overlayEnabled = hero.overlayEnabled !== false;
  return (
    <div className="space-y-4">
      <SettingsCard title="תמונה ולוגו" description="הרקע והלוגו של שער ההצעה.">
        <div className="space-y-5 p-2 sm:p-3">
          <div>
            <span className={LABEL}>תמונת רקע (ברירת מחדל)</span>
            <SingleImage
              image={hero.image ? { url: hero.image.url } : null}
              onChange={(mf) => onChange({ image: mf ? { id: mf.id, url: mf.url } : null })}
              folder="quote/hero"
            />
            <p className="mt-1.5 text-[11px] text-gray-400">תמונות המוצר/המיקום שבדיל גוברות על תמונה זו. זו ברירת המחדל כשאין לדיל תמונה משלו.</p>
          </div>
          <div>
            <span className={LABEL}>לוגו (מוצג על התמונה)</span>
            <SingleImage
              image={hero.logo ? { url: hero.logo.url } : null}
              onChange={(mf) => onChange({ logo: mf ? { id: mf.id, url: mf.url } : null })}
              folder="quote/logo"
            />
            <p className="mt-1.5 text-[11px] text-gray-400">מומלץ לוגו לבן עם רקע שקוף. אם לא הועלה לוגו, מוצג סמל גרפיתיול המובנה.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="מיקום הלוגו">
              <Segmented value={hero.logoPosition || 'start'} onChange={(v) => onChange({ logoPosition: v })}
                options={[{ value: 'start', label: 'צד ההתחלה' }, { value: 'end', label: 'צד הסיום' }]} />
            </Field>
            <Field label="גודל הלוגו">
              <Segmented value={hero.logoSize || 'md'} onChange={(v) => onChange({ logoSize: v })}
                options={[{ value: 'sm', label: 'קטן' }, { value: 'md', label: 'בינוני' }, { value: 'lg', label: 'גדול' }]} />
            </Field>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="שכבת הצללה" description="שכבת צבע מעל התמונה לשיפור הקריאוּת. מומלץ 35%–45%.">
        <div className="space-y-5 p-2 sm:p-3">
          <div className="flex items-center justify-between">
            <span className="text-[13.5px] font-medium text-gray-700">הצללה פעילה</span>
            <Toggle checked={overlayEnabled} onChange={(v) => onChange({ overlayEnabled: v })} />
          </div>
          {overlayEnabled && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="צבע ההצללה"><ColorField value={hero.overlayColor || '#0b1220'} onChange={(v) => onChange({ overlayColor: v })} /></Field>
              <Field label="עוצמת ההצללה"><SliderField value={typeof hero.overlayOpacity === 'number' ? hero.overlayOpacity : 40} onChange={(v) => onChange({ overlayOpacity: v })} /></Field>
            </div>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title="כרטיס פרטי מזמין" description="כרטיס צף עם פרטי הלקוח. ‘הוכן עבור’, ארגון, תאריך הפקה ומי הכין.">
        <div className="grid grid-cols-1 gap-4 p-2 sm:grid-cols-2 sm:p-3">
          <Field label="מיקום הכרטיס">
            <Segmented value={hero.cardPosition || 'top-end'} onChange={(v) => onChange({ cardPosition: v })}
              options={[
                { value: 'top-start', label: 'למעלה · התחלה' },
                { value: 'top-end', label: 'למעלה · סיום' },
                { value: 'bottom-start', label: 'למטה · התחלה' },
                { value: 'bottom-end', label: 'למטה · סיום' },
              ]} />
          </Field>
          <Field label="אטימות הכרטיס"><SliderField value={typeof hero.cardOpacity === 'number' ? hero.cardOpacity : 82} onChange={(v) => onChange({ cardOpacity: v })} /></Field>
        </div>
      </SettingsCard>

      <SettingsCard title="כותרות" description="הכותרת הראשית של השער. אם ריקה — מוצג “הצעת מחיר”.">
        <div className="space-y-4 p-2 sm:p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block"><span className={LABEL}>כותרת ראשית (עברית)</span>
              <input value={hero.titleHe || ''} onChange={(e) => onChange({ titleHe: e.target.value })} placeholder="הצעת מחיר" className={INPUT} /></label>
            <label className="block"><span className={LABEL}>Main title (EN)</span>
              <input value={hero.titleEn || ''} onChange={(e) => onChange({ titleEn: e.target.value })} placeholder="Proposal" dir="ltr" className={INPUT} /></label>
            <label className="block"><span className={LABEL}>כותרת משנה (עברית)</span>
              <input value={hero.subtitleHe || ''} onChange={(e) => onChange({ subtitleHe: e.target.value })} placeholder="אופציונלי" className={INPUT} /></label>
            <label className="block"><span className={LABEL}>Subtitle (EN)</span>
              <input value={hero.subtitleEn || ''} onChange={(e) => onChange({ subtitleEn: e.target.value })} placeholder="Optional" dir="ltr" className={INPUT} /></label>
          </div>
          <Field label="יישור הכותרת">
            <Segmented value={hero.titleAlign || 'start'} onChange={(v) => onChange({ titleAlign: v })}
              options={[{ value: 'start', label: 'לצד ההתחלה' }, { value: 'center', label: 'למרכז' }]} />
          </Field>
        </div>
      </SettingsCard>
    </div>
  );
}

function SectionsTab({ sections, onChange }) {
  // Hero is the document header — pinned first, never in the reorderable list.
  const hero = sections.find((s) => s.key === 'hero');
  const rest = useMemo(() => sections.filter((s) => s.key !== 'hero'), [sections]);
  const items = useMemo(() => rest.map((s) => ({ ...s, id: s.key })), [rest]);

  function reorder(ids) {
    const nextRest = ids.map((id) => rest.find((s) => s.key === id));
    onChange([hero, ...nextRest]);
  }
  function toggle(key) {
    onChange(sections.map((s) => (s.key === key ? { ...s, hidden: !s.hidden } : s)));
  }

  return (
    <SettingsCard
      title="סעיפי ההצעה"
      description="גררו לשינוי הסדר. כבו סעיף כדי להסתיר אותו כברירת מחדל בכל ההצעות."
    >
      {/* Document header — fixed, not reorderable. Configured in the Hero tab. */}
      <div className="mx-2.5 mb-2 flex items-center gap-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/70 px-3 py-2.5">
        <span className="text-lg" aria-hidden>📄</span>
        <span className="flex-1 min-w-0 font-medium text-[15px] text-gray-900">
          {SECTION_LABELS.hero}
        </span>
        <span className="shrink-0 text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">
          כותרת המסמך — תמיד ראשונה
        </span>
      </div>
      <ReorderableList
        items={items}
        onReorder={reorder}
        emptyText="אין סעיפים."
        renderRow={(item, { handle }) => {
          const required = REQUIRED_SECTIONS.has(item.key);
          return (
            <div className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 hover:bg-gray-50">
              {handle}
              <span
                className={`flex-1 min-w-0 font-medium text-[15px] ${
                  item.hidden ? 'text-gray-400 line-through' : 'text-gray-900'
                }`}
              >
                {SECTION_LABELS[item.key] || item.key}
              </span>
              {required ? (
                <span className="shrink-0 text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">
                  חובה
                </span>
              ) : (
                <button
                  onClick={() => toggle(item.key)}
                  className="shrink-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md px-2 py-1 text-[12px] font-medium"
                >
                  {item.hidden ? 'הצג' : 'הסתר'}
                </button>
              )}
            </div>
          );
        }}
      />
    </SettingsCard>
  );
}

function TechnicalTab({ fields, onChange }) {
  const items = useMemo(() => fields.map((f) => ({ ...f, id: f.key })), [fields]);

  function reorder(ids) {
    onChange(ids.map((id) => fields.find((f) => f.key === id)));
  }
  function toggle(key) {
    onChange(fields.map((f) => (f.key === key ? { ...f, visible: !f.visible } : f)));
  }

  return (
    <SettingsCard
      title="שדות הכרטיס הטכני"
      description="בחרו אילו פרטים יופיעו בכרטיס “פרטים טכניים” ובאיזה סדר. שדה ריק בדיל לא יוצג גם אם הוא פעיל."
    >
      <ReorderableList
        items={items}
        onReorder={reorder}
        emptyText="אין שדות."
        renderRow={(item, { handle }) => (
          <div className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 hover:bg-gray-50">
            {handle}
            <span
              className={`flex-1 min-w-0 font-medium text-[15px] ${
                item.visible ? 'text-gray-900' : 'text-gray-400 line-through'
              }`}
            >
              {TECH_LABELS[item.key] || item.key}
            </span>
            <button
              onClick={() => toggle(item.key)}
              className="shrink-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md px-2 py-1 text-[12px] font-medium"
            >
              {item.visible ? 'הסתר' : 'הצג'}
            </button>
          </div>
        )}
      />
    </SettingsCard>
  );
}
