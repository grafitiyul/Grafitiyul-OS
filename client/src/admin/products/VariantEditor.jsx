import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useDirtyWhen, valuesEqual } from '../../lib/dirtyForms.js';
import RichEditor from '../../editor/RichEditor.jsx';
import { minorToInput, toMinor } from '../../lib/money.js';
import { durationDisplay } from '../../lib/duration.js';
import VariantSharedContent from './VariantSharedContent.jsx';
import VariantQuoteImages from './VariantQuoteImages.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// Product Variant editor — a dedicated, full-page CMS-style workspace.
//
// Three areas: LEFT navigation (logical groups) · CENTER editing workspace
// (one group of premium single-open accordions) · RIGHT sidebar (variant info +
// completion progress). This is a PURE presentation refactor of the fields that
// previously lived in ProductDetail's inline VariantForm — same data, same API
// (PUT /api/products/variants/:id), same field ownership. No business logic,
// schema, or API contract changed.
//
// Only sections backed by a real ProductVariant field are rendered. Quote-Builder
// concepts shown in the design mock (pricing text, quote video, payment terms)
// have NO variant column and are intentionally omitted — they are owned elsewhere.
// ─────────────────────────────────────────────────────────────────────────────

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

// Build the editable buffer from a variant. This is the ONLY shape saved back —
// identical to the legacy VariantForm payload, so the write contract is unchanged.
function makeBuffer(v) {
  return {
    marketingDescHe: v.marketingDescHe || '',
    marketingDescEn: v.marketingDescEn || '',
    guideDescHe: v.guideDescHe || '',
    guideDescEn: v.guideDescEn || '',
    programHe: v.programHe || '',
    programEn: v.programEn || '',
    durationHours: v.durationHours ?? '',
    baseGuidePayment: minorToInput(v.baseGuidePaymentMinor),
    travelPayment: minorToInput(v.travelPaymentMinor),
    availablePublic: v.availablePublic,
    availablePrivate: v.availablePrivate,
    availableBusiness: v.availableBusiness,
    active: v.active,
  };
}

