import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api.js';
import SettingsChrome from '../../settings/SettingsChrome.jsx';
import ReorderableList from '../../common/ReorderableList.jsx';
import { SettingsCard } from './catalogKit.jsx';
import { SingleImage } from '../../products/ImageUploader.jsx';
import { useDirtyWhen } from '../../../lib/dirtyForms.js';
import { HeroCover, previewHeroData } from '../../../quote/QuoteBlockRenderer.jsx';
import { parseEmbedUrl } from '../../../editor/embedProviders.js';

// CRM settings → Quote Layout & Sections. The GLOBAL default quote composition
// control center. The Hero tab is a real two-column WYSIWYG editor: controls on
// the reading-start (right in RTL), a LIVE hero preview on the left that updates
// on every change and renders with the SAME component the produced quote uses —
// so what you design here is exactly what the customer receives. Sections and
// Technical stay as list editors. The whole layout is one JSON record on the
// server; this is the DEFAULT template, not the per-quote editor.

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400';
const LABEL = 'block text-[12px] font-medium text-gray-600 mb-1';

// Display metadata (server owns the stable keys; labels live here).
const SECTION_LABELS = {
  hero: 'כותרת ראשית (Hero)',
  program: 'אז מה בתוכנית?',
  tour_details: 'פרטים טכניים',
  product_marketing: 'תיאור המוצר',
  video: 'וידאו',
  why_grafitiyul: 'למה גרפיטיול',
  image_slot_1: 'תמונה — מיקום 1',
  pricing: 'תמחור',
  faq: 'שאלות נפוצות',
  cancellation: 'מדיניות ביטול / דחייה',
  participant_policy: 'מדיניות שינוי כמות המשתתפים',
  image_slot_2: 'תמונה — מיקום 2',
  signature: 'חתימה',
};
// Hero is the only fixed block (the document header, pinned first + never hidden).
// Every other section — including Technical Details and Pricing — is fully
// controlled here: it can be reordered and hidden/shown, and the quote follows.
const REQUIRED_SECTIONS = new Set();

const TECH_LABELS = {
  city: 'עיר', date: 'תאריך', time: 'שעה',
  participants: 'משתתפים', duration: 'משך הסיור', language: 'שפת הסיור',
};

const TABS = [
  { key: 'hero', label: 'כותרת ראשית' },
  { key: 'sections', label: 'סעיפים' },
  { key: 'video', label: 'וידאו' },
  { key: 'images', label: 'תמונות' },
  { key: 'technical', label: 'פרטים טכניים' },
];

// Remember the last-opened tab across refreshes (local, per user/browser).
const TAB_STORAGE_KEY = 'gos.quoteStructure.tab';
function usePersistedTab() {
  const valid = (v) => TABS.some((t) => t.key === v);
  const [tab, setTabState] = useState(() => {
    try { const v = localStorage.getItem(TAB_STORAGE_KEY); return valid(v) ? v : 'hero'; } catch { return 'hero'; }
  });
  const setTab = useCallback((t) => {
    setTabState(t);
    try { localStorage.setItem(TAB_STORAGE_KEY, t); } catch { /* ignore quota */ }
  }, []);
  return [tab, setTab];
}

// Sections whose localized title is configurable from Quote Structure. The label
// is the row/menu name; the actual title lives in layout.sectionTitles[key].
const TITLE_SECTIONS = [
  { key: 'program', label: 'אז מה בתוכנית?' },
  { key: 'tour_details', label: 'פרטים טכניים' },
  { key: 'product_marketing', label: 'תיאור המוצר' },
  { key: 'why_grafitiyul', label: 'למה גרפיטיול' },
  { key: 'image_slot_1', label: 'תמונה — מיקום 1' },
  { key: 'pricing', label: 'תמחור' },
  { key: 'faq', label: 'שאלות נפוצות' },
  { key: 'cancellation', label: 'מדיניות ביטול / דחייה' },
  { key: 'participant_policy', label: 'מדיניות שינוי כמות המשתתפים' },
  { key: 'image_slot_2', label: 'תמונה — מיקום 2' },
  { key: 'signature', label: 'חתימה' },
];

