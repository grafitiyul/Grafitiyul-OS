import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import {
  KNOWLEDGE_CATEGORIES, PLAYBOOK_CATEGORIES, LANGUAGE_LABELS,
  STATUS_LABELS, STATUS_STYLE, fmtDateTime,
} from './config.js';

// The three things the agent is made of, on one screen — because to an operator
// they are one job ("teach the agent"), and three separate tabs named after
// database tables is exactly the confusion this rework exists to remove.
//
// Each segment states, in the screen itself, what it IS and what it is NOT,
// with a concrete example. Nobody should have to remember which concept means
// what.
const SEGMENTS = [
  {
    key: 'knowledge',
    labelHe: 'מה הסוכן יודע',
    shortHe: 'ידע',
    questionHe: 'מה נכון?',
    bodyHe: 'עובדות עסקיות שהסוכן רשאי להסתמך עליהן בתשובה.',
    exampleHe: '״הסיור נמשך כשעתיים.״',
    notHe: 'לא כללי התנהגות ולא ניסוח — רק עובדות.',
  },
  {
    key: 'playbook',
    labelHe: 'איך הסוכן עובד',
    shortHe: 'כללי עבודה',
    questionHe: 'מה עושים במצב מסוים?',
    bodyHe: 'הדרך שבה אתם עובדים — מה לברר, מתי, ובאיזה סדר.',
    exampleHe: '״אם לקוח שואל מחיר אבל לא ציין כמה אנשים — קודם לברר כמה.״',
    notHe: 'לא עובדה על העסק ולא ניסוח — אלא סדר פעולות.',
  },
  {
    key: 'style',
    labelHe: 'איך הסוכן מדבר',
    shortHe: 'סגנון',
    questionHe: 'איך אומרים את זה?',
    bodyHe: 'הניסוח, האורך והטון שלכם.',
    exampleHe: 'עדיף ״מעולה :) כמה אתם?״ · פחות ״נשמח לסייע בבחירת החבילה המתאימה ביותר.״',
    notHe: 'לא משנה מה הסוכן אומר — רק איך.',
  },
];