// Rich HTML "has real text?" — strips tags/entities so an empty <p></p> counts as
// empty. Used for section-completion status only (never for saving).
function htmlHasText(html) {
  if (!html) return false;
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().length > 0;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

// ── Navigation groups (LEFT) — Hebrew-first workspace chrome ──────────────────
// NOTE: the "Marketing" group was removed. Its only field (marketingDescHe/En)
// actually DOES appear in the customer proposal as "פרטים על המוצר", so it now
// lives under Quote Content. A Marketing group returns only if a field is added
// that genuinely does NOT appear in the quote.
const GROUPS = [
  { key: 'quote', title: 'תוכן להצעת מחיר', desc: 'כל התוכן שמופיע בהצעת המחיר ללקוח.', icon: IconDoc },
  { key: 'guide', title: 'תוכן למדריך', desc: 'מידע פנימי בלבד שאינו מוצג ללקוח.', icon: IconUser },
  { key: 'operational', title: 'פרטים תפעוליים', desc: 'הגדרות המשפיעות על ביצוע הפעילות.', icon: IconGear },
  { key: 'advanced', title: 'הגדרות מתקדמות', desc: 'הגדרות שנדיר לערוך.', icon: IconSliders },
];

// ── Accordions (CENTER), grouped. `track` = counts toward completion. ─────────
// (title for the "program" section is overridden at runtime by the Quote
//  Structure title — one source of truth for that label.)
const SECTIONS = [
  { group: 'quote', key: 'program', title: 'אז מה בתוכנית?', sub: 'הטקסט שמופיע בראש ההצעה ללקוח', track: true },
  { group: 'quote', key: 'productDetails', title: 'פרטים על המוצר', sub: 'מופיע בהצעת המחיר', track: true },
  // Quote images are library REFERENCES (Quote Image Library) — the variant no
  // longer uploads/owns image files. Replaced the old per-variant gallery.
  { group: 'quote', key: 'quoteImages', title: 'תמונות בהצעה', sub: 'בחירת תמונות מהספרייה לכל מיקום בהצעה', track: true },
  { group: 'guide', key: 'guideDesc', title: 'תיאור למדריך', sub: 'פנימי בלבד — לא נחשף ללקוח', track: true },
  { group: 'operational', key: 'duration', title: 'משך הסיור', sub: 'זמן משוער בשעות', track: true },
  { group: 'operational', key: 'shared', title: 'נקודת מפגש וסיום', sub: 'תוכן תפעולי מתוך הספרייה המשותפת', track: false },
  { group: 'operational', key: 'availability', title: 'זמינות לפי פורמט', sub: 'באילו פורמטים הוריאציה נמכרת', track: false },
  { group: 'operational', key: 'guidePay', title: 'תשלום למדריך', sub: 'תשלום בסיס ותשלום נסיעות', track: true },
  { group: 'advanced', key: 'status', title: 'סטטוס וניהול', sub: 'הפעלה / השבתה ומחיקת הוריאציה', track: false },
];

export default function VariantEditor() {
  const { id, variantId } = useParams();
  const navigate = useNavigate();

  const [product, setProduct] = useState(null);
  const [variant, setVariant] = useState(null);
  const [locations, setLocations] = useState([]);
  const [programTitle, setProgramTitle] = useState({ he: 'אז מה בתוכנית?', en: "What's in the program?" });
  // Image-slot section titles (Quote Structure is the source of truth) — used as
  // the position labels in the "תמונות בהצעה" section.
  const [slotTitles, setSlotTitles] = useState({ slot1: 'תמונה — מיקום 1', slot2: 'תמונה — מיקום 2' });
  const [form, setForm] = useState(null);
  const [original, setOriginal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [activeGroup, setActiveGroup] = useState('quote');
  const [openKey, setOpenKey] = useState('program'); // single-open accordion
  const inited = useRef(false);

  const productPath = `/admin/settings/crm/products/${id}`;

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [p, locs, template] = await Promise.all([
        api.products.get(id),
        api.locations.list(),
        api.quoteTemplate.get().catch(() => null),
      ]);
      const v = p?.variants?.find((x) => x.id === variantId);
      if (!v) { setError('הוריאציה לא נמצאה'); return; }
      setProduct(p);
      setVariant(v);
      setLocations(locs);
      const pt = template?.sectionTitles?.program;
      if (pt) setProgramTitle({ he: pt.titleHe, en: pt.titleEn });
      const s1 = template?.sectionTitles?.image_slot_1?.titleHe;
      const s2 = template?.sectionTitles?.image_slot_2?.titleHe;
      if (s1 || s2) setSlotTitles((t) => ({ slot1: s1 || t.slot1, slot2: s2 || t.slot2 }));
      // Init the editable buffer ONCE — later refreshes (gallery / shared-content
      // saves) must NOT clobber in-progress rich-text edits in the buffer.
      if (!inited.current) {
        const buf = makeBuffer(v);
        setForm(buf);
        setOriginal(buf);
        inited.current = true;
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id, variantId]);

  useEffect(() => { refresh(); }, [refresh]);

  const dirty = !!form && !!original && !valuesEqual(form, original);
  useDirtyWhen(form, original, { active: !!form && !!original });

  function set(field, v) { setForm((f) => ({ ...f, [field]: v })); }

  function selectGroup(g) {
    setActiveGroup(g);
    const first = SECTIONS.find((s) => s.group === g);
    setOpenKey(first ? first.key : null);
  }
  function toggle(key) { setOpenKey((k) => (k === key ? null : key)); }

  async function save() {
    setSaving(true);
    try {
      await api.products.updateVariant(variantId, {
        marketingDescHe: form.marketingDescHe,
        marketingDescEn: form.marketingDescEn,
        guideDescHe: form.guideDescHe,
        guideDescEn: form.guideDescEn,
        programHe: form.programHe,
        programEn: form.programEn,
        durationHours: form.durationHours === '' ? null : Number(form.durationHours),
        baseGuidePaymentMinor: toMinor(form.baseGuidePayment) ?? 0,
        travelPaymentMinor: toMinor(form.travelPayment),
        availablePublic: form.availablePublic,
        availablePrivate: form.availablePrivate,
        availableBusiness: form.availableBusiness,
        active: form.active,
      });
      setOriginal(form); // clears dirty immediately
      await refresh();   // syncs updatedAt + relation-backed sections
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    } finally {
      setSaving(false);
    }
  }

  function cancel() { if (original) setForm(original); }

  function goBack() {
    if (dirty && !confirm('יש שינויים שלא נשמרו. לצאת בלי לשמור?')) return;
    navigate(productPath);
  }

  async function remove() {
    if (!confirm(`למחוק את הוריאציה של "${variant.location?.nameHe}"?`)) return;
    try {
      await api.products.removeVariant(variantId);
      navigate(productPath);
    } catch (e) {
      if (e.payload?.error === 'last_variant')
        alert('לא ניתן למחוק את הוריאציה האחרונה. למוצר חייב להיות לפחות מיקום אחד — הוסיפו מיקום נוסף קודם, או מחקו את המוצר כולו.');
      else alert('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">טוען…</div>;
  if (error) return (
    <div className="p-8">
      <button onClick={() => navigate(productPath)} className="text-sm text-blue-600 hover:underline">→ חזרה למוצר</button>
      <div className="mt-4 text-sm text-red-600">שגיאה: {error}</div>
    </div>
  );
  if (!product || !variant || !form) return null;

  // ── Section completion (drives nav dots + right checklist) ──
  const done = {
    program: htmlHasText(form.programHe) || htmlHasText(form.programEn),
    // "פרטים על המוצר" — the marketingDesc* columns, which DO appear in the quote.
    productDetails: htmlHasText(form.marketingDescHe) || htmlHasText(form.marketingDescEn),
    quoteImages: (variant.quoteImageLinks?.length || 0) > 0,
    guideDesc: htmlHasText(form.guideDescHe) || htmlHasText(form.guideDescEn),
    duration: form.durationHours !== '' && Number(form.durationHours) > 0,
    guidePay: (toMinor(form.baseGuidePayment) ?? 0) > 0,
  };
  const tracked = SECTIONS.filter((s) => s.track);
  const doneCount = tracked.filter((s) => done[s.key]).length;
  const pct = tracked.length ? Math.round((doneCount / tracked.length) * 100) : 0;

  function groupStatus(g) {
    const secs = SECTIONS.filter((s) => s.group === g && s.track);
    if (secs.length === 0) return 'none';
    const d = secs.filter((s) => done[s.key]).length;
    if (d === 0) return 'empty';
    if (d === secs.length) return 'complete';
    return 'progress';
  }

  const saveState = saving ? 'saving' : dirty ? 'dirty' : 'saved';
  const variantTitle = product.nameHe || product.nameEn || 'וריאציה';
  const variantSub = variant.location?.nameHe || variant.location?.nameEn || '';

  return (
    <div className="min-h-full bg-gray-50/70" dir="rtl">
      {/* ── Sticky header ─────────────────────────────────────────────── */}
      {/* RTL note: the workspace is Hebrew (dir=rtl) but its physical arrangement
          mirrors the design target — identity + back on the RIGHT, save controls
          on the LEFT, nav rail on the far LEFT. We order DOM children so RTL flow
          lands each block on its intended physical side. */}
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="flex items-center gap-4 px-5 py-3 lg:px-8">
          {/* Identity + back — first child ⇒ renders on the RIGHT in RTL */}
          <div className="text-right">
            <button onClick={goBack} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-gray-400 transition hover:text-gray-700">
              <span aria-hidden>→</span> חזרה למוצר
            </button>
            <div className="mt-0.5 flex items-center gap-2">
              <h1 className="text-[19px] font-bold leading-tight text-gray-900">{variantTitle}</h1>
              <StatusPill active={form.active} />
            </div>
            {variantSub && <div className="mt-0.5 text-[13px] text-gray-500">וריאנט: {variantSub}</div>}
          </div>

          <div className="flex-1" />

          {/* Save cluster — last child ⇒ renders on the LEFT in RTL */}
          <div className="flex items-center gap-2">
            <SaveBadge state={saveState} />
            <button
              onClick={cancel}
              disabled={!dirty || saving}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-40"
            >
              ביטול
            </button>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-default disabled:opacity-40"
            >
              <IconSave />
              {saving ? 'שומר…' : 'שמור שינויים'}
            </button>
          </div>
        </div>
      </header>

      {/* ── 3-pane workspace ──────────────────────────────────────────── */}
      {/* DOM order [info, center, nav] ⇒ in RTL: info RIGHT, center MIDDLE, nav LEFT. */}
      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[312px_minmax(0,1fr)_248px] lg:px-8">
        {/* RIGHT — info + progress */}
        <aside className="order-3 space-y-4 lg:order-1 lg:sticky lg:top-[84px] lg:self-start">
          <Panel title="מידע כללי על הוריאנט">
            <InfoRow label="מזהה וריאנט" value={<code className="text-[11px] text-gray-500">{variant.id.slice(0, 10)}…</code>} />
            <InfoRow label="מוצר ראשי" value={variantTitle} />
            <InfoRow label="מיקום" value={variantSub || '—'} />
            <InfoRow label="סטטוס" value={<StatusPill active={form.active} />} />
            <InfoRow label="נוצר בתאריך" value={formatDate(variant.createdAt)} />
            <InfoRow label="עודכן לאחרונה" value={formatDate(variant.updatedAt)} />
          </Panel>

          <Panel title="סטטוס השלמה">
            <div className="flex items-center gap-4">
              <ProgressRing pct={pct} />
              <div className="text-[13px] text-gray-600">
                <div className="font-semibold text-gray-900">{doneCount} מתוך {tracked.length} סעיפים</div>
                <div className="text-gray-500">הושלמו</div>
              </div>
            </div>
            <ul className="mt-4 space-y-2">
              {tracked.map((s) => (
                <li key={s.key} className="flex items-center gap-2 text-[13px]">
                  {done[s.key]
                    ? <IconCheckCircle className="text-emerald-500" />
                    : <span className="inline-block h-4 w-4 rounded-full border-2 border-gray-300" />}
                  <span className={done[s.key] ? 'text-gray-700' : 'text-gray-400'}>
                    {s.key === 'program' ? (programTitle.he || s.title) : s.title}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>

        {/* CENTER — editing workspace */}
        <main className="order-2 min-w-0 space-y-4">
          <GroupHeading group={GROUPS.find((g) => g.key === activeGroup)} />
          {SECTIONS.filter((s) => s.group === activeGroup).map((s) => (
            <Accordion
              key={s.key}
              title={s.key === 'program' ? (programTitle.he || s.title) : s.title}
              sub={s.sub}
              open={openKey === s.key}
              onToggle={() => toggle(s.key)}
              status={s.track ? (done[s.key] ? 'complete' : 'empty') : 'none'}
            >
              <SectionBody
                k={s.key}
                form={form}
                set={set}
                variant={variant}
                locations={locations}
                programTitle={programTitle}
                slotTitles={slotTitles}
                onRelationChange={refresh}
                onRemove={remove}
              />
            </Accordion>
          ))}
        </main>

        {/* LEFT — dark navigation rail (far physical-left in RTL) */}
        <nav className="order-1 rounded-2xl bg-[#0f1e30] p-3 lg:order-3 lg:sticky lg:top-[84px] lg:self-start">
          <div className="mb-3 px-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">עריכת וריאנט</div>
          <ul className="space-y-1.5">
            {GROUPS.map((g) => (
              <NavItem
                key={g.key}
                group={g}
                selected={activeGroup === g.key}
                status={groupStatus(g.key)}
                onClick={() => selectGroup(g.key)}
              />
            ))}
          </ul>
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-[12px] leading-relaxed text-slate-300">
            <div className="mb-1 font-semibold text-slate-200">💡 טיפ</div>
            לחיצה על סעיף פותחת אותו. רק סעיף אחד פתוח בכל רגע. השינויים נשמרים בלחיצה על "שמור שינויים".
          </div>
        </nav>
      </div>
    </div>
  );
}

// ── Section bodies ───────────────────────────────────────────────────────────
function SectionBody({ k, form, set, variant, locations, programTitle, slotTitles, onRelationChange, onRemove }) {
  switch (k) {
    case 'program':
      return <BiEditor he={form.programHe} en={form.programEn} onHe={(h) => set('programHe', h)} onEn={(h) => set('programEn', h)} minH={150} />;
    case 'productDetails':
      return <BiEditor he={form.marketingDescHe} en={form.marketingDescEn} onHe={(h) => set('marketingDescHe', h)} onEn={(h) => set('marketingDescEn', h)} minH={150} />;
    case 'quoteImages':
      return <VariantQuoteImages variant={variant} slotTitles={slotTitles} onChanged={onRelationChange} />;
    case 'guideDesc':
      return <BiEditor he={form.guideDescHe} en={form.guideDescEn} onHe={(h) => set('guideDescHe', h)} onEn={(h) => set('guideDescEn', h)} minH={130} />;
    case 'duration':
      return (
        <div className="max-w-xs">
          <Field label="משך (שעות)">
            <input value={form.durationHours} onChange={(e) => set('durationHours', e.target.value)} inputMode="decimal" dir="ltr" placeholder="2.5" className={INPUT} />
            {form.durationHours !== '' && <div className="mt-1 text-[12px] text-gray-500">{durationDisplay(form.durationHours)}</div>}
          </Field>
        </div>
      );
    case 'shared':
      return <VariantSharedContent variant={variant} locations={locations} />;
    case 'availability':
      return (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Check label="קבוצתי" checked={form.availablePublic} onChange={(c) => set('availablePublic', c)} />
          <Check label="פרטי" checked={form.availablePrivate} onChange={(c) => set('availablePrivate', c)} />
          <Check label="עסקי" checked={form.availableBusiness} onChange={(c) => set('availableBusiness', c)} />
        </div>
      );
    case 'guidePay':
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="תשלום בסיס למדריך (₪)"><input value={form.baseGuidePayment} onChange={(e) => set('baseGuidePayment', e.target.value)} inputMode="decimal" dir="ltr" className={INPUT} /></Field>
          <Field label="תשלום נסיעות (₪, אופציונלי)"><input value={form.travelPayment} onChange={(e) => set('travelPayment', e.target.value)} inputMode="decimal" dir="ltr" className={INPUT} /></Field>
        </div>
      );
    case 'status':
      return (
        <div className="space-y-4">
          <Check label="וריאציה פעילה" checked={form.active} onChange={(c) => set('active', c)} />
          <div className="border-t border-gray-100 pt-4">
            <div className="mb-1 text-[13px] font-medium text-gray-700">אזור מסוכן</div>
            <p className="mb-3 text-[12px] text-gray-500">מחיקת הוריאציה היא פעולה בלתי הפיכה. לא ניתן למחוק את הוריאציה האחרונה של מוצר.</p>
            <button onClick={onRemove} className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 transition hover:bg-red-50">מחק וריאציה</button>
          </div>
        </div>
      );
    default:
      return null;
  }
}

// ── Composed atoms ───────────────────────────────────────────────────────────
function BiEditor({ he, en, onHe, onEn, heLabel = 'עברית', enLabel = 'English', minH = 140 }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Field label={heLabel}>
        <RichEditor value={he} onChange={onHe} minContentHeight={minH} ariaLabel={heLabel} />
      </Field>
      <Field label={enLabel} ltr>
        <div dir="ltr"><RichEditor value={en} onChange={onEn} minContentHeight={minH} ariaLabel={enLabel} placeholder="Write here..." /></div>
      </Field>
    </div>
  );
}

function GroupHeading({ group }) {
  if (!group) return null;
  const Icon = group.icon;
  return (
    <div className="mb-1 flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Icon /></span>
      <div>
        <div className="text-[17px] font-bold text-gray-900">{group.title}</div>
        <div className="text-[12.5px] text-gray-500">{group.desc}</div>
      </div>
    </div>
  );
}

function NavItem({ group, selected, status, onClick }) {
  const Icon = group.icon;
  return (
    <li>
      <button
        onClick={onClick}
        aria-current={selected ? 'true' : undefined}
        className={
          'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-right transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ' +
          (selected ? 'bg-emerald-50 shadow-sm' : 'hover:bg-white/[0.06]')
        }
      >
        <span className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ' + (selected ? 'bg-emerald-100 text-emerald-700' : 'bg-white/[0.06] text-slate-400 group-hover:text-slate-200')}>
          <Icon />
        </span>
        <span className="min-w-0 flex-1">
          <span className={'block truncate text-[14px] font-semibold ' + (selected ? 'text-slate-900' : 'text-slate-100')}>{group.title}</span>
          <span className={'block truncate text-[11.5px] ' + (selected ? 'text-emerald-700/70' : 'text-slate-400')}>{group.desc}</span>
        </span>
        <StatusDot status={status} dark={!selected} />
      </button>
    </li>
  );
}

function Accordion({ title, sub, status, open, onToggle, children }) {
  return (
    <section className={'overflow-hidden rounded-2xl border bg-white transition ' + (open ? 'border-gray-200 shadow-sm' : 'border-gray-200/70')}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-5 py-4 text-right">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[15px] font-semibold text-gray-900">{title}</span>
            {status !== 'none' && <StatusChip complete={status === 'complete'} />}
          </span>
          {sub && <span className="mt-0.5 block text-[12.5px] text-gray-500">{sub}</span>}
        </span>
        <ChevronIcon open={open} />
      </button>
      {open && <div className="border-t border-gray-100 px-5 py-5">{children}</div>}
    </section>
  );
}

function Panel({ title, children }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-[13px] font-semibold text-gray-900">{title}</h3>
      {children}
    </section>
  );
}
function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-50 py-1.5 last:border-0">
      <span className="text-[12px] text-gray-400">{label}</span>
      <span className="text-[13px] font-medium text-gray-800">{value}</span>
    </div>
  );
}
function Field({ label, children, ltr }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={'text-[11.5px] font-medium text-gray-500 ' + (ltr ? 'text-left' : '')}>{label}</label>
      {children}
    </div>
  );
}
function Check({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-[14px] text-gray-700">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-400" />
      {label}
    </label>
  );
}

// ── Status visuals ───────────────────────────────────────────────────────────
function SaveBadge({ state }) {
  if (state === 'saving') return <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-[12px] font-medium text-blue-600">שומר…</span>;
  if (state === 'dirty') return <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-[12px] font-medium text-amber-700"><span className="h-2 w-2 rounded-full bg-amber-500" />שינויים לא נשמרו</span>;
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[12px] font-medium text-emerald-700"><IconCheckCircle className="text-emerald-500" />נשמר</span>;
}
function StatusPill({ active }) {
  return active
    ? <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">פעיל</span>
    : <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-semibold text-gray-500 ring-1 ring-inset ring-gray-200">לא פעיל</span>;
}
function StatusChip({ complete }) {
  return complete
    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">נשמר</span>
    : <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10.5px] font-semibold text-gray-400">ריק</span>;
}
function StatusDot({ status, dark }) {
  if (status === 'none') return null;
  if (status === 'complete') return <IconCheckCircle className="text-emerald-500" />;
  if (status === 'progress') return <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />;
  return <span className={'h-2.5 w-2.5 rounded-full border-2 ' + (dark ? 'border-slate-600' : 'border-gray-300')} />;
}
function ProgressRing({ pct }) {
  const r = 26, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#e5e7eb" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke="#10b981" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-bold text-gray-900">{pct}%</span>
    </div>
  );
}

// ── Icons (inline, no deps) ──────────────────────────────────────────────────
function ChevronIcon({ open }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={'shrink-0 text-gray-400 transition-transform ' + (open ? 'rotate-180' : '')}><polyline points="6 9 12 15 18 9" /></svg>;
}
function IconCheckCircle({ className = '' }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={'shrink-0 ' + className}><circle cx="12" cy="12" r="10" /><polyline points="8 12 11 15 16 9" /></svg>;
}
function IconSave() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>;
}
function IconDoc() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>;
}
function IconUser() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
}
function IconGear() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
}
function IconSliders() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>;
}