// Quick design presets — each is a partial hero patch. "פרימיום כהה" is the
// reference default; the rest are safe one-click variations.
const PRESETS = [
  { key: 'premium', label: 'פרימיום כהה', patch: { overlayEnabled: true, overlayColor: '#081220', overlayOpacity: 42, cardEnabled: true, cardOpacity: 70, cardBlur: 'md', cardColor: '#081220', contentV: 'center', titleAlign: 'start' } },
  { key: 'dark', label: 'כיסוי כהה', patch: { overlayEnabled: true, overlayColor: '#05070c', overlayOpacity: 64, cardEnabled: true, cardOpacity: 82, cardBlur: 'lg', cardColor: '#05070c', contentV: 'center', titleAlign: 'start' } },
  { key: 'minimal', label: 'מינימלי', patch: { overlayEnabled: true, overlayColor: '#081220', overlayOpacity: 30, cardEnabled: false, contentV: 'center', titleAlign: 'center' } },
  { key: 'clean', label: 'תמונה נקייה', patch: { overlayEnabled: true, overlayColor: '#081220', overlayOpacity: 22, cardEnabled: true, cardOpacity: 55, cardBlur: 'sm', contentV: 'bottom', titleAlign: 'start' } },
];

export default function QuoteLayoutSettings() {
  const [layout, setLayout] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = usePersistedTab();
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
  useEffect(() => { refresh(); }, [refresh]);

  const dirty = !!layout && JSON.stringify(layout) !== JSON.stringify(baseline);
  useDirtyWhen(layout, baseline, { active: !!layout });

  const patchHero = (patch) => setLayout((l) => ({ ...l, hero: { ...l.hero, ...patch } }));
  const patchCardFields = (patch) =>
    setLayout((l) => ({ ...l, hero: { ...l.hero, cardFields: { ...(l.hero.cardFields || {}), ...patch } } }));
  const setSections = (sections) => setLayout((l) => ({ ...l, sections }));
  const patchSectionTitle = (key, patch) =>
    setLayout((l) => ({ ...l, sectionTitles: { ...l.sectionTitles, [key]: { ...l.sectionTitles?.[key], ...patch } } }));
  const setVideos = (videos) => setLayout((l) => ({ ...l, videos }));
  const setImages = (images) => setLayout((l) => ({ ...l, images }));
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
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-[1440px] mx-auto">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <SettingsChrome />
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900">מבנה הצעת מחיר</h1>
          <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-gray-500">
            עורך חי לשער ההצעה — כל שינוי נראה מיד בתצוגה, ומתנהג בדיוק כמו ההצעה
            שהלקוח מקבל. אלו הגדרות ברירת מחדל; עריכה של הצעה מסוימת עדיין גוברת עליה.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {dirty && <span className="text-[12px] text-amber-600">שינויים שלא נשמרו</span>}
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="h-10 rounded-xl px-5 text-sm font-semibold text-white shadow-sm transition disabled:opacity-50"
            style={{ background: '#10a99b' }}
          >
            {saving ? 'שומר…' : '✓ שמור שינויים'}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">טוען…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          שגיאה בטעינה: <span dir="ltr" className="font-mono">{error}</span>
        </div>
      ) : (
        <>
          <div className="mb-5 flex max-w-md gap-1 rounded-xl bg-gray-100 p-1">
            {TABS.map((tItem) => (
              <button
                key={tItem.key}
                onClick={() => setTab(tItem.key)}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
                  tab === tItem.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tItem.label}
              </button>
            ))}
          </div>

          {tab === 'hero' && (
            <HeroEditor hero={layout.hero} onChange={patchHero} onCardFields={patchCardFields} />
          )}
          {tab === 'sections' && (
            <div className="max-w-3xl space-y-4">
              <SectionsTab sections={layout.sections} sectionTitles={layout.sectionTitles} onChange={setSections} />
              <SectionTitlesCard sectionTitles={layout.sectionTitles} onChange={patchSectionTitle} />
            </div>
          )}
          {tab === 'technical' && (
            <div className="max-w-3xl"><TechnicalTab fields={layout.technical.fields} onChange={setTechFields} /></div>
          )}
          {tab === 'video' && (
            <div className="max-w-3xl"><VideoTab videos={layout.videos} onChange={setVideos} /></div>
          )}
          {tab === 'images' && (
            <div className="max-w-3xl"><ImagesTab images={layout.images} onChange={setImages} /></div>
          )}
        </>
      )}
    </div>
  );
}

