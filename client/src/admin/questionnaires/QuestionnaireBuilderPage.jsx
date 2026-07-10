import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import Toggle from '../common/Toggle.jsx';
import ReorderableList from '../common/ReorderableList.jsx';
import { resolveLocalized, KNOWN_LANGUAGES } from '../../../../shared/questionnaire/localized.mjs';
import LanguageSwitcher from '../../questionnaire/LanguageSwitcher.jsx';
import {
  typeLabel, QUESTION_TYPE_LABELS, CONDITION_OP_LABELS,
  VERSION_STATUS_LABELS, PUBLISH_PROBLEM_LABELS, purposeLabel, languageLabel,
} from '../../questionnaire/constants.js';

// Questionnaire Builder — edits ONE draft version of a template. Published
// versions are read-only here (the server refuses structural writes anyway);
// editing a live form goes through "גרסה חדשה" which clones the published
// structure into the next draft.
//
// MULTILINGUAL EDITING (Slice 4): one global "editing language" tab bar; every
// localized field edits THAT language's entry in its JSON map. Editing a
// non-default language shows the default text as a placeholder hint, and a
// field left empty is a visible gap (amber dot on the language tab). The
// publish gate still only REQUIRES the default language.

const HE = (map) => resolveLocalized(map, 'he', 'he'); // display fallback

// Language-aware read/merge helpers threaded to every editable field.
function makeLx(editLang, defLang) {
  return {
    editLang,
    defLang,
    // Raw value for the editing language — NO fallback (gaps must be visible).
    read: (map) => {
      if (typeof map === 'string') return editLang === defLang ? map : '';
      return map && typeof map === 'object' ? (map[editLang] ?? '') : '';
    },
    // Display with fallback (row labels, chips).
    show: (map) => resolveLocalized(map, editLang, defLang),
    // Placeholder hint while translating: the default-language text.
    hint: (map) => (editLang === defLang ? '' : resolveLocalized(map, defLang, defLang)),
    // Merge the edited text into the map, dropping empty entries.
    merge: (map, text) => {
      const base = map && typeof map === 'object' ? { ...map } : {};
      const t = (text ?? '').trim();
      if (t) base[editLang] = t;
      else delete base[editLang];
      return Object.keys(base).length ? base : null;
    },
    // New map for created items — text lands in the CURRENT editing language.
    fresh: (text) => ({ [editLang]: text }),
  };
}

// Which supported languages still have gaps (template title, section titles,
// question labels, option labels; intro/outro count only if set in default).
function computeMissingLanguages(runtime) {
  const t = runtime.template;
  const langs = (t.supportedLanguages || []).filter(Boolean);
  const missing = new Set();
  const check = (map, required = true) => {
    if (!required) return;
    for (const lang of langs) {
      const has = map && typeof map === 'object' && typeof map[lang] === 'string' && map[lang].trim() !== '';
      if (!has) missing.add(lang);
    }
  };
  const defHas = (map) =>
    map && typeof map === 'object' && typeof map[t.defaultLanguage] === 'string' && map[t.defaultLanguage].trim() !== '';
  check(t.title);
  check(runtime.version.intro, defHas(runtime.version.intro));
  check(runtime.version.outro, defHas(runtime.version.outro));
  for (const s of runtime.sections) {
    check(s.title);
    for (const q of s.questions) {
      check(q.label, defHas(q.label));
      for (const o of q.options || []) check(o.label, defHas(o.label));
    }
  }
  return [...missing];
}

const OPTION_TYPES = ['choice', 'dropdown', 'multi'];
// Question types offered by the builder — a strict subset of the server type
// registry, extended only together with a working runtime renderer.
const BUILDER_TYPES = [
  'text', 'textarea', 'number', 'email', 'phone', 'url',
  'date', 'time', 'datetime', 'yesno',
  'choice', 'dropdown', 'multi', 'scale', 'rating', 'slider',
  'image_upload', 'file_upload', 'signature', 'static_text',
];