export default function AgentKnowledge() {
  const [params, setParams] = useSearchParams();
  const segment = SEGMENTS.some((s) => s.key === params.get('tab')) ? params.get('tab') : 'knowledge';
  const active = SEGMENTS.find((s) => s.key === segment);

  return (
    <div className="mx-auto max-w-5xl p-4">
      <h1 className="gos-title mb-1 text-[18px]">המוח של הסוכן</h1>
      <p className="gos-meta mb-3">שלושה דברים שונים. רק פריטים <strong>מאושרים</strong> משפיעים על התנהגותו.</p>

      <div className="mb-3 flex flex-wrap items-center gap-1">
        {SEGMENTS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setParams({ tab: s.key }, { replace: true })}
            className={`rounded-lg px-3 py-1.5 text-[13px] transition ${
              segment === s.key
                ? 'bg-blue-600 font-semibold text-white'
                : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            {s.labelHe}
          </button>
        ))}
      </div>

      {/* The definition, on the screen that owns the concept. */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3">
        <div className="gos-detail font-semibold text-gray-900">
          {active.shortHe} = {active.questionHe}
        </div>
        <div className="gos-detail mt-0.5 text-gray-700">{active.bodyHe}</div>
        <div className="gos-meta mt-1">לדוגמה: {active.exampleHe}</div>
        <div className="gos-meta mt-0.5 text-gray-500">{active.notHe}</div>
      </div>

      {segment === 'knowledge' && <ItemCollection kind="knowledge" />}
      {segment === 'playbook' && <ItemCollection kind="playbook" />}
      {segment === 'style' && <StyleEditor />}
    </div>
  );
}

// ── Knowledge + Playbook share one editor: same lifecycle, different fields ──

const KINDS = {
  knowledge: {
    listApi: () => api.aiAgent.knowledge(),
    createApi: (b) => api.aiAgent.knowledgeCreate(b),
    updateApi: (id, b) => api.aiAgent.knowledgeUpdate(id, b),
    statusApi: (id, s) => api.aiAgent.knowledgeStatus(id, s),
    categories: KNOWLEDGE_CATEGORIES,
    addLabel: '+ עובדה חדשה',
    searchOf: (i) => `${i.title} ${i.body}`,
    emptyTitleHe: 'עדיין לא הוגדר ידע עסקי',
    emptyBodyHe: 'בלי ידע מאושר הסוכן יעדיף להעביר שאלות עובדתיות אליך במקום להמציא תשובה. זה בטוח — אבל זה גם אומר שהוא לא עוזר לך עדיין.',
    fields: [
      { key: 'title', label: 'כותרת', type: 'text', placeholder: 'למשל: נקודת מפגש — פלורנטין' },
      { key: 'body', label: 'העובדה עצמה', type: 'textarea', placeholder: 'מה בדיוק נכון לומר ללקוח.' },
    ],
  },
  playbook: {
    listApi: () => api.aiAgent.playbook(),
    createApi: (b) => api.aiAgent.playbookCreate(b),
    updateApi: (id, b) => api.aiAgent.playbookUpdate(id, b),
    statusApi: (id, s) => api.aiAgent.playbookStatus(id, s),
    categories: PLAYBOOK_CATEGORIES,
    addLabel: '+ כלל חדש',
    searchOf: (i) => `${i.title} ${i.whenText} ${i.thenText}`,
    emptyTitleHe: 'עדיין לא הוגדרו כללי עבודה',
    emptyBodyHe: 'זה בסדר גמור להתחיל בלי. בלי כללים הסוכן עונה ענייני ומעביר אליך כל דבר שדורש שיקול דעת. כללים כדאי להוסיף כשתראה שהוא חוזר על אותה טעות.',
    fields: [
      { key: 'title', label: 'שם הכלל', type: 'text', placeholder: 'למשל: לא נותנים מחיר בלי גודל קבוצה' },
      { key: 'whenText', label: 'מתי זה חל', type: 'textarea', placeholder: 'המצב שבו הכלל רלוונטי.' },
      { key: 'thenText', label: 'מה עושים אז', type: 'textarea', placeholder: 'מה הסוכן צריך לעשות.' },
    ],
  },
};

const STATUS_FILTERS = [
  { key: 'all', labelHe: 'הכל' },
  { key: 'approved', labelHe: 'פעילים' },
  { key: 'draft', labelHe: 'טיוטות' },
  { key: 'archived', labelHe: 'בארכיון' },
];

function ItemCollection({ kind }) {
  const spec = KINDS[kind];
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');

  const load = useCallback(async () => {
    try {
      const res = await KINDS[kind].listApi();
      setItems(res.items || []);
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e.message);
    }
  }, [kind]);

  useEffect(() => { setItems(null); setEditing(null); setQ(''); setStatus('all'); load(); }, [kind, load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (items || []).filter((i) => {
      if (status !== 'all' && i.status !== status) return false;
      if (!needle) return true;
      return spec.searchOf(i).toLowerCase().includes(needle);
    });
  }, [items, q, status, spec]);

  async function setStatusOf(id, next) {
    await spec.statusApi(id, next);
    load();
  }

  const approvedCount = (items || []).filter((i) => i.status === 'approved').length;

  return (
    <div>
      {error && <div className="mb-3 rounded bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</div>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing(editing === 'new' ? null : 'new')}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-700"
        >
          {spec.addLabel}
        </button>
        <input
          dir="auto"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש…"
          className="min-w-[160px] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-[13px]"
        />
        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatus(f.key)}
              className={`rounded-md px-2.5 py-1 text-[13px] transition ${
                status === f.key ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {f.labelHe}
            </button>
          ))}
        </div>
      </div>

      {items?.length > 0 && (
        <div className="gos-meta mb-2">
          {approvedCount} פעילים משפיעים על הסוכן כרגע · {items.length - approvedCount} לא פעילים
        </div>
      )}

      {editing === 'new' && (
        <ItemForm spec={spec} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}

      {items === null && <div className="gos-meta">טוען…</div>}

      {items?.length === 0 && (
        <EmptyState titleHe={spec.emptyTitleHe} bodyHe={spec.emptyBodyHe}>
          <Link to="/admin/ai-agent/setup?step=knowledge" className="text-blue-700 underline">
            פתח את ההגדרה המודרכת
          </Link>
        </EmptyState>
      )}

      {items?.length > 0 && filtered.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-8 text-center gos-detail text-gray-600">
          אין תוצאות לחיפוש הזה.
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((item) => (
          editing === item.id ? (
            <ItemForm
              key={item.id} spec={spec} item={item}
              onCancel={() => setEditing(null)}
              onSaved={() => { setEditing(null); load(); }}
            />
          ) : (
            <article key={item.id} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className={`rounded border px-1.5 py-0.5 text-[12px] ${STATUS_STYLE[item.status]}`}>
                  {item.status === 'approved' ? 'פעיל' : STATUS_LABELS[item.status]}
                </span>
                <span className="gos-meta">
                  {spec.categories.find((c) => c.key === item.category)?.label || item.category}
                </span>
                <span className="gos-meta">{LANGUAGE_LABELS[item.language]}</span>
                {/* Provenance — real, from sourceInsightId. Never fabricated. */}
                {item.sourceInsightId ? (
                  <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[12px] text-purple-800">מתובנה</span>
                ) : (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[12px] text-gray-600">נוסף ידנית</span>
                )}
                <span className="gos-meta ms-auto">נוצר {fmtDateTime(item.createdAt)}</span>
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
                  <SmallBtn tone="emerald" onClick={() => setStatusOf(item.id, 'approved')}>הפעל</SmallBtn>
                )}
                {item.status === 'approved' && (
                  <SmallBtn onClick={() => setStatusOf(item.id, 'draft')}>השבת</SmallBtn>
                )}
                {item.status !== 'archived' && (
                  <SmallBtn onClick={() => setStatusOf(item.id, 'archived')}>העבר לארכיון</SmallBtn>
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

  async function save(approve) {
    setBusy(true);
    setError(null);
    try {
      const saved = item ? await spec.updateApi(item.id, form) : await spec.createApi(form);
      if (approve) await spec.statusApi(saved.item.id, 'approved');
      onSaved();
    } catch (e) {
      setError(e?.payload?.field ? `חסר שדה: ${e.payload.field}` : (e?.payload?.error || 'השמירה נכשלה'));
    } finally { setBusy(false); }
  }

  return (
    <div className="mb-3 rounded-xl border border-blue-200 bg-white p-4">
      {item?.status === 'approved' && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          שמירה תשבית את הפריט זמנית — צריך להפעיל אותו שוב כדי שישפיע על הסוכן.
        </div>
      )}
      <div className="space-y-3">
        {spec.fields.map((f) => (
          <label key={f.key} className="block">
            <span className="gos-meta mb-1 block">{f.label}</span>
            {f.type === 'textarea' ? (
              <textarea
                dir="auto" rows={3} value={form[f.key]} placeholder={f.placeholder}
                onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 p-2 text-[14px]"
              />
            ) : (
              <input
                dir="auto" value={form[f.key]} placeholder={f.placeholder}
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
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button" onClick={() => save(true)} disabled={busy}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'שומר…' : 'שמור והפעל'}
        </button>
        <SmallBtn onClick={() => save(false)}>שמור בלי להפעיל</SmallBtn>
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
      setActiveId((cur) => cur || res.profiles?.find((p) => p.key === 'he_sales')?.id || res.profiles?.[0]?.id || null);
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const profile = data?.profiles?.find((p) => p.id === activeId) || null;
  // Seed from the record ID, never the object — a background refetch must not
  // wipe half-typed style rules.
  useEffect(() => { setDraft(profile ? { ...(profile.rules || {}) } : null); }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="rounded bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</div>;
  if (!data) return <div className="gos-meta">טוען…</div>;

  const anyApproved = data.profiles.some((p) => p.status === 'approved');

  async function save(approve) {
    setBusy(true);
    try {
      await api.aiAgent.styleUpdate(profile.id, { rules: draft });
      if (approve) await api.aiAgent.styleStatus(profile.id, 'approved');
      await load();
    } finally { setBusy(false); }
  }

  return (
    <div>
      {!anyApproved && (
        <EmptyState
          titleHe="עדיין לא לימדת את הסוכן איך אתם כותבים"
          bodyHe="הוא לא אמור להמציא את סגנון העסק. עד שתמלא פרופיל אחד לפחות ותפעיל אותו, הוא יכתוב מנומס וניטרלי — נכון, אבל לא נשמע כמוכם."
        >
          <Link to="/admin/ai-agent/setup?step=style" className="text-blue-700 underline">
            פתח את ההגדרה המודרכת — היא שואלת בשאלות פשוטות
          </Link>
        </EmptyState>
      )}

      <div className="mb-1 gos-meta">
        פרופיל לכל שילוב של שפה וסוג שיחה. <strong>מכירות</strong> = לקוח שעדיין לא סגר.
        {' '}<strong>שירות</strong> = לקוח שכבר הזמין.
      </div>
      <div className="mb-3 flex flex-wrap gap-1">
        {data.profiles.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActiveId(p.id)}
            className={`rounded-lg border px-3 py-1.5 text-[13px] transition ${
              activeId === p.id
                ? 'border-blue-300 bg-blue-50 font-semibold text-blue-800'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {p.name}
            <span className={`ms-2 rounded border px-1 py-0.5 text-[11px] ${STATUS_STYLE[p.status]}`}>
              {p.status === 'approved' ? 'פעיל' : STATUS_LABELS[p.status]}
            </span>
          </button>
        ))}
      </div>

      {profile && draft && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="gos-meta mb-3">
            שדה ריק פשוט לא נמסר לסוכן — <strong>עדיף ריק מאשר מומצא</strong>.
          </div>
          <div className="space-y-3">
            {data.fields.map((f) => (
              <label key={f.key} className="block">
                <span className="gos-detail mb-0.5 block font-medium text-gray-800">{f.labelHe}</span>
                <span className="gos-meta mb-1 block">{f.helpHe}</span>
                <textarea
                  dir="auto"
                  rows={f.type === 'list' ? 3 : 2}
                  placeholder={f.type === 'list' ? 'ביטוי אחד בכל שורה' : ''}
                  value={f.type === 'list' ? (draft[f.key] || []).join('\n') : (draft[f.key] || '')}
                  onChange={(e) => setDraft((p) => ({
                    ...p, [f.key]: f.type === 'list' ? e.target.value.split('\n') : e.target.value,
                  }))}
                  className="w-full rounded-lg border border-gray-300 p-2 text-[14px]"
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button" onClick={() => save(true)} disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'שומר…' : 'שמור והפעל'}
            </button>
            <SmallBtn onClick={() => save(false)}>שמור בלי להפעיל</SmallBtn>
            {profile.status === 'approved' && (
              <SmallBtn onClick={async () => { setBusy(true); try { await api.aiAgent.styleStatus(profile.id, 'draft'); await load(); } finally { setBusy(false); } }}>
                השבת
              </SmallBtn>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ titleHe, bodyHe, children }) {
  return (
    <div className="mb-3 rounded-xl border border-gray-200 bg-white px-6 py-8 text-center">
      <div className="gos-title-sm text-gray-900">{titleHe}</div>
      <p className="gos-detail mx-auto mt-1 max-w-xl text-gray-600">{bodyHe}</p>
      {children && <div className="gos-detail mt-2">{children}</div>}
    </div>
  );
}

function SmallBtn({ children, onClick, tone }) {
  const tones = { emerald: 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' };
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