// ── The two-column Hero WYSIWYG editor ───────────────────────────────────────
function HeroEditor({ hero, onChange, onCardFields }) {
  const [previewLang, setPreviewLang] = useState('he');
  const [device, setDevice] = useState('desktop');

  // Sample runtime facts so the preview reads like a real produced cover. The
  // generated date is "today" (browser clock) — presentation only, never saved.
  const sample = useMemo(() => ({ createdAt: new Date().toISOString() }), []);
  const coverData = useMemo(() => previewHeroData(hero, previewLang, sample), [hero, previewLang, sample]);

  const overlayEnabled = hero.overlayEnabled !== false;
  const cardEnabled = hero.cardEnabled !== false;
  const cf = hero.cardFields || {};

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(340px,440px)_1fr]">
      {/* ── Controls (reading-start) ── */}
      <div className="space-y-4">
        {/* Background image */}
        <SettingsCard title="תמונת רקע" description="הרקע של שער ההצעה. תמונת המוצר/המיקום שבדיל גוברת עליה.">
          <div className="p-2 sm:p-3">
            <SingleImage
              image={hero.image ? { url: hero.image.url } : null}
              onChange={(mf) => onChange({ image: mf ? { id: mf.id, url: mf.url } : null })}
              folder="quote/hero"
            />
            <p className="mt-2 text-[11px] text-gray-400">זו ברירת המחדל כשאין לדיל תמונה משלו.</p>
          </div>
        </SettingsCard>

        {/* Overlay */}
        <SettingsCard title="שכבת הצללה" description="מכהה את התמונה לקריאוּת. השכבה כהה יותר אוטומטית מאחורי הטקסט.">
          <div className="space-y-4 p-2 sm:p-3">
            <RowToggle label="הצללה פעילה" checked={overlayEnabled} onChange={(v) => onChange({ overlayEnabled: v })} />
            {overlayEnabled && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="צבע ההצללה"><ColorField value={hero.overlayColor || '#081220'} onChange={(v) => onChange({ overlayColor: v })} /></Field>
                <Field label="עוצמת ההצללה"><SliderField value={num(hero.overlayOpacity, 42)} onChange={(v) => onChange({ overlayOpacity: v })} unit="%" /></Field>
              </div>
            )}
          </div>
        </SettingsCard>

        {/* Logo */}
        <SettingsCard title="לוגו" description="לוגו לבן על התמונה. אם לא הועלה — מוצג הלוגו המובנה של גרפיטיול.">
          <div className="space-y-4 p-2 sm:p-3">
            <SingleImage
              image={hero.logo ? { url: hero.logo.url } : null}
              onChange={(mf) => onChange({ logo: mf ? { id: mf.id, url: mf.url } : null })}
              folder="quote/logo"
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="מיקום הלוגו">
                <Segmented value={hero.logoPosition || 'start'} onChange={(v) => onChange({ logoPosition: v })}
                  options={[{ value: 'start', label: 'למעלה · צד הכותרת' }, { value: 'end', label: 'למעלה · צד התמונה' }]} />
              </Field>
              <Field label={`גודל הלוגו · ${num(hero.logoSizePx, 56)}px`}>
                <SliderField value={num(hero.logoSizePx, 56)} min={32} max={140} onChange={(v) => onChange({ logoSizePx: v })} unit="px" />
              </Field>
            </div>
            <Field label={`מרווח מהקצה · ${num(hero.logoMargin, 24)}px`}>
              <SliderField value={num(hero.logoMargin, 24)} min={0} max={80} onChange={(v) => onChange({ logoMargin: v })} unit="px" />
            </Field>
          </div>
        </SettingsCard>

        {/* Text */}
        <SettingsCard title="טקסט ראשי" description="הכותרת של השער. אם ריקה — מוצג “הצעת מחיר”. כותרת המשנה היא שם הסיור.">
          <div className="space-y-4 p-2 sm:p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block"><span className={LABEL}>כותרת (עברית)</span>
                <input value={hero.titleHe || ''} onChange={(e) => onChange({ titleHe: e.target.value })} placeholder="הצעת מחיר" className={INPUT} /></label>
              <label className="block"><span className={LABEL}>Title (EN)</span>
                <input value={hero.titleEn || ''} onChange={(e) => onChange({ titleEn: e.target.value })} placeholder="Price Quote" dir="ltr" className={INPUT} /></label>
              <label className="block"><span className={LABEL}>כותרת משנה (עברית)</span>
                <input value={hero.subtitleHe || ''} onChange={(e) => onChange({ subtitleHe: e.target.value })} placeholder="שם הסיור (ברירת מחדל)" className={INPUT} /></label>
              <label className="block"><span className={LABEL}>Subtitle (EN)</span>
                <input value={hero.subtitleEn || ''} onChange={(e) => onChange({ subtitleEn: e.target.value })} placeholder="Tour name (default)" dir="ltr" className={INPUT} /></label>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="יישור הטקסט">
                <Segmented value={hero.titleAlign || 'start'} onChange={(v) => onChange({ titleAlign: v })}
                  options={[{ value: 'start', label: 'לצד ההתחלה' }, { value: 'center', label: 'למרכז' }]} />
              </Field>
              <Field label="מיקום אנכי">
                <Segmented value={hero.contentV || 'center'} onChange={(v) => onChange({ contentV: v })}
                  options={[{ value: 'top', label: 'למעלה' }, { value: 'center', label: 'מרכז' }, { value: 'bottom', label: 'למטה' }]} />
              </Field>
            </div>
          </div>
        </SettingsCard>

        {/* Info card */}
        <SettingsCard title="כרטיס פרטי מזמין" description="כרטיס זכוכית כהה עם פרטי הלקוח — הוכן עבור, ארגון, תאריך הפקה ומי הכין.">
          <div className="space-y-4 p-2 sm:p-3">
            <RowToggle label="הצג כרטיס" checked={cardEnabled} onChange={(v) => onChange({ cardEnabled: v })} />
            {cardEnabled && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="צבע הכרטיס"><ColorField value={hero.cardColor || '#081220'} onChange={(v) => onChange({ cardColor: v })} /></Field>
                  <Field label="עוצמת הכרטיס"><SliderField value={num(hero.cardOpacity, 70)} onChange={(v) => onChange({ cardOpacity: v })} unit="%" /></Field>
                </div>
                <Field label="עוצמת הזכוכית (טשטוש)">
                  <Segmented value={hero.cardBlur || 'md'} onChange={(v) => onChange({ cardBlur: v })}
                    options={[{ value: 'none', label: 'ללא' }, { value: 'sm', label: 'עדין' }, { value: 'md', label: 'בינוני' }, { value: 'lg', label: 'חזק' }]} />
                </Field>
                <div>
                  <span className={LABEL}>שדות מוצגים בכרטיס</span>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <CheckRow label="הוכן עבור" checked={cf.preparedFor !== false} onChange={(v) => onCardFields({ preparedFor: v })} />
                    <CheckRow label="ארגון" checked={cf.org !== false} onChange={(v) => onCardFields({ org: v })} />
                    <CheckRow label="הופק בתאריך" checked={cf.generatedOn !== false} onChange={(v) => onCardFields({ generatedOn: v })} />
                    <CheckRow label="הוכן על ידי" checked={cf.preparedBy !== false} onChange={(v) => onCardFields({ preparedBy: v })} />
                  </div>
                </div>
              </>
            )}
          </div>
        </SettingsCard>
      </div>

      {/* ── Live preview (reading-end) ── */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-3 sm:p-4">
          {/* preview toolbar — device + language */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white">
              {[['desktop', '🖥'], ['mobile', '📱']].map(([k, ic]) => (
                <button key={k} type="button" onClick={() => setDevice(k)}
                  className={`px-3 py-1.5 text-sm transition ${device === k ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>{ic}</button>
              ))}
            </div>
            <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white">
              {[['he', 'עברית'], ['en', 'English']].map(([code, lbl]) => (
                <button key={code} type="button" onClick={() => setPreviewLang(code)}
                  className={`px-3 py-1.5 text-[13px] font-medium transition ${previewLang === code ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>{lbl}</button>
              ))}
            </div>
          </div>

          {/* the cover — rendered with the SAME component the quote uses */}
          <div className={`mx-auto overflow-hidden rounded-2xl shadow-lg ring-1 ring-black/5 transition-all ${device === 'mobile' ? 'w-[390px] max-w-full' : 'w-full'}`}>
            <div dir={previewLang === 'en' ? 'ltr' : 'rtl'}>
              <HeroCover d={coverData} lang={previewLang} />
            </div>
          </div>

          {/* quick presets */}
          <div className="mt-4">
            <div className="mb-2 text-[12px] font-medium text-gray-500">תבניות עיצוב מהירות</div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button key={p.key} type="button" onClick={() => onChange(p.patch)}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] text-gray-700 shadow-sm transition hover:border-teal-300 hover:text-teal-700">
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <p className="mt-3 text-center text-[11px] text-gray-400">
            תצוגה חיה — פרטי הלקוח והתאריך הם דוגמה בלבד ואינם נשמרים.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Small, reliable controls (direction-agnostic) ────────────────────────────
const num = (v, def) => (typeof v === 'number' ? v : def);

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition ${
            value === o.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-teal-600' : 'bg-gray-300'}`}>
      <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ insetInlineStart: checked ? '1.375rem' : '0.125rem' }} />
    </button>
  );
}

