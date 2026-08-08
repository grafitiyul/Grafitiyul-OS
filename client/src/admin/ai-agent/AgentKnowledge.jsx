import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import {
  KNOWLEDGE_CATEGORIES, PLAYBOOK_CATEGORIES, LANGUAGE_LABELS,
  STATUS_LABELS, STATUS_STYLE,
} from './config.js';

const SEGMENTS = [
  { key: 'knowledge', label: 'עובדות', hint: 'מה נכון — עובדות עסקיות שהסוכן רשאי לומר.' },
  { key: 'playbook', label: 'שיטת עבודה', hint: 'איך אנחנו עובדים — מה עושים במצב מסוים.' },
  { key: 'style', label: 'סגנון', hint: 'איך אנחנו נשמעים — הניסוח, האורך והטון שלנו.' },
];

// ידע — one screen for the three things the agent is made of.
//
// They share a screen because to an operator they are one job ("teach the
// agent"), and splitting them into three tabs would have made a ten-tab module
// nobody navigates. They stay three DATA TYPES because they answer three
// different questions and the learning loop proposes changes to each separately.
//
// The approval model is deliberate everywhere here: everything is created as a
// DRAFT and does nothing until it is explicitly approved, and editing an
// approved row returns it to draft — a change to live agent behaviour is always
// a conscious second decision.
export default function AgentKnowledge() {
  const [segment, setSegment] = useState('knowledge');
  return (
    <div className="mx-auto max-w-5xl p-4">
      <h1 className="gos-title mb-3 text-[18px]">ידע</h1>
      <div className="mb-1 flex flex-wrap items-center gap-1">
        {SEGMENTS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSegment(s.key)}
            className={`rounded-lg px-3 py-1.5 text-[13px] transition ${
              segment === s.key ? 'bg-blue-600 font-semibold text-white' : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="gos-meta mb-4">{SEGMENTS.find((s) => s.key === segment)?.hint}</div>

      {segment === 'knowledge' && <ItemCollection kind="knowledge" />}
      {segment === 'playbook' && <ItemCollection kind="playbook" />}
      {segment === 'style' && <StyleEditor />}
    </div>
  );
}

// ── Knowledge + Playbook share one editor: same lifecycle, different fields ──

const KINDS = {
  knowledge: {
    listApi: (p) => api.aiAgent.knowledge(p),
    createApi: (b) => api.aiAgent.knowledgeCreate(b),
    updateApi: (id, b) => api.aiAgent.knowledgeUpdate(id, b),
    statusApi: (id, s) => api.aiAgent.knowledgeStatus(id, s),
    categories: KNOWLEDGE_CATEGORIES,
    addLabel: '+ עובדה חדשה',
    emptyHe: 'עדיין לא הוזנו עובדות. עד שתאשרו לפחות עובדה אחת, הסוכן לא רשאי לומר שום דבר עסקי מעבר לנתונים החיים במערכת — הוא פשוט יעביר לאדם.',
    fields: [
      { key: 'title', label: 'כותרת', type: 'text', placeholder: 'למשל: נקודת מפגש — פלורנטין' },
      { key: 'body', label: 'התוכן', type: 'textarea', placeholder: 'מה בדיוק נכון לומר ללקוח.' },
    ],
  },
  playbook: {
    listApi: (p) => api.aiAgent.playbook(p),
    createApi: (b) => api.aiAgent.playbookCreate(b),
    updateApi: (id, b) => api.aiAgent.playbookUpdate(id, b),
    statusApi: (id, s) => api.aiAgent.playbookStatus(id, s),
    categories: PLAYBOOK_CATEGORIES,
    addLabel: '+ כלל חדש',
    emptyHe: 'עדיין לא הוגדרו כללי עבודה. בלעדיהם הסוכן עונה ענייני בלבד ומעביר לאדם כל דבר שדורש שיקול דעת.',
    fields: [
      { key: 'title', label: 'שם הכלל', type: 'text', placeholder: 'למשל: לא נותנים מחיר בלי גודל קבוצה' },
      { key: 'whenText', label: 'מתי', type: 'textarea', placeholder: 'המצב שבו הכלל חל.' },
      { key: 'thenText', label: 'מה עושים', type: 'textarea', placeholder: 'מה הסוכן צריך לעשות.' },
    ],
  },
};

function ItemCollection({ kind }) {
  const spec = KINDS[kind];
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // record id | 'new'

  const load = useCallback(async () => {
    try {
      const res = await spec.listApi();
      setItems(res.items || []);
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e.message);
    }
    // spec is derived from the constant `kind` prop; re-created each render but
    // stable in behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  useEffect(() => { setItems(null); setEditing(null); load(); }, [kind, load]);

  async function setStatus(id, status) {
    await spec.statusApi(id, status);
    load();
  }

  return (
    <div>
      {error && <div className="mb-3 rounded bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</div>}

      <button
        type="button"
        onClick={() => setEditing(editing === 'new' ? null : 'new')}
        className="mb-3 rounded-lg bg-blue-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-700"
      >
        {spec.addLabel}
      </button>

      {editing === 'new' && (
        <ItemForm
          spec={spec}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {items === null && <div className="gos-meta">טוען…</div>}
      {items?.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-8 text-center gos-detail text-gray-600">
          {spec.emptyHe}
        </div>
      )}

      <div className="space-y-2">
        {(items || []).map((item) => (
          editing === item.id ? (
            <ItemForm
              key={item.id}
              spec={spec}
              item={item}
              onCancel={() => setEditing(null)}
              onSaved={() => { setEditing(null); load(); }}
            />
          ) : (
            <article key={item.id} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className={`rounded border px-1.5 py-0.5 text-[12px] ${STATUS_STYLE[item.status]}`}>
                  {STATUS_LABELS[item.status]}
                </span>
                <span className="gos-meta">
                  {spec.categories.find((c) => c.key === item.category)?.label || item.category}
                </span>
                <span className="gos-meta">{LANGUAGE_LABELS[item.language]}</span>
                {item.sourceInsightId && (
                  <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[12px] text-purple-800">נוצר מתובנה</span>
                )}
              </div>
              <div className="gos-title-sm text-gray-900">{item.title}</div>
              {kind === 'knowledge' ? (
                <div dir="auto" className="gos-detail mt-1 whitespace-pre-wrap text-gray-700">{item.body}</div>
              ) : (
                <div className="mt-1 space-y-0.5">
                  <div className="gos-detail text-gray-700"><span className="gos-meta">מתי:</span> {item.whenText}</div>
                  <div className="gos-detail text-gray-700"><span className="gos-meta">אז:</span> {item.thenText}</div>
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <SmallBtn onClick={() => setEditing(item.id)}>ערוך</SmallBtn>
                {item.status !== 'approved' && (
                  <SmallBtn tone="emerald" onClick={() => setStatus(item.id, 'approved')}>אשר להפעלה</SmallBtn>
                )}
                {item.status === 'approved' && (
                  <SmallBtn onClick={() => setStatus(item.id, 'draft')}>החזר לטיוטה</SmallBtn>
                )}
                {item.status !== 'archived' && (
                  <SmallBtn onClick={() => setStatus(item.id, 'archived')}>העבר לארכיון</SmallBtn>
                )}
              </div>
            </article>
          )
        ))}
      </div>
    </div>
  );
}

function ItemForm({ spec, item = null, onCancel, onSaved }) {
  const [form, setForm] = useState(() => {
    const base = { category: spec.categories[0].key, language: 'both' };
    for (const f of spec.fields) base[f.key] = item?.[f.key] || '';
    if (item) { base.category = item.category; base.language = item.language; }
    return base;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (item) await spec.updateApi(item.id, form);
      else await spec.createApi(form);
      onSaved();
    } catch (e) {
      setError(e?.payload?.field ? `חסר שדה: ${e.payload.field}` : (e?.payload?.error || 'השמירה נכשלה'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 rounded-xl border border-blue-200 bg-white p-4">
      {item?.status === 'approved' && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          שמירה תחזיר את הרשומה למצב טיוטה — כדי שהיא תשפיע שוב על הסוכן צריך לאשר אותה מחדש.
        </div>
      )}
      <div className="space-y-3">
        {spec.fields.map((f) => (
          <label key={f.key} className="block">
            <span className="gos-meta mb-1 block">{f.label}</span>
            {f.type === 'textarea' ? (
              <textarea
                dir="auto"
                rows={3}
                value={form[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 p-2 text-[14px]"
              />
            ) : (
              <input
                dir="auto"
                value={form[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 p-2 text-[14px]"
              />
            )}
          </label>
        ))}
        <div className="flex flex-wrap gap-3">
          <label className="block">
            <span className="gos-meta mb-1 block">קטגוריה</span>
            <select
              value={form.category}
              onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
              className="rounded-lg border border-gray-300 p-2 text-[14px]"
            >
              {spec.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="gos-meta mb-1 block">שפה</span>
            <select
              value={form.language}
              onChange={(e) => setForm((p) => ({ ...p, language: e.target.value }))}
              className="rounded-lg border border-gray-300 p-2 text-[14px]"
            >
              {Object.entries(LANGUAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
      </div>
      {error && <div className="mt-2 rounded bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</div>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'שומר…' : 'שמור כטיוטה'}
        </button>
        <SmallBtn onClick={onCancel}>ביטול</SmallBtn>
      </div>
    </div>
  );
}

// ── Style ────────────────────────────────────────────────────────────────────

function StyleEditor() {
  const [data, setData] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.aiAgent.style();
      setData(res);
      setActiveId((cur) => cur || res.profiles?.[0]?.id || null);
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const profile = data?.profiles?.find((p) => p.id === activeId) || null;

  // Seed the editable copy from the record ID, not the object, so a background
  // refetch cannot wipe half-typed style rules.
  useEffect(() => {
    setDraft(profile ? { ...(profile.rules || {}) } : null);
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="rounded bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</div>;
  if (!data) return <div className="gos-meta">טוען…</div>;

  async function save() {
    setBusy(true);
    try {
      await api.aiAgent.styleUpdate(profile.id, { rules: draft });
      await load();
    } finally { setBusy(false); }
  }

  async function setStatus(status) {
    setBusy(true);
    try {
      await api.aiAgent.styleStatus(profile.id, status);
      await load();
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
        {data.profiles.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActiveId(p.id)}
            className={`rounded-lg border px-3 py-1.5 text-[13px] transition ${
              activeId === p.id ? 'border-blue-300 bg-blue-50 font-semibold text-blue-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {p.name}
            <span className={`ms-2 rounded border px-1 py-0.5 text-[11px] ${STATUS_STYLE[p.status]}`}>
              {STATUS_LABELS[p.status]}
            </span>
          </button>
        ))}
      </div>

      {profile && draft && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="gos-meta mb-3">
            כל שדה כאן הוא הנחיה נפרדת לסוכן. שדות ריקים פשוט לא נשלחים אליו — עדיף להשאיר ריק
            מאשר לנחש. עד שהפרופיל מאושר, הסוכן כותב בניסוח ענייני וניטרלי בלי לנסות לחקות אותנו.
          </div>
          <div className="space-y-3">
            {data.fields.map((f) => (
              <label key={f.key} className="block">
                <span className="gos-detail mb-0.5 block font-medium text-gray-800">{f.labelHe}</span>
                <span className="gos-meta mb-1 block">{f.helpHe}</span>
                {f.type === 'list' ? (
                  <textarea
                    dir="auto"
                    rows={3}
                    value={(draft[f.key] || []).join('\n')}
                    placeholder="ביטוי אחד בכל שורה"
                    onChange={(e) => setDraft((p) => ({ ...p, [f.key]: e.target.value.split('\n') }))}
                    className="w-full rounded-lg border border-gray-300 p-2 text-[14px]"
                  />
                ) : (
                  <textarea
                    dir="auto"
                    rows={2}
                    value={draft[f.key] || ''}
                    onChange={(e) => setDraft((p) => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 p-2 text-[14px]"
                  />
                )}
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'שומר…' : 'שמור'}
            </button>
            {profile.status !== 'approved' && (
              <SmallBtn tone="emerald" onClick={() => setStatus('approved')}>אשר להפעלה</SmallBtn>
            )}
            {profile.status === 'approved' && (
              <SmallBtn onClick={() => setStatus('draft')}>החזר לטיוטה</SmallBtn>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SmallBtn({ children, onClick, tone }) {
  const tones = {
    emerald: 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
  };
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-[13px] transition ${tones[tone] || 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
    >
      {children}
    </button>
  );
}