export default function QuestionnaireBuilderPage() {
  const { id } = useParams();
  const [template, setTemplate] = useState(null);
  const [versionId, setVersionId] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [inspecting, setInspecting] = useState(null); // { sectionId, question } | null
  const [publishProblems, setPublishProblems] = useState(null);
  const [confirm, setConfirm] = useState(null); // { title, body, action }
  const [error, setError] = useState('');
  const [editLang, setEditLang] = useState(null); // null → template default

  const loadTemplate = useCallback(async (preferVersionId) => {
    const t = await api.questionnaires.get(id);
    setTemplate(t);
    const draft = t.versions.find((v) => v.status === 'draft');
    const pick = preferVersionId
      || draft?.id
      || t.currentVersionId
      || t.versions[0]?.id
      || null;
    setVersionId(pick);
    return pick;
  }, [id]);

  const refreshRuntime = useCallback(async (vid) => {
    if (!vid) return;
    setRuntime(await api.questionnaires.getVersion(vid));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const vid = await loadTemplate();
        await refreshRuntime(vid);
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [loadTemplate, refreshRuntime]);

  useEffect(() => {
    if (versionId) refreshRuntime(versionId).catch((e) => setError(e.message));
  }, [versionId, refreshRuntime]);

  const isDraft = runtime?.version?.status === 'draft';

  // Wrap every mutation: run → refresh → surface errors uniformly.
  const mutate = async (fn, { refreshTemplate = false } = {}) => {
    setError('');
    try {
      await fn();
      if (refreshTemplate) await loadTemplate(versionId);
      await refreshRuntime(versionId);
    } catch (e) {
      if (e.payload?.error === 'version_immutable') setError('גרסה מפורסמת אינה ניתנת לעריכה — צרו גרסה חדשה.');
      else setError(e.payload?.error || e.message);
    }
  };

  const publish = async () => {
    setError('');
    setPublishProblems(null);
    try {
      await api.questionnaires.publishVersion(versionId);
      await loadTemplate(versionId);
      await refreshRuntime(versionId);
    } catch (e) {
      if (e.status === 422 && e.payload?.problems) setPublishProblems(e.payload.problems);
      else setError(e.payload?.error || e.message);
    }
  };

  const newDraft = async () => {
    try {
      const r = await api.questionnaires.createNextDraft(id);
      await loadTemplate(r.id);
    } catch (e) {
      setError(e.payload?.error || e.message);
    }
  };

  const openPreview = () => {
    window.open(`/preview/questionnaire/${versionId}`, '_blank', 'noopener');
  };

  if (!template || !runtime) {
    return (
      <div className="px-10 py-10 text-[14px] text-gray-400" dir="rtl">
        {error || 'טוען…'}
      </div>
    );
  }

  const hasDraft = template.versions.some((v) => v.status === 'draft');
  const defLang = runtime.template.defaultLanguage;
  const supportedLanguages = runtime.template.supportedLanguages || [defLang];
  const lang = editLang && supportedLanguages.includes(editLang) ? editLang : defLang;
  const lx = makeLx(lang, defLang);
  const missingLangs = computeMissingLanguages(runtime);
  const questionLabelByKey = new Map(
    runtime.sections.flatMap((s) => s.questions.map((q) => [q.key, lx.show(q.label) || q.key])),
  );

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-4xl mx-auto" dir="rtl">
      <header className="mb-5">
        <div className="flex items-center gap-2 text-[12.5px] text-gray-500">
          <Link to="/admin/questionnaires" className="hover:text-gray-800">שאלונים</Link>
          <span>‹</span>
          <span>{purposeLabel(template.purpose)}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <InlineText
            value={template.internalName}
            className="text-2xl font-bold tracking-tight text-gray-900"
            onSave={(v) => mutate(() => api.questionnaires.update(id, { internalName: v }), { refreshTemplate: true })}
          />
          <span className={`rounded-full border px-2 py-0.5 text-[11.5px] ${
            isDraft ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}>
            v{runtime.version.versionNo} · {VERSION_STATUS_LABELS[runtime.version.status]}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {template.versions.length > 1 ? (
            <select
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[12.5px]"
              value={versionId || ''}
              onChange={(e) => setVersionId(e.target.value)}
            >
              {template.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.versionNo} — {VERSION_STATUS_LABELS[v.status]}
                </option>
              ))}
            </select>
          ) : null}
          <button type="button" onClick={openPreview} className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12.5px] text-gray-700 hover:bg-gray-50">
            👁️ תצוגה מקדימה
          </button>
          {isDraft ? (
            <button type="button" onClick={publish} className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-emerald-700">
              פרסום גרסה
            </button>
          ) : !hasDraft ? (
            <button type="button" onClick={newDraft} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-blue-700">
              גרסה חדשה לעריכה
            </button>
          ) : (
            <span className="text-[12px] text-gray-500">קיימת טיוטה בעריכה — בחרו אותה כדי לערוך.</span>
          )}
        </div>
        {supportedLanguages.length > 1 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-gray-500">שפת עריכה:</span>
            <LanguageSwitcher
              languages={supportedLanguages}
              value={lang}
              onChange={setEditLang}
              missing={missingLangs}
            />
            {lang !== defLang ? (
              <span className="text-[11.5px] text-gray-400">
                טקסט בשפת ברירת המחדל מוצג כרמז בשדות ריקים
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>
      ) : null}

      {publishProblems ? (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="text-[13.5px] font-semibold text-amber-800">לא ניתן לפרסם — יש לתקן:</div>
          <ul className="mt-1.5 list-disc space-y-0.5 pe-5 text-[12.5px] text-amber-800">
            {publishProblems.map((p, i) => (
              <li key={i}>
                {PUBLISH_PROBLEM_LABELS[p.code] || p.code}
                {p.questionKey ? ` — "${questionLabelByKey.get(p.questionKey) || p.questionKey}"` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!isDraft ? (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12.5px] text-gray-600">
          גרסה מפורסמת — לקריאה בלבד. עריכה נעשית על גרסת טיוטה חדשה.
        </div>
      ) : null}

      {/* Template + version meta */}
      <section className="mb-5 bg-white border border-gray-200 rounded-2xl shadow-sm">
        <div className="px-4 pt-3 pb-2 border-b border-gray-100">
          <h2 className="text-[14px] font-semibold text-gray-900">הגדרות תצוגה</h2>
        </div>
        <div className="px-4 py-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[12.5px] font-medium text-gray-600">
              כותרת ציבורית (מוצגת לממלא{supportedLanguages.length > 1 ? ` · ${languageLabel(lang)}` : ''})
            </label>
            <InlineText
              value={lx.read(runtime.template.title)}
              placeholder={lx.hint(runtime.template.title)}
              input
              disabled={false}
              onSave={(v) =>
                mutate(() => api.questionnaires.update(id, { title: lx.merge(runtime.template.title, v) }), { refreshTemplate: true })}
            />
          </div>
          <div>
            <label className="mb-1 block text-[12.5px] font-medium text-gray-600">שפות הטופס</label>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {KNOWN_LANGUAGES.map((l) => {
                const on = supportedLanguages.includes(l);
                const isDefault = l === defLang;
                return (
                  <button
                    key={l}
                    type="button"
                    title={isDefault ? 'שפת ברירת המחדל' : on ? 'הסרת שפה' : 'הוספת שפה'}
                    onClick={() => {
                      if (isDefault) return; // default can't be removed
                      const next = on
                        ? supportedLanguages.filter((x) => x !== l)
                        : [...supportedLanguages, l];
                      mutate(() => api.questionnaires.update(id, { supportedLanguages: next }), { refreshTemplate: true });
                      if (!next.includes(lang)) setEditLang(null);
                    }}
                    className={`rounded-full border px-2.5 py-1 text-[12px] ${
                      on
                        ? isDefault
                          ? 'border-blue-500 bg-blue-500 text-white'
                          : 'border-blue-300 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {on ? '✓ ' : ''}{languageLabel(l)}{isDefault ? ' ★' : ''}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[12.5px] font-medium text-gray-600">פריסת מילוי</label>
            <select
              disabled={!isDraft}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13.5px] disabled:bg-gray-50 disabled:text-gray-400"
              value={runtime.version.displayMode}
              onChange={(e) => mutate(() => api.questionnaires.updateVersion(versionId, { displayMode: e.target.value }))}
            >
              <option value="full_list">רשימה מלאה (עמוד אחד)</option>
              <option value="step_by_step">שלב-אחר-שלב (שאלה במסך)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[12.5px] font-medium text-gray-600">פתיח (מוצג לפני השאלות)</label>
            <SavedTextarea
              disabled={!isDraft}
              value={lx.read(runtime.version.intro)}
              placeholder={lx.hint(runtime.version.intro)}
              onSave={(v) => mutate(() => api.questionnaires.updateVersion(versionId, { intro: lx.merge(runtime.version.intro, v) }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-[12.5px] font-medium text-gray-600">סיום (מסך תודה)</label>
            <SavedTextarea
              disabled={!isDraft}
              value={lx.read(runtime.version.outro)}
              placeholder={lx.hint(runtime.version.outro)}
              onSave={(v) => mutate(() => api.questionnaires.updateVersion(versionId, { outro: lx.merge(runtime.version.outro, v) }))}
            />
          </div>
        </div>
      </section>

      {/* Sections */}
      <ReorderableList
        items={runtime.sections}
        onReorder={(ids) => isDraft && mutate(() => api.questionnaires.updateLayout(versionId, { sectionOrder: ids }))}
        emptyText="אין מקטעים"
        renderRow={(section, { handle }) => (
          <SectionCard
            section={section}
            handle={isDraft ? handle : null}
            isDraft={isDraft}
            versionId={versionId}
            lx={lx}
            onMutate={mutate}
            onInspect={(question) => setInspecting({ sectionId: section.id, question })}
            onDelete={() =>
              setConfirm({
                title: 'מחיקת מקטע',
                body: `למחוק את המקטע "${lx.show(section.title)}" על כל שאלותיו?`,
                action: () => mutate(() => api.questionnaires.removeSection(section.id)),
              })}
          />
        )}
      />

      {isDraft ? (
        <button
          type="button"
          onClick={() => mutate(() => api.questionnaires.createSection(versionId, { title: 'מקטע חדש' }))}
          className="mt-3 w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-3 text-[13.5px] text-gray-500 hover:border-gray-400 hover:text-gray-700"
        >
          + הוספת מקטע
        </button>
      ) : null}

      {/* Version history — every version, its state, publish date and note. */}
      <section className="mt-5 bg-white border border-gray-200 rounded-2xl shadow-sm">
        <div className="px-4 pt-3 pb-2 border-b border-gray-100">
          <h2 className="text-[14px] font-semibold text-gray-900">היסטוריית גרסאות</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {template.versions.map((v) => (
            <div key={v.id} className="flex items-center gap-3 px-4 py-2.5">
              <button
                type="button"
                onClick={() => setVersionId(v.id)}
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[11.5px] ${
                  v.id === versionId
                    ? 'border-blue-400 bg-blue-50 text-blue-700 font-semibold'
                    : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
                }`}
              >
                v{v.versionNo}
              </button>
              <span className="text-[12px] text-gray-500">
                {VERSION_STATUS_LABELS[v.status] || v.status}
                {v.publishedAt ? ` · פורסמה ${new Date(v.publishedAt).toLocaleDateString('he-IL')}` : ''}
              </span>
              {v.id === versionId && isDraft ? (
                <InlineText
                  value={v.notes || ''}
                  placeholder="הערת גרסה (מה השתנה?)"
                  allowEmpty
                  className="flex-1 text-[12px] text-gray-600"
                  onSave={(text) =>
                    mutate(() => api.questionnaires.updateVersion(versionId, { notes: text || null }), { refreshTemplate: true })}
                />
              ) : v.notes ? (
                <span className="flex-1 truncate text-[12px] text-gray-400">{v.notes}</span>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <QuestionInspector
        state={inspecting}
        runtime={runtime}
        isDraft={isDraft}
        versionId={versionId}
        lx={lx}
        onClose={() => setInspecting(null)}
        onMutate={mutate}
        onDelete={(q) =>
          setConfirm({
            title: 'מחיקת שאלה',
            body: `למחוק את השאלה "${lx.show(q.label) || 'ללא כותרת'}"?`,
            action: async () => {
              setInspecting(null);
              await mutate(() => api.questionnaires.removeQuestion(q.id));
            },
          })}
      />

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        body={confirm?.body}
        confirmLabel="מחיקה"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const a = confirm.action;
          setConfirm(null);
          await a();
        }}
      />
    </div>
  );
}

// Inline-editable text (saves on blur / Enter). `allowEmpty` lets a translator
// CLEAR a non-default language entry (the language-merge drops empty values);
// legacy single-language fields keep the "revert on empty" behavior.
function InlineText({ value, onSave, className = '', input = false, disabled = false, placeholder = '', allowEmpty = false }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  const commit = () => {
    const t = v.trim();
    if (t === (value ?? '')) return;
    if (t || allowEmpty) onSave(t);
    else setV(value ?? '');
  };
  return (
    <input
      className={
        input
          ? 'w-full rounded-lg border border-gray-300 px-3 py-2 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200'
          : `bg-transparent border-b border-transparent focus:border-blue-300 focus:outline-none ${className}`
      }
      value={v}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
    />
  );
}

function SavedTextarea({ value, onSave, disabled, placeholder = '' }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  return (
    <textarea
      className="w-full min-h-[64px] rounded-lg border border-gray-300 px-3 py-2 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-50 disabled:text-gray-400"
      value={v}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if ((v ?? '') !== (value ?? '')) onSave(v.trim());
      }}
    />
  );
}

function SectionCard({ section, handle, isDraft, versionId, lx, onMutate, onInspect, onDelete }) {
  const [addOpen, setAddOpen] = useState(false);
  return (
    <section className="mb-3 bg-white border border-gray-200 rounded-2xl shadow-sm">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-gray-100">
        {handle}
        <InlineText
          value={lx.read(section.title)}
          placeholder={lx.hint(section.title)}
          allowEmpty={lx.editLang !== lx.defLang}
          className="text-[14.5px] font-semibold text-gray-900 flex-1"
          disabled={!isDraft}
          onSave={(v) => onMutate(() => api.questionnaires.updateSection(section.id, { title: lx.merge(section.title, v) }))}
        />
        {section.visibleWhen ? (
          <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-700" title="מוצג בתנאי">⚡ מותנה</span>
        ) : null}
        {isDraft ? (
          <button type="button" onClick={onDelete} className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500" title="מחיקת מקטע">
            🗑️
          </button>
        ) : null}
      </div>
      <div className="px-3 py-2">
        <ReorderableList
          items={section.questions}
          emptyText="אין שאלות במקטע — הוסיפו את הראשונה."
          onReorder={(ids) =>
            isDraft && onMutate(() => api.questionnaires.updateLayout(versionId, { questions: { [section.id]: ids } }))}
          renderRow={(q, { handle: qHandle }) => (
            <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-2 hover:bg-gray-50">
              {isDraft ? qHandle : null}
              <button type="button" onClick={() => onInspect(q)} className="flex min-w-0 flex-1 items-center gap-2 text-right">
                <span className="truncate text-[13.5px] text-gray-800">
                  {lx.read(q.label) || (lx.show(q.label)
                    ? <span className="text-amber-500" title="חסר תרגום בשפה זו">{lx.show(q.label)} ⚠</span>
                    : <span className="text-gray-400">ללא כותרת</span>)}
                </span>
                {q.required ? <span className="text-red-500">*</span> : null}
                {q.visibleWhen ? <span title="מוצג בתנאי">⚡</span> : null}
                <span className="ms-auto shrink-0 rounded bg-gray-200/70 px-1.5 py-0.5 text-[11px] text-gray-600">
                  {typeLabel(q.type)}
                </span>
              </button>
            </div>
          )}
        />
        {isDraft ? (
          addOpen ? (
            <AddQuestionRow
              sectionId={section.id}
              lx={lx}
              onDone={() => setAddOpen(false)}
              onMutate={onMutate}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="mt-2 w-full rounded-lg border border-dashed border-gray-300 px-3 py-2 text-[12.5px] text-gray-500 hover:border-gray-400 hover:text-gray-700"
            >
              + שאלה
            </button>
          )
        ) : null}
      </div>
    </section>
  );
}

function AddQuestionRow({ sectionId, lx, onDone, onMutate }) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState('text');
  const add = async () => {
    if (!label.trim()) return;
    // The new label lands in the CURRENT editing language (localized map).
    await onMutate(() => api.questionnaires.createQuestion(sectionId, { label: lx.fresh(label.trim()), type }));
    onDone();
  };
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        autoFocus
        className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
        placeholder="נוסח השאלה…"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add();
          if (e.key === 'Escape') onDone();
        }}
      />
      <select className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-[12.5px]" value={type} onChange={(e) => setType(e.target.value)}>
        {BUILDER_TYPES.map((t) => (
          <option key={t} value={t}>{QUESTION_TYPE_LABELS[t] || t}</option>
        ))}
      </select>
      <button type="button" onClick={add} disabled={!label.trim()} className="rounded-lg bg-blue-600 px-3 py-2 text-[12.5px] font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        הוספה
      </button>
      <button type="button" onClick={onDone} className="rounded-lg px-2 py-2 text-[12.5px] text-gray-500 hover:bg-gray-100">
        ביטול
      </button>
    </div>
  );
}

// Ordered answerable questions that appear BEFORE `beforeKey` (or before a
// whole section when beforeSectionId is given) — the only legal condition
// targets (backward-only, matching the server's publish rule).
function earlierQuestions(runtime, { beforeQuestionId, beforeSectionId }) {
  const out = [];
  for (const s of runtime.sections) {
    if (beforeSectionId && s.id === beforeSectionId) break;
    for (const q of s.questions) {
      if (beforeQuestionId && q.id === beforeQuestionId) return out;
      if (q.type !== 'static_text') out.push(q);
    }
  }
  return out;
}

function QuestionInspector({ state, runtime, isDraft, versionId, lx, onClose, onMutate, onDelete }) {
  const question = state?.question || null;
  // Always re-resolve the question from the fresh runtime (post-mutation).
  const live = useMemo(() => {
    if (!question) return null;
    for (const s of runtime.sections) {
      const hit = s.questions.find((q) => q.id === question.id);
      if (hit) return { section: s, question: hit };
    }
    return null;
  }, [question, runtime]);

  if (!state || !live) return null;
  const q = live.question;
  const earlier = earlierQuestions(runtime, { beforeQuestionId: q.id });

  const save = (patch) => onMutate(() => api.questionnaires.updateQuestion(q.id, patch));
  const saveConfig = (key, value) =>
    save({ config: { ...(q.config || {}), [key]: value === '' || value === undefined ? undefined : value } });

  return (
    <Dialog open onClose={onClose} title="הגדרות שאלה" size="lg">
      <div className="space-y-4 p-1" dir="rtl">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[12.5px] font-medium text-gray-600">
              {q.type === 'static_text' ? 'תוכן (HTML מותר)' : 'נוסח השאלה'}
              {lx.editLang !== lx.defLang ? ` · ${languageLabel(lx.editLang)}` : ''}
            </label>
            {q.type === 'static_text' ? (
              <SavedTextarea
                disabled={!isDraft}
                value={lx.read(q.label)}
                placeholder={lx.hint(q.label)}
                onSave={(v) => save({ label: lx.merge(q.label, v) })}
              />
            ) : (
              <InlineText
                input
                disabled={!isDraft}
                value={lx.read(q.label)}
                placeholder={lx.hint(q.label)}
                allowEmpty={lx.editLang !== lx.defLang}
                onSave={(v) => save({ label: lx.merge(q.label, v) })}
              />
            )}
          </div>
          <div>
            <label className="mb-1 block text-[12.5px] font-medium text-gray-600">סוג</label>
            <select
              disabled={!isDraft}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13.5px] disabled:bg-gray-50"
              value={q.type}
              onChange={(e) => save({ type: e.target.value })}
            >
              {BUILDER_TYPES.map((t) => (
                <option key={t} value={t}>{QUESTION_TYPE_LABELS[t] || t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[12.5px] font-medium text-gray-600">מקטע</label>
            <select
              disabled={!isDraft}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13.5px] disabled:bg-gray-50"
              value={live.section.id}
              onChange={(e) => {
                const target = runtime.sections.find((s) => s.id === e.target.value);
                if (!target) return;
                onMutate(() =>
                  api.questionnaires.updateLayout(versionId, {
                    questions: { [target.id]: [...target.questions.map((x) => x.id), q.id] },
                  }));
              }}
            >
              {runtime.sections.map((s) => (
                <option key={s.id} value={s.id}>{lx.show(s.title)}</option>
              ))}
            </select>
          </div>
          {q.type !== 'static_text' ? (
            <>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[12.5px] font-medium text-gray-600">טקסט עזרה (אופציונלי)</label>
                <InlineText
                  input
                  disabled={!isDraft}
                  value={lx.read(q.helpText)}
                  placeholder={lx.hint(q.helpText)}
                  allowEmpty
                  onSave={(v) => save({ helpText: lx.merge(q.helpText, v) })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Toggle
                  checked={q.required}
                  disabled={!isDraft}
                  onChange={(v) => save({ required: v })}
                  label="שאלת חובה"
                />
              </div>
            </>
          ) : null}
        </div>

        <TypeConfigFields q={q} isDraft={isDraft} saveConfig={saveConfig} />

        {OPTION_TYPES.includes(q.type) ? (
          <OptionsEditor q={q} isDraft={isDraft} lx={lx} onMutate={onMutate} saveConfig={saveConfig} />
        ) : null}

        <ConditionEditor
          value={q.visibleWhen}
          earlier={earlier}
          disabled={!isDraft}
          onChange={(expr) => save({ visibleWhen: expr })}
        />

        <div className="flex items-center justify-between border-t border-gray-100 pt-3">
          {isDraft ? (
            <button type="button" onClick={() => onDelete(q)} className="rounded-lg px-3 py-1.5 text-[12.5px] text-red-600 hover:bg-red-50">
              🗑️ מחיקת שאלה
            </button>
          ) : <span />}
          <button type="button" onClick={onClose} className="rounded-lg bg-gray-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-gray-800">
            סגירה
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// Per-type numeric/config fields (kept intentionally small — the server type
// registry is the authority on which keys matter).
function TypeConfigFields({ q, isDraft, saveConfig }) {
  const num = (key, label, placeholder) => (
    <div key={key}>
      <label className="mb-1 block text-[12px] text-gray-500">{label}</label>
      <input
        type="number"
        disabled={!isDraft}
        className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[13px] disabled:bg-gray-50"
        defaultValue={q.config?.[key] ?? ''}
        placeholder={placeholder}
        onBlur={(e) => saveConfig(key, e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </div>
  );
  let fields = null;
  if (q.type === 'number') fields = [num('min', 'מינימום'), num('max', 'מקסימום')];
  if (q.type === 'scale') fields = [num('scaleMin', 'מ-', '1'), num('scaleMax', 'עד', '10')];
  if (q.type === 'rating') fields = [num('ratingMax', 'מספר כוכבים', '5')];
  if (q.type === 'slider') fields = [num('min', 'מינימום', '0'), num('max', 'מקסימום', '100'), num('step', 'קפיצות', '1')];
  if (q.type === 'multi') fields = [num('minSelections', 'מינימום בחירות'), num('maxSelections', 'מקסימום בחירות')];
  if (q.type === 'text' || q.type === 'textarea') fields = [num('maxLength', 'אורך מקסימלי')];
  if (!fields) return null;
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{fields}</div>;
}

function OptionsEditor({ q, isDraft, lx, onMutate, saveConfig }) {
  const [newLabel, setNewLabel] = useState('');
  const add = async () => {
    if (!newLabel.trim()) return;
    await onMutate(() => api.questionnaires.createOption(q.id, { label: lx.fresh(newLabel.trim()) }));
    setNewLabel('');
  };
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-3">
      <div className="mb-2 text-[12.5px] font-medium text-gray-700">אפשרויות</div>
      <ReorderableList
        items={q.options}
        emptyText="אין אפשרויות עדיין."
        onReorder={(ids) => isDraft && onMutate(() => api.questionnaires.reorderOptions(q.id, ids))}
        renderRow={(o, { handle }) => (
          <div className="flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-2 py-1.5">
            {isDraft ? handle : null}
            <InlineText
              value={lx.read(o.label)}
              placeholder={lx.hint(o.label)}
              allowEmpty={lx.editLang !== lx.defLang}
              className="flex-1 text-[13px]"
              disabled={!isDraft}
              onSave={(v) => onMutate(() => api.questionnaires.updateOption(o.id, { label: lx.merge(o.label, v) }))}
            />
            {isDraft ? (
              <button
                type="button"
                onClick={() => onMutate(() => api.questionnaires.removeOption(o.id))}
                className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500"
              >
                ✕
              </button>
            ) : null}
          </div>
        )}
      />
      {isDraft ? (
        <div className="mt-2 flex items-center gap-2">
          <input
            className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] focus:border-blue-400 focus:outline-none"
            placeholder="אפשרות חדשה…"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button type="button" onClick={add} disabled={!newLabel.trim()} className="rounded-lg bg-gray-900 px-3 py-1.5 text-[12.5px] text-white disabled:opacity-40">
            הוספה
          </button>
        </div>
      ) : null}
      <div className="mt-2">
        <Toggle
          checked={!!q.config?.allowOther}
          disabled={!isDraft}
          onChange={(v) => saveConfig('allowOther', v || undefined)}
          label='לאפשר "אחר" עם טקסט חופשי'
        />
      </div>
    </div>
  );
}

// Visual builder for the capped visibleWhen grammar: none | single leaf |
// {all|any: [leaves]}. Nested not/mixed trees are shown as JSON (rare, kept
// editable server-side but out of the visual editor's scope).
function ConditionEditor({ value, earlier, disabled, onChange }) {
  const leaves = useMemo(() => {
    if (!value) return [];
    if (Array.isArray(value.all)) return value.all;
    if (Array.isArray(value.any)) return value.any;
    return [value];
  }, [value]);
  const mode = value && Array.isArray(value.any) ? 'any' : 'all';
  const isVisual = leaves.every((l) => l && typeof l.q === 'string');

  const emit = (nextLeaves, nextMode = mode) => {
    if (!nextLeaves.length) return onChange(null);
    if (nextLeaves.length === 1) return onChange(nextLeaves[0]);
    return onChange({ [nextMode]: nextLeaves });
  };

  if (!isVisual) {
    return (
      <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 text-[12px] text-violet-700">
        לשאלה זו תנאי תצוגה מורכב שהוגדר מחוץ לעורך — עריכה ויזואלית אינה זמינה.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[12.5px] font-medium text-violet-800">⚡ תנאי תצוגה</div>
        {leaves.length > 1 ? (
          <select
            disabled={disabled}
            className="rounded border border-violet-200 bg-white px-1.5 py-0.5 text-[11.5px]"
            value={mode}
            onChange={(e) => emit(leaves, e.target.value)}
          >
            <option value="all">כל התנאים (וגם)</option>
            <option value="any">אחד מהתנאים (או)</option>
          </select>
        ) : null}
      </div>

      {leaves.length === 0 ? (
        <p className="text-[12px] text-gray-500">השאלה מוצגת תמיד.</p>
      ) : (
        <div className="space-y-1.5">
          {leaves.map((leaf, i) => (
            <ConditionLeafRow
              key={i}
              leaf={leaf}
              earlier={earlier}
              disabled={disabled}
              onChange={(next) => emit(leaves.map((l, j) => (j === i ? next : l)))}
              onRemove={() => emit(leaves.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}

      {!disabled && earlier.length ? (
        <button
          type="button"
          onClick={() => emit([...leaves, { q: earlier[0].key, op: 'answered' }])}
          className="mt-2 rounded-lg border border-dashed border-violet-300 px-2.5 py-1 text-[12px] text-violet-700 hover:bg-violet-50"
        >
          + תנאי
        </button>
      ) : null}
      {!earlier.length ? (
        <p className="mt-1 text-[11.5px] text-gray-400">אין שאלות קודמות שניתן להתנות עליהן.</p>
      ) : null}
    </div>
  );
}

function ConditionLeafRow({ leaf, earlier, disabled, onChange, onRemove }) {
  const target = earlier.find((q) => q.key === leaf.q) || null;
  const needsValue = !['answered', 'empty'].includes(leaf.op);
  const setOp = (op) => {
    const next = { q: leaf.q, op };
    if (!['answered', 'empty'].includes(op)) next.value = leaf.value ?? defaultValueFor(target);
    onChange(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-white border border-violet-100 px-2 py-1.5">
      <select
        disabled={disabled}
        className="max-w-[45%] rounded border border-gray-200 bg-white px-1.5 py-1 text-[12px]"
        value={leaf.q}
        onChange={(e) => onChange({ ...leaf, q: e.target.value })}
      >
        {earlier.map((q) => (
          <option key={q.key} value={q.key}>{HE(q.label) || q.key}</option>
        ))}
        {!target ? <option value={leaf.q}>{leaf.q} (לא נמצאה)</option> : null}
      </select>
      <select
        disabled={disabled}
        className="rounded border border-gray-200 bg-white px-1.5 py-1 text-[12px]"
        value={leaf.op}
        onChange={(e) => setOp(e.target.value)}
      >
        {Object.entries(CONDITION_OP_LABELS).map(([op, label]) => (
          <option key={op} value={op}>{label}</option>
        ))}
      </select>
      {needsValue ? (
        <ConditionValueInput leaf={leaf} target={target} disabled={disabled} onChange={onChange} />
      ) : null}
      {!disabled ? (
        <button type="button" onClick={onRemove} className="ms-auto rounded p-0.5 text-gray-300 hover:text-red-500">✕</button>
      ) : null}
    </div>
  );
}

function defaultValueFor(target) {
  if (!target) return '';
  if (target.type === 'yesno') return true;
  if (['number', 'scale', 'rating', 'slider'].includes(target.type)) return 0;
  if (target.options?.length) return target.options[0].value;
  return '';
}

function ConditionValueInput({ leaf, target, disabled, onChange }) {
  const isList = ['in', 'nin'].includes(leaf.op);
  if (target?.type === 'yesno' && !isList) {
    return (
      <select
        disabled={disabled}
        className="rounded border border-gray-200 bg-white px-1.5 py-1 text-[12px]"
        value={String(leaf.value)}
        onChange={(e) => onChange({ ...leaf, value: e.target.value === 'true' })}
      >
        <option value="true">כן</option>
        <option value="false">לא</option>
      </select>
    );
  }
  if (target?.options?.length && !isList) {
    return (
      <select
        disabled={disabled}
        className="rounded border border-gray-200 bg-white px-1.5 py-1 text-[12px]"
        value={typeof leaf.value === 'string' ? leaf.value : ''}
        onChange={(e) => onChange({ ...leaf, value: e.target.value })}
      >
        {target.options.map((o) => (
          <option key={o.value} value={o.value}>{HE(o.label)}</option>
        ))}
      </select>
    );
  }
  if (isList && target?.options?.length) {
    const selected = Array.isArray(leaf.value) ? leaf.value : [];
    return (
      <div className="flex flex-wrap gap-1">
        {target.options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...leaf,
                  value: on ? selected.filter((v) => v !== o.value) : [...selected, o.value],
                })}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                on ? 'border-violet-400 bg-violet-100 text-violet-800' : 'border-gray-200 bg-white text-gray-600'
              }`}
            >
              {HE(o.label)}
            </button>
          );
        })}
      </div>
    );
  }
  const isNumeric = ['gt', 'gte', 'lt', 'lte'].includes(leaf.op) ||
    ['number', 'scale', 'rating', 'slider'].includes(target?.type);
  return (
    <input
      disabled={disabled}
      type={isNumeric ? 'number' : 'text'}
      className="w-28 rounded border border-gray-200 px-1.5 py-1 text-[12px]"
      value={leaf.value ?? ''}
      onChange={(e) =>
        onChange({ ...leaf, value: isNumeric && e.target.value !== '' ? Number(e.target.value) : e.target.value })}
    />
  );
}