function RowToggle({ label, checked, onChange }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13.5px] font-medium text-gray-700">{label}</span>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function CheckRow({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-gray-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded accent-teal-600" />
      {label}
    </label>
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

function SliderField({ value, onChange, min = 0, max = 100, unit = '%' }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1.5 flex-1 cursor-pointer accent-teal-600" />
      <span className="w-14 shrink-0 text-end text-[13px] tabular-nums text-gray-600">{value}{unit}</span>
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

// Configurable-title sections show their LIVE localized title (one source of
// truth), so a rename in the title card below is reflected in the list immediately.
function sectionLabel(key, sectionTitles) {
  const t = sectionTitles?.[key];
  if (t?.titleHe) return t.titleHe;
  return SECTION_LABELS[key] || key;
}

// ── Sections tab ─────────────────────────────────────────────────────────────
function SectionsTab({ sections, sectionTitles, onChange }) {
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
    <SettingsCard title="סעיפי ההצעה" description="גררו לשינוי הסדר. כבו סעיף כדי להסתיר אותו כברירת מחדל בכל ההצעות.">
      <div className="mx-2.5 mb-2 flex items-center gap-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/70 px-3 py-2.5">
        <span className="text-lg" aria-hidden>📄</span>
        <span className="flex-1 min-w-0 font-medium text-[15px] text-gray-900">{SECTION_LABELS.hero}</span>
        <span className="shrink-0 text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">כותרת המסמך — תמיד ראשונה</span>
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
              <span className={`flex-1 min-w-0 font-medium text-[15px] ${item.hidden ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                {sectionLabel(item.key, sectionTitles)}
              </span>
              {required ? (
                <span className="shrink-0 text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">חובה</span>
              ) : (
                <button onClick={() => toggle(item.key)} className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700">
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

// Editable localized titles for the configurable sections — THE one source of
// truth. The quote renderer (and, for "אז מה בתוכנית?", the Product Variant editor
// group) read these titles, so a rename here applies everywhere. Content itself
// lives with each section's owner (Product Variant / Pricing Builder), not here.
function SectionTitlesCard({ sectionTitles, onChange }) {
  const st = sectionTitles || {};
  return (
    <SettingsCard title="כותרות הסעיפים" description="מקור אמת יחיד לכותרות. התוכן עצמו נשאר במקומו (וריאציית מוצר / בונה התמחור).">
      <div className="space-y-3 p-2 sm:p-3">
        {TITLE_SECTIONS.map(({ key, label }) => {
          const t = st[key] || {};
          return (
            <div key={key} className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
              <div className="mb-2 text-[12px] font-semibold text-gray-500">{label}</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block"><span className={LABEL}>כותרת (עברית)</span>
                  <input value={t.titleHe || ''} onChange={(e) => onChange(key, { titleHe: e.target.value })} className={INPUT} /></label>
                <label className="block"><span className={LABEL}>Title (EN)</span>
                  <input value={t.titleEn || ''} onChange={(e) => onChange(key, { titleEn: e.target.value })} dir="ltr" className={INPUT} /></label>
              </div>
            </div>
          );
        })}
      </div>
    </SettingsCard>
  );
}

// Video tab — a small Video Library. Each video is its own entity (URL, optional
// He/En titles, assigned variants). A Product Variant belongs to at most ONE video:
// a variant already assigned elsewhere is simply EXCLUDED from a video's picker
// (not disabled, not warned). Self-contained (no Shared Content).
const newVideoId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID ? `vid_${crypto.randomUUID()}` : `vid_${Date.now().toString(36)}`);

function VideoTab({ videos, onChange }) {
  const list = Array.isArray(videos) ? videos : [];
  const [options, setOptions] = useState(null);
  useEffect(() => {
    let alive = true;
    api.products.variantOptions().then((o) => { if (alive) setOptions(Array.isArray(o) ? o : []); }).catch(() => { if (alive) setOptions([]); });
    return () => { alive = false; };
  }, []);

  const updateVideo = (id, patch) => onChange(list.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const removeVideo = (id) => onChange(list.filter((v) => v.id !== id));
  const addVideo = () => onChange([...list, { id: newVideoId(), url: '', titleHe: '', titleEn: '', variantIds: [] }]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-gray-500">ספריית סרטונים — כל סרטון מוצג רק בהצעות של הווריאציות שהוקצו לו. וריאציה שייכת לסרטון אחד בלבד.</p>
        <button type="button" onClick={addVideo} className="shrink-0 rounded-lg bg-teal-600 px-3 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-teal-700">+ סרטון</button>
      </div>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-400">
          אין עדיין סרטונים. לחצו “+ סרטון” כדי להוסיף.
        </div>
      ) : (
        list.map((video, i) => {
          // A variant assigned to ANOTHER video is excluded from this one's picker.
          const takenElsewhere = new Set(list.filter((x) => x.id !== video.id).flatMap((x) => x.variantIds || []));
          return (
            <VideoCard
              key={video.id}
              index={i}
              video={video}
              options={options}
              takenElsewhere={takenElsewhere}
              onPatch={(patch) => updateVideo(video.id, patch)}
              onRemove={() => removeVideo(video.id)}
            />
          );
        })
      )}
    </div>
  );
}

function VideoCard({ index, video, options, takenElsewhere, onPatch, onRemove }) {
  const v = video || {};
  const selected = Array.isArray(v.variantIds) ? v.variantIds : [];
  const embed = parseEmbedUrl(v.url || '');
  const urlInvalid = !!(v.url && !embed);

  function toggleVariant(id) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onPatch({ variantIds: next });
  }
  // Available = variants not claimed by another video (this video's own stay visible).
  const available = (options || []).filter((o) => !takenElsewhere.has(o.id));

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 pt-4 pb-3">
        <h3 className="text-[15px] font-semibold text-gray-900">סרטון {index + 1}</h3>
        <button type="button" onClick={onRemove} className="rounded-md px-2 py-1 text-[12px] font-medium text-red-600 hover:bg-red-50">מחק</button>
      </div>
      <div className="space-y-5 p-4">
        <div>
          <span className={LABEL}>קישור YouTube</span>
          <input value={v.url || ''} onChange={(e) => onPatch({ url: e.target.value })} dir="ltr" placeholder="https://www.youtube.com/watch?v=…"
            className={`${INPUT} ${urlInvalid ? 'border-red-300 focus:ring-red-200 focus:border-red-400' : ''}`} />
          {urlInvalid && <p className="mt-1 text-[11px] text-red-500">הקישור אינו קישור YouTube תקין.</p>}
          {embed && (
            <div className="mt-3 max-w-md overflow-hidden rounded-xl bg-black ring-1 ring-gray-200" style={{ aspectRatio: '16 / 9' }}>
              <iframe src={embed.embedUrl} title="preview" className="h-full w-full" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block"><span className={LABEL}>כותרת (עברית, אופציונלי)</span>
            <input value={v.titleHe || ''} onChange={(e) => onPatch({ titleHe: e.target.value })} placeholder="סרטון" className={INPUT} /></label>
          <label className="block"><span className={LABEL}>Title (EN, optional)</span>
            <input value={v.titleEn || ''} onChange={(e) => onPatch({ titleEn: e.target.value })} placeholder="Video" dir="ltr" className={INPUT} /></label>
        </div>

        <div>
          <span className={LABEL}>הצג בווריאציות</span>
          {options === null ? (
            <p className="text-[13px] text-gray-400">טוען…</p>
          ) : available.length === 0 ? (
            <p className="text-[13px] text-gray-400">אין וריאציות פנויות — כל הווריאציות כבר מוקצות לסרטונים אחרים.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {available.map((o) => {
                const on = selected.includes(o.id);
                const label = `${o.productNameHe || o.productNameEn} · ${o.locationNameHe || o.locationNameEn}`;
                return (
                  <button key={o.id} type="button" onClick={() => toggleVariant(o.id)}
                    className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition ${
                      on ? 'bg-teal-600 text-white shadow-sm' : 'border border-gray-200 bg-white text-gray-600 hover:border-teal-300'
                    }`}>
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          {selected.length > 0 && <p className="mt-2 text-[11px] text-gray-400">מוקצה ל-{selected.length} וריאציות.</p>}
        </div>
      </div>
    </section>
  );
}

