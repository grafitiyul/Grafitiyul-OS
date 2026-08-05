import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import ReorderableList from '../common/ReorderableList.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import BackButton from '../common/BackButton.jsx';
import { SECTION_EDITORS, Field, TextInput, Bilingual } from './SectionEditors.jsx';
import {
  SECTION_TYPES, PAGE_TYPES, makeSection, newId, normalizeDocument,
  listBilingualFields, englishCompleteness, setAtPath,
} from '../../../../shared/sitePage.mjs';
import { forceBlockDirection } from '../../../../shared/textDirection.mjs';

const hasText = (v) =>
  !!v && String(v).replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '') !== '';

// The structured page editor. Explicit save (no auto-save): publishing is a
// deliberate act here and a half-typed sentence must never become the live page,
// so the draft is saved when the operator says so — matching the documents and
// communication editors, not the notes composer.

const TABS = [
  { key: 'content', label: 'תוכן' },
  { key: 'seo', label: 'SEO' },
  { key: 'versions', label: 'היסטוריה' },
];

export default function SitePageEditor() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [page, setPage] = useState(null);
  const [doc, setDoc] = useState(null);
  const [meta, setMeta] = useState({ internalName: '', pageType: 'info', slug: '', defaultLanguage: 'he' });
  const [tab, setTab] = useState('content');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [preview, setPreview] = useState(null); // { html, locale, device }
  const [openSection, setOpenSection] = useState(null);
  const [drift, setDrift] = useState([]); // pricing rows whose live card moved
  const [bulk, setBulk] = useState(null); // bulk-translate progress/summary
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    const { page: p } = await api.sitePages.get(id);
    setPage(p);
    const d = normalizeDocument(p.draft);
    setDoc(d);
    setMeta({ internalName: p.internalName, pageType: p.pageType, slug: p.slug, defaultLanguage: p.defaultLanguage || 'he' });
    setDirty(false);
    loadedRef.current = true;
    // Drift is advisory: a failure to compute it must never block editing.
    if (d.sections.some((s) => s.type === 'pricing')) {
      api.sitePages.pricingDrift(id).then((r) => setDrift(r.rows || [])).catch(() => setDrift([]));
    } else {
      setDrift([]);
    }
  }, [id]);

  useEffect(() => { load().catch((e) => setError(String(e.message || e))); }, [load]);

  // Warn before leaving with unsaved work — the draft is the operator's only copy.
  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const update = (nextDoc) => { setDoc(nextDoc); setDirty(true); };
  const updateMeta = (patch) => { setMeta((m) => ({ ...m, ...patch })); setDirty(true); };

  async function save() {
    setSaving(true); setError(null);
    try {
      const { page: p } = await api.sitePages.save(id, { document: doc, ...meta });
      setPage(p); setDirty(false); setSavedAt(new Date());
    } catch (e) {
      setError(e?.payload?.error === 'slug_taken' ? 'הכתובת (slug) כבר תפוסה בעמוד אחר.' : String(e.message || e));
    } finally { setSaving(false); }
  }

  async function publish() {
    setSaving(true); setError(null);
    try {
      if (dirty) await api.sitePages.save(id, { document: doc, ...meta });
      await api.sitePages.publish(id, {});
      await load();
    } catch (e) { setError(String(e.message || e)); } finally { setSaving(false); }
  }

  async function openPreview(locale = 'he', device = 'desktop') {
    const { html } = await api.sitePages.preview(id, doc, locale);
    setPreview({ html, locale, device });
  }

  /**
   * "תרגם את כל החוסרים לאנגלית" — fills ONLY empty English fields, section by
   * section, through the same /api/translate service as the per-field button.
   * Never overwrites existing English, never saves: the page stays dirty for
   * operator review, exactly like a manual edit.
   */
  async function translateMissing() {
    const all = listBilingualFields(doc);
    const targets = all.filter((f) => hasText(f.he) && !hasText(f.en));
    const skipped = all.filter((f) => hasText(f.he) && hasText(f.en)).length;
    setBulk({ running: targets.length > 0, done: 0, total: targets.length, translated: 0, skipped, failed: [] });
    let translated = 0;
    const failed = [];
    for (const f of targets) {
      try {
        const out = await api.translate.field({ content: f.he, direction: 'he_to_en', format: f.kind });
        const content = f.kind === 'html' ? forceBlockDirection(out.content, 'ltr') : out.content;
        setDoc((prev) => setAtPath(prev, f.enPath, content));
        setDirty(true);
        translated += 1;
      } catch {
        failed.push(f.label);
      }
      setBulk((b) => ({ ...b, done: (b?.done || 0) + 1, translated, failed: [...failed] }));
    }
    setBulk((b) => ({ ...b, running: false }));
  }

  const sections = doc?.sections || [];
  const setSections = (next) => update({ ...doc, sections: next });

  const publishedBadge = useMemo(() => {
    if (!page) return null;
    if (page.status !== 'published') return { text: 'טיוטה — לא מפורסם', cls: 'bg-slate-100 text-slate-600' };
    if (page.draftDirty) return { text: 'יש שינויים שלא פורסמו', cls: 'bg-amber-100 text-amber-800' };
    return { text: 'מפורסם ומעודכן', cls: 'bg-emerald-100 text-emerald-800' };
  }, [page]);

  const english = useMemo(() => (doc ? englishCompleteness(doc) : { done: 0, total: 0 }), [doc]);

  if (error && !page) return <div className="p-6 text-rose-600">{error}</div>;
  if (!doc || !page) return <div className="p-6 text-slate-500">טוען…</div>;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-24 pt-4" dir="rtl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <BackButton to="/admin/site-pages" />
        <div className="flex-1 min-w-[220px]">
          <input
            className="w-full bg-transparent text-2xl font-semibold text-slate-900 outline-none"
            value={meta.internalName}
            onChange={(e) => updateMeta({ internalName: e.target.value })}
            aria-label="שם פנימי"
          />
          <p className="text-xs text-slate-400">
            שם פנימי — לא מוצג באתר. כתובת: <span dir="ltr">/{meta.slug}/</span>
          </p>
        </div>
        {publishedBadge ? (
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${publishedBadge.cls}`}>{publishedBadge.text}</span>
        ) : null}
      </div>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t.key ? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      {/* English completeness + the page-level translation action. Honest by
          construction: the count comes from the same walker the bulk action
          uses, over VISIBLE content only. */}
      {tab === 'content' && english.total > 0 ? (
        <div className={`mb-4 rounded-xl border p-3 ${english.done < english.total ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`text-sm font-medium ${english.done < english.total ? 'text-amber-900' : 'text-emerald-900'}`}>
              תוכן אנגלי: {english.done} מתוך {english.total} שדות הושלמו
            </span>
            {english.done < english.total ? (
              <span className="text-xs text-amber-800">
                הגרסה האנגלית לא מציגה עברית — שדות חסרים פשוט לא יופיעו (ועמוד ריק יציג "coming soon").
              </span>
            ) : (
              <span className="text-xs text-emerald-800">כל השדות הגלויים מתורגמים.</span>
            )}
            <div className="flex-1" />
            <button
              type="button"
              disabled={bulk?.running || english.done >= english.total}
              onClick={translateMissing}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
            >
              {bulk?.running ? `מתרגם… ${bulk.done}/${bulk.total}` : '✨ תרגם את כל החוסרים לאנגלית'}
            </button>
          </div>
          {bulk?.running ? (
            <p className="mt-2 text-xs text-amber-800">
              מתרגם שדה-אחר-שדה — אל תשנו את מבנה העמוד (הוספה/מחיקה/סדר) עד לסיום. שום דבר לא נשמר אוטומטית.
            </p>
          ) : null}
          {bulk && !bulk.running ? (
            <p className="mt-2 text-xs text-slate-700">
              סיכום תרגום: תורגמו {bulk.translated} · דולגו {bulk.skipped} (קיים תרגום) · נכשלו {bulk.failed.length}
              {bulk.failed.length ? ` (${bulk.failed.slice(0, 5).join(', ')}${bulk.failed.length > 5 ? '…' : ''})` : ''}
              {' — '}בדקו את התוצאה ולחצו שמירת טיוטה.
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === 'content' ? (
        <>
          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="סוג עמוד">
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={meta.pageType}
                  onChange={(e) => updateMeta({ pageType: e.target.value })}
                >
                  {PAGE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="כתובת בעמוד (slug)" hint="החלק שאחרי הדומיין. שינוי כתובת מחייב הפניה 301 באתר.">
                <TextInput value={meta.slug} onChange={(v) => updateMeta({ slug: v })} dir="ltr" />
              </Field>
              <Field label="שפת ברירת מחדל" hint="השפה שבה העמוד הציבורי נפתח כשאין בחירה מפורשת בכתובת.">
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={meta.defaultLanguage}
                  onChange={(e) => updateMeta({ defaultLanguage: e.target.value })}
                >
                  <option value="he">עברית</option>
                  <option value="en">English</option>
                </select>
              </Field>
              <Field label="כותרת העמוד (עברית)">
                <TextInput value={doc.titleHe} onChange={(v) => update({ ...doc, titleHe: v })} dir="rtl" />
              </Field>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-500">{sections.length} מקטעים</span>
            <div className="flex-1" />
            {SECTION_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs hover:border-slate-400"
                onClick={() => {
                  const s = makeSection(t.key);
                  setSections([...sections, s]);
                  setOpenSection(s.id);
                }}
              >
                {t.glyph} {t.label}
              </button>
            ))}
          </div>

          <ReorderableList
            items={sections}
            emptyText="העמוד ריק. הוסיפו מקטע מהכפתורים למעלה."
            onReorder={(ids) => setSections(ids.map((sid) => sections.find((s) => s.id === sid)))}
            renderRow={(section) => {
              const t = SECTION_TYPES.find((x) => x.key === section.type);
              const Editor = SECTION_EDITORS[section.type];
              const open = openSection === section.id;
              const title =
                section.headingHe || section.titleHe || (t ? t.label : section.type);
              return (
                <div className={`rounded-xl border ${section.hidden ? 'border-dashed border-slate-300 bg-slate-50' : 'border-slate-200 bg-white'}`}>
                  <div className="flex items-center gap-2 p-3">
                    <span className="cursor-grab select-none text-slate-400" title="גררו לשינוי סדר">⠿</span>
                    <button
                      type="button"
                      className="flex-1 text-right text-sm font-medium text-slate-800"
                      onClick={() => setOpenSection(open ? null : section.id)}
                    >
                      <span className="ml-2 text-slate-400">{t?.glyph}</span>
                      {title}
                      {section.cards ? <span className="mr-2 text-xs text-slate-400">({section.cards.length})</span> : null}
                      {section.rows ? <span className="mr-2 text-xs text-slate-400">({section.rows.length})</span> : null}
                      {drift.some((d) => d.sectionId === section.id && d.status !== 'match') ? (
                        <span className="mr-2 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-800">מחירון השתנה</span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="text-xs text-slate-500 hover:text-slate-800"
                      onClick={() => {
                        const copy = JSON.parse(JSON.stringify(section));
                        copy.id = newId('sec');
                        if (copy.cards) copy.cards = copy.cards.map((c) => ({ ...c, id: newId('card') }));
                        if (copy.items) copy.items = copy.items.map((i) => ({ ...i, id: newId('faq') }));
                        if (copy.rows) copy.rows = copy.rows.map((r) => ({
                          ...r,
                          id: newId('pr'),
                          lines: (r.lines || []).map((l) => ({ ...l, id: newId('pl') })),
                        }));
                        const i = sections.findIndex((s) => s.id === section.id);
                        setSections([...sections.slice(0, i + 1), copy, ...sections.slice(i + 1)]);
                      }}
                    >
                      שכפול
                    </button>
                    <button
                      type="button"
                      className="text-xs text-slate-500 hover:text-slate-800"
                      onClick={() => setSections(sections.map((s) => (s.id === section.id ? { ...s, hidden: !s.hidden } : s)))}
                    >
                      {section.hidden ? 'הצג' : 'הסתר'}
                    </button>
                    <button
                      type="button"
                      className="text-xs text-rose-600 hover:text-rose-800"
                      onClick={() =>
                        setConfirm({
                          title: 'למחוק את המקטע?',
                          body: `"${title}" יימחק מהטיוטה. הגרסה המפורסמת לא משתנה עד הפרסום הבא.`,
                          onConfirm: () => setSections(sections.filter((s) => s.id !== section.id)),
                        })
                      }
                    >
                      מחיקה
                    </button>
                  </div>
                  {open && Editor ? (
                    <div className="border-t border-slate-100 p-4">
                      <Editor
                        section={section}
                        drift={drift.filter((d) => d.sectionId === section.id)}
                        onChange={(next) => setSections(sections.map((s) => (s.id === section.id ? next : s)))}
                      />
                    </div>
                  ) : null}
                </div>
              );
            }}
          />
        </>
      ) : null}

      {tab === 'seo' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <Bilingual
            label="כותרת SEO"
            he={doc.seo.titleHe}
            en={doc.seo.titleEn}
            onHe={(v) => update({ ...doc, seo: { ...doc.seo, titleHe: v } })}
            onEn={(v) => update({ ...doc, seo: { ...doc.seo, titleEn: v } })}
          />
          <Bilingual
            label="תיאור מטא"
            he={doc.seo.descriptionHe}
            en={doc.seo.descriptionEn}
            onHe={(v) => update({ ...doc, seo: { ...doc.seo, descriptionHe: v } })}
            onEn={(v) => update({ ...doc, seo: { ...doc.seo, descriptionEn: v } })}
          />
          <Field label="Canonical URL" hint="הכתובת הרשמית של העמוד. חייבת להיות זהה לכתובת שבה העמוד מוגש.">
            <TextInput
              value={doc.seo.canonicalUrl}
              onChange={(v) => update({ ...doc, seo: { ...doc.seo, canonicalUrl: v } })}
              dir="ltr"
            />
          </Field>
          <label className="mb-4 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={!!doc.seo.noindex}
              onChange={(e) => update({ ...doc, seo: { ...doc.seo, noindex: e.target.checked } })}
            />
            אל תאפשר למנועי חיפוש להציג את העמוד (noindex)
          </label>
          <Bilingual
            label="Open Graph — כותרת"
            he={doc.seo.ogTitleHe}
            en={doc.seo.ogTitleEn}
            onHe={(v) => update({ ...doc, seo: { ...doc.seo, ogTitleHe: v } })}
            onEn={(v) => update({ ...doc, seo: { ...doc.seo, ogTitleEn: v } })}
          />
          <Bilingual
            label="Open Graph — תיאור"
            he={doc.seo.ogDescriptionHe}
            en={doc.seo.ogDescriptionEn}
            onHe={(v) => update({ ...doc, seo: { ...doc.seo, ogDescriptionHe: v } })}
            onEn={(v) => update({ ...doc, seo: { ...doc.seo, ogDescriptionEn: v } })}
          />
          <Field label="Open Graph — תמונה">
            <TextInput
              value={doc.seo.ogImage}
              onChange={(v) => update({ ...doc, seo: { ...doc.seo, ogImage: v } })}
              dir="ltr"
            />
          </Field>
        </div>
      ) : null}

      {tab === 'versions' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          {(page.versions || []).length === 0 ? (
            <p className="text-sm text-slate-500">העמוד עדיין לא פורסם.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {page.versions.map((v) => {
                const live = v.id === page.publishedVersionId;
                return (
                  <li key={v.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="font-medium text-slate-800">גרסה {v.versionNo}</span>
                    <span className="text-sm text-slate-500">
                      {new Date(v.publishedAt).toLocaleString('he-IL')}
                      {v.publishedByName ? ` · ${v.publishedByName}` : ''}
                    </span>
                    {v.note ? <span className="text-sm text-slate-400">{v.note}</span> : null}
                    <div className="flex-1" />
                    {live ? (
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs text-emerald-800">הגרסה החיה</span>
                    ) : (
                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:border-slate-400"
                        onClick={() =>
                          setConfirm({
                            title: `לחזור לגרסה ${v.versionNo}?`,
                            body: 'העמוד באתר יוחלף מיד בגרסה הזו. הטיוטה הנוכחית נשמרת ולא משתנה.',
                            onConfirm: async () => { await api.sitePages.rollback(id, v.id); await load(); },
                          })
                        }
                      >
                        שחזור
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {/* Save bar — always visible, states: dirty / saving / saved */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-4 py-3">
          <span className="text-sm text-slate-500">
            {saving ? 'שומר…' : dirty ? 'יש שינויים שלא נשמרו' : savedAt ? `נשמר ${savedAt.toLocaleTimeString('he-IL')}` : 'אין שינויים'}
          </span>
          <div className="flex-1" />
          <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => openPreview('he', 'desktop')}>
            תצוגה מקדימה
          </button>
          <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => openPreview('he', 'mobile')}>
            מובייל
          </button>
          <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => openPreview('en', 'desktop')}>
            English
          </button>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={save}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            שמירת טיוטה
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              const warnings = [];
              const driftCount = drift.filter((d) => d.status !== 'match').length;
              if (driftCount) warnings.push(`שימו לב: ${driftCount} פריטי מחירון בעמוד שונים מכרטיסי התמחור הקנוניים.`);
              if (english.total > english.done) {
                warnings.push(
                  `תוכן אנגלי: ${english.done} מתוך ${english.total} שדות הושלמו — שדות חסרים יוסתרו לגמרי בגרסה האנגלית (אין נפילה לעברית).`,
                );
              }
              setConfirm({
                title: 'לפרסם את העמוד?',
                body: [
                  'הגרסה הזו תיווצר כגרסה חדשה וקפואה, והאתר יציג אותה. אפשר לחזור לגרסה קודמת בכל רגע.',
                  ...warnings,
                ].join('\n'),
                onConfirm: publish,
              });
            }}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            פרסום
          </button>
        </div>
      </div>

      {preview ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/60 p-4" onClick={() => setPreview(null)}>
          <div
            className="mx-auto flex h-full w-full max-w-[1200px] flex-col overflow-hidden rounded-2xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2">
              <span className="text-sm font-medium">תצוגה מקדימה — {preview.locale === 'en' ? 'English' : 'עברית'} · {preview.device === 'mobile' ? 'מובייל' : 'דסקטופ'}</span>
              <span className="text-xs text-slate-400">(טיוטה — לא משנה את העמוד החי)</span>
              <div className="flex-1" />
              <button type="button" className="text-sm text-slate-500" onClick={() => setPreview(null)}>סגירה</button>
            </div>
            <div className="flex-1 overflow-auto bg-slate-100 p-4">
              <iframe
                title="preview"
                sandbox=""
                className="mx-auto h-full bg-white shadow"
                style={{ width: preview.device === 'mobile' ? 390 : '100%', minHeight: '100%' }}
                srcDoc={preview.html}
              />
            </div>
          </div>
        </div>
      ) : null}

      {confirm ? (
        <ConfirmDialog
          open
          title={confirm.title}
          body={confirm.body}
          confirmLabel="אישור"
          onConfirm={async () => { const fn = confirm.onConfirm; setConfirm(null); await fn(); }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}