// Images tab — a small Quote Image Library, same architecture as videos. Each image
// has a slot (מיקום 1 / מיקום 2), optional He/En captions and assigned variants. A
// variant belongs to at most ONE image PER SLOT: within a slot, a variant claimed by
// another image is EXCLUDED from this image's picker (not disabled, not warned) — but
// the same variant may be assigned in the other slot too. Media is template-owned.
const IMAGE_SLOT_OPTIONS = [
  { value: 'slot1', label: 'מיקום 1' },
  { value: 'slot2', label: 'מיקום 2' },
];
const newImageId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID ? `img_${crypto.randomUUID()}` : `img_${Date.now().toString(36)}`);

function ImagesTab({ images, onChange }) {
  const list = Array.isArray(images) ? images : [];
  const [options, setOptions] = useState(null);
  useEffect(() => {
    let alive = true;
    api.products.variantOptions().then((o) => { if (alive) setOptions(Array.isArray(o) ? o : []); }).catch(() => { if (alive) setOptions([]); });
    return () => { alive = false; };
  }, []);

  const updateImage = (id, patch) => onChange(list.map((im) => (im.id === id ? { ...im, ...patch } : im)));
  const removeImage = (id) => onChange(list.filter((im) => im.id !== id));
  const addImage = () => onChange([...list, { id: newImageId(), image: null, slot: 'slot1', captionHe: '', captionEn: '', variantIds: [] }]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-gray-500">ספריית תמונות — כל תמונה מוצגת רק בהצעות של הווריאציות שהוקצו לה, במיקום שנבחר. באותו מיקום, וריאציה שייכת לתמונה אחת בלבד.</p>
        <button type="button" onClick={addImage} className="shrink-0 rounded-lg bg-teal-600 px-3 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-teal-700">+ תמונה</button>
      </div>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-400">
          אין עדיין תמונות. לחצו “+ תמונה” כדי להוסיף.
        </div>
      ) : (
        list.map((image, i) => {
          // Excluded from THIS image's picker: variants claimed by ANOTHER image in
          // the SAME slot (different slots don't conflict).
          const takenElsewhere = new Set(
            list.filter((x) => x.id !== image.id && x.slot === image.slot).flatMap((x) => x.variantIds || []),
          );
          return (
            <ImageCard
              key={image.id}
              index={i}
              image={image}
              options={options}
              takenElsewhere={takenElsewhere}
              onPatch={(patch) => updateImage(image.id, patch)}
              onRemove={() => removeImage(image.id)}
            />
          );
        })
      )}
    </div>
  );
}

function ImageCard({ index, image, options, takenElsewhere, onPatch, onRemove }) {
  const im = image || {};
  const slot = im.slot || 'slot1';
  const selected = Array.isArray(im.variantIds) ? im.variantIds : [];

  function toggleVariant(id) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onPatch({ variantIds: next });
  }
  const available = (options || []).filter((o) => !takenElsewhere.has(o.id));
  const slotLabel = IMAGE_SLOT_OPTIONS.find((s) => s.value === slot)?.label || '';

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 pt-4 pb-3">
        <h3 className="text-[15px] font-semibold text-gray-900">תמונה {index + 1} · {slotLabel}{selected.length > 0 ? ` · ${selected.length} וריאציות` : ''}</h3>
        <button type="button" onClick={onRemove} className="rounded-md px-2 py-1 text-[12px] font-medium text-red-600 hover:bg-red-50">מחק</button>
      </div>
      <div className="space-y-5 p-4">
        <div>
          <span className={LABEL}>תמונה</span>
          <SingleImage
            image={im.image ? { url: im.image.url } : null}
            onChange={(mf) => onPatch({ image: mf ? { id: mf.id, url: mf.url } : null })}
            folder="quote/images"
          />
        </div>

        <Field label="מיקום בהצעה">
          <Segmented value={slot} onChange={(v) => onPatch({ slot: v })} options={IMAGE_SLOT_OPTIONS} />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block"><span className={LABEL}>כיתוב (עברית, אופציונלי)</span>
            <input value={im.captionHe || ''} onChange={(e) => onPatch({ captionHe: e.target.value })} className={INPUT} /></label>
          <label className="block"><span className={LABEL}>Caption (EN, optional)</span>
            <input value={im.captionEn || ''} onChange={(e) => onPatch({ captionEn: e.target.value })} dir="ltr" className={INPUT} /></label>
        </div>

        <div>
          <span className={LABEL}>הצג בווריאציות (במיקום {slotLabel})</span>
          {options === null ? (
            <p className="text-[13px] text-gray-400">טוען…</p>
          ) : available.length === 0 ? (
            <p className="text-[13px] text-gray-400">אין וריאציות פנויות במיקום זה — כולן כבר מוקצות לתמונות אחרות באותו מיקום.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {available.map((o) => {
                const on = selected.includes(o.id);
                const label = `${o.productNameHe || o.productNameEn} · ${o.locationNameHe || o.locationNameEn}`;
                return (
                  <button key={o.id} type="button" onClick={() => toggleVariant(o.id)}
                    className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition ${
                      on ? 'bg-teal-600 text-white shadow-sm' : 'border border-gray-200 bg-white text-gray-600 hover:border-teal-300'
                    }`}>
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
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
    <SettingsCard title="שדות הכרטיס הטכני" description="בחרו אילו פרטים יופיעו בכרטיס “פרטים טכניים” ובאיזה סדר. שדה ריק בדיל לא יוצג גם אם הוא פעיל.">
      <ReorderableList
        items={items}
        onReorder={reorder}
        emptyText="אין שדות."
        renderRow={(item, { handle }) => (
          <div className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 hover:bg-gray-50">
            {handle}
            <span className={`flex-1 min-w-0 font-medium text-[15px] ${item.visible ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
              {TECH_LABELS[item.key] || item.key}
            </span>
            <button onClick={() => toggle(item.key)} className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700">
              {item.visible ? 'הסתר' : 'הצג'}
            </button>
          </div>
        )}
      />
    </SettingsCard>
  );
}
