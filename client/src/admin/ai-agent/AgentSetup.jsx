import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';

// הגדרה ראשונית — a guided setup, not a wizard prison.
//
// It walks the operator through only what is genuinely useful on day one:
// what the agent does, how we sound, and a handful of facts. It deliberately
// does NOT ask them to configure 16 capabilities — those ship at shadow, which
// is the correct starting authority, and are promoted later from evidence.
//
// Nothing here is a new storage concept: every step writes through the same
// endpoints the ידע screen uses. The operator can leave at any point and what
// they already saved stays saved.

const STEPS = [
  { key: 'concepts', labelHe: 'איך זה עובד' },
  { key: 'style', labelHe: 'איך אנחנו כותבים' },
  { key: 'knowledge', labelHe: 'מה הסוכן צריך לדעת' },
  { key: 'done', labelHe: 'מתחילים' },
];

export default function AgentSetup() {
  const [params, setParams] = useSearchParams();
  const stepKey = STEPS.some((s) => s.key === params.get('step')) ? params.get('step') : 'concepts';
  const index = STEPS.findIndex((s) => s.key === stepKey);
  const go = (key) => setParams({ step: key }, { replace: false });

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="gos-title text-[18px]">הגדרה ראשונית</h1>
        <Link to="/admin/ai-agent" className="gos-meta ms-auto underline">
          דלג — אפשר לחזור לזה מתי שתרצה
        </Link>
      </div>

      {/* Step rail — clickable, so this is navigation and not a funnel. */}
      <ol className="mb-5 flex flex-wrap items-center gap-1">
        {STEPS.map((s, i) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => go(s.key)}
              className={`rounded-lg px-3 py-1.5 text-[13px] transition ${
                i === index
                  ? 'bg-blue-600 font-semibold text-white'
                  : i < index
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
              }`}
            >
              <span className="me-1.5 opacity-70">{i + 1}</span>{s.labelHe}
            </button>
          </li>
        ))}
      </ol>

      {stepKey === 'concepts' && <ConceptsStep onNext={() => go('style')} />}
      {stepKey === 'style' && <StyleStep onNext={() => go('knowledge')} />}
      {stepKey === 'knowledge' && <KnowledgeStep onNext={() => go('done')} />}
      {stepKey === 'done' && <DoneStep />}
    </div>
  );
}

// ── Step A: what the agent does ──────────────────────────────────────────────

function ConceptsStep({ onNext }) {
  return (
    <div className="space-y-4">
      <Card title="שלוש רמות סמכות">
        <p className="gos-detail mb-3 text-gray-700">
          לכל סוג פנייה מלקוח יש רמת סמכות משלו. אין מתג אחד גדול.
        </p>
        <div className="space-y-2">
          <Level
            labelHe="צל"
            tone="slate"
            bodyHe="הסוכן קורא את השיחה ורושם מה היה עונה. אתה לא רואה את זה בשיחה, וללקוח לא נשלח כלום. זו נקודת ההתחלה של כל הקטגוריות."
          />
          <Level
            labelHe="דורש אישור"
            tone="amber"
            bodyHe="ההצעה מופיעה לך בתוך שיחת הווטסאפ. אתה שולח, עורך או דוחה. בלי לחיצה שלך — לא יוצא כלום."
          />
          <Level
            labelHe="אוטומטי"
            tone="emerald"
            bodyHe="הסוכן עונה ללקוח בעצמו. שמור את זה לקטגוריות פשוטות שראית שוב ושוב שהוא צודק בהן."
          />
        </div>
      </Card>

      <Card title="חלק מהקטגוריות לא יכולות להגיע לאוטומטי — לעולם">
        <p className="gos-detail text-gray-700">
          מחיר, זמינות, ביטול, תלונה והחזר כספי מוגבלים בקוד עצמו. גם אם תרצה, המערכת לא תיתן
          להעביר אותן לאוטומטי — כי טעות שם עולה כסף או לקוח. במסך ההרשאות תראה בדיוק איפה
          התקרה של כל קטגוריה ולמה.
        </p>
      </Card>

      <Card title="שלושה סוגי ידע — ולמה זה לא אותו דבר">
        <ConceptRow
          titleHe="ידע = מה נכון"
          exampleHe="״הסיור נמשך כשעתיים.״"
          bodyHe="עובדות עסקיות שהסוכן רשאי להסתמך עליהן. בלי זה הוא מעביר כל שאלה עובדתית אליך."
        />
        <ConceptRow
          titleHe="כללי עבודה = מה עושים"
          exampleHe="״אם שואלים מחיר בלי לציין כמה אנשים — קודם לברר כמה.״"
          bodyHe="הדרך שבה אתם עובדים. אפשר להשאיר ריק בהתחלה."
        />
        <ConceptRow
          titleHe="סגנון = איך אומרים"
          exampleHe="עדיף ״מעולה :) כמה אתם?״ · פחות ״נשמח לסייע בבחירת החבילה המתאימה.״"
          bodyHe="הניסוח שלכם. בלי זה הוא כותב מנומס וניטרלי — נכון, אבל לא נשמע כמוכם."
        />
      </Card>

      <NextButton onClick={onNext}>הבא — איך אנחנו כותבים</NextButton>
    </div>
  );
}

// ── Step B: style, asked as practical questions ──────────────────────────────

// The internal StyleProfile fields, re-asked as questions an operator can
// actually answer. Same nine fields, same endpoint — only the framing changes.
const STYLE_QUESTIONS = [
  { key: 'greeting', q: 'איך אנחנו בדרך כלל פותחים הודעה?', ph: 'למשל: בשם הפרטי, בלי "שלום רב"' },
  { key: 'messageLength', q: 'כמה ארוכות התשובות שלנו?', ph: 'למשל: שתיים-שלוש שורות, לא פסקאות' },
  { key: 'questionsPerMessage', q: 'שואלים שאלה אחת בכל פעם, או כמה יחד?', ph: 'למשל: שאלה אחת, לא להציף' },
  { key: 'emoji', q: 'משתמשים באימוג׳ים?', ph: 'למשל: כן, מעט — חיוך בפתיחה' },
  { key: 'punctuation', q: 'איך נראה הפיסוק שלנו?', ph: 'למשל: בלי סימני קריאה, בלי שלוש נקודות' },
  { key: 'directness', q: 'כמה ישירים אנחנו?', ph: 'למשל: ממליצים בפירוש במקום לשאול מה הם מעדיפים' },
  { key: 'phrasesToUse', q: 'ביטויים שאנחנו אוהבים להשתמש בהם', ph: 'ביטוי אחד בכל שורה', list: true },
  { key: 'phrasesToAvoid', q: 'ביטויים שלא נשמעים כמונו', ph: 'ביטוי אחד בכל שורה', list: true },
];

function StyleStep({ onNext }) {
  const [profiles, setProfiles] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const res = await api.aiAgent.style();
    setProfiles(res.profiles || []);
    setActiveId((cur) => cur || res.profiles?.find((p) => p.key === 'he_sales')?.id || res.profiles?.[0]?.id || null);
  }, []);

  useEffect(() => { load(); }, [load]);

  const profile = profiles?.find((p) => p.id === activeId) || null;
  useEffect(() => { setDraft({ ...(profile?.rules || {}) }); setSaved(false); }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!profiles) return <div className="gos-meta">טוען…</div>;

  async function saveAndApprove() {
    setBusy(true);
    try {
      await api.aiAgent.styleUpdate(profile.id, { rules: draft });
      await api.aiAgent.styleStatus(profile.id, 'approved');
      await load();
      setSaved(true);
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <Card title="למי הסגנון הזה שייך">
        <p className="gos-detail mb-3 text-gray-700">
          יש ארבעה פרופילים, לפי <strong>שפה</strong> ולפי <strong>סוג השיחה</strong>. מכירות = לקוח שעדיין
          לא סגר. שירות = לקוח שכבר הזמין. מספיק למלא אחד כדי להתחיל — כדאי את זה שאתם הכי
          הרבה כותבים בו.
        </p>
        <div className="flex flex-wrap gap-1">
          {profiles.map((p) => (
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
              {p.status === 'approved' && <span className="ms-1.5 text-emerald-600">✓</span>}
            </button>
          ))}
        </div>
      </Card>

      {profile && (
        <Card title={`ענה במילים שלך — ${profile.name}`}>
          <p className="gos-meta mb-3">
            אין חובה למלא הכל. שדה ריק פשוט לא נמסר לסוכן — <strong>עדיף ריק מאשר מומצא</strong>.
          </p>
          <div className="space-y-3">
            {STYLE_QUESTIONS.map((q) => (
              <label key={q.key} className="block">
                <span className="gos-detail mb-1 block font-medium text-gray-800">{q.q}</span>
                <textarea
                  dir="auto"
                  rows={q.list ? 3 : 2}
                  placeholder={q.ph}
                  value={q.list ? (draft[q.key] || []).join('\n') : (draft[q.key] || '')}
                  onChange={(e) => setDraft((p) => ({
                    ...p, [q.key]: q.list ? e.target.value.split('\n') : e.target.value,
                  }))}
                  className="w-full rounded-lg border border-gray-300 p-2 text-[14px]"
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={saveAndApprove}
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'שומר…' : 'שמור והפעל את הסגנון'}
            </button>
            {saved && <span className="gos-detail text-emerald-700">נשמר והופעל ✓</span>}
          </div>
        </Card>
      )}

      <NextButton onClick={onNext}>הבא — מה הסוכן צריך לדעת</NextButton>
    </div>
  );
}

// ── Step C: knowledge ────────────────────────────────────────────────────────

// Prompts, NOT content. We show the operator which QUESTIONS customers ask so
// they know what to write — we never seed a business fact we invented.
const KNOWLEDGE_PROMPTS = [
  { category: 'meeting_point', titleHe: 'נקודת מפגש', askHe: 'איפה נפגשים, ואיך מזהים את המקום?' },
  { category: 'product', titleHe: 'משך הפעילות', askHe: 'כמה זמן נמשך סיור? וסדנה?' },
  { category: 'product', titleHe: 'מה כלול', askHe: 'מה נכלל במחיר — צבעים, ציוד, מדריך, כיבוד?' },
  { category: 'policy', titleHe: 'ילדים וגיל', askHe: 'מאיזה גיל מתאים? מה לגבי משפחות?' },
  { category: 'logistics', titleHe: 'חניה והגעה', askHe: 'איפה חונים? איך מגיעים בתחבורה ציבורית?' },
  { category: 'policy', titleHe: 'מזג אוויר', askHe: 'מה קורה אם יורד גשם?' },
  { category: 'policy', titleHe: 'ביטולים', askHe: 'עד מתי אפשר לבטל, ומה קורה אז?' },
];

function KnowledgeStep({ onNext }) {
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api.aiAgent.knowledge();
    setItems(res.items || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add(prompt) {
    if (!body.trim()) return;
    setBusy(true);
    try {
      const created = await api.aiAgent.knowledgeCreate({
        title: prompt.titleHe, body: body.trim(), category: prompt.category, language: 'both',
      });
      // Created as draft by the API; approve it here so setup produces something
      // that actually affects behaviour rather than a pile of inert drafts.
      await api.aiAgent.knowledgeStatus(created.item.id, 'approved');
      setBody('');
      setOpen(null);
      await load();
    } finally { setBusy(false); }
  }

  const approved = (items || []).filter((i) => i.status === 'approved');

  return (
    <div className="space-y-4">
      <Card title="מה זה ״ידע״">
        <p className="gos-detail text-gray-700">
          עובדות שהסוכן רשאי להסתמך עליהן כשהוא עונה. כל דבר שהוא לא מוצא כאן ולא מוצא
          בנתונים החיים של המערכת — הוא <strong>לא ימציא</strong>, אלא יעביר אליך.
        </p>
        <p className="gos-meta mt-2">
          {approved.length
            ? `כרגע יש ${approved.length} עובדות מאושרות.`
            : 'כרגע אין אף עובדה מאושרת, ולכן הוא מעביר אליך כל שאלה עובדתית.'}
        </p>
      </Card>

      <Card title="שאלות שלקוחות שואלים אתכם בפועל">
        <p className="gos-meta mb-3">
          לחץ על שאלה וכתוב את התשובה במילים שלכם. אנחנו לא ממלאים את זה בשבילכם — אלה
          העובדות של העסק שלכם.
        </p>
        <div className="space-y-2">
          {KNOWLEDGE_PROMPTS.map((p) => {
            const existing = approved.find((i) => i.title === p.titleHe);
            const isOpen = open === p.titleHe;
            return (
              <div key={p.titleHe} className="rounded-lg border border-gray-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="gos-detail font-medium text-gray-900">{p.titleHe}</span>
                  {existing && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[12px] text-emerald-800">נוסף ✓</span>}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setOpen(isOpen ? null : p.titleHe); setBody(''); }}
                    className="ms-auto rounded-lg border border-gray-300 px-2.5 py-1 text-[12px] text-gray-700 hover:bg-gray-50"
                  >
                    {isOpen ? 'סגור' : existing ? 'הוסף עוד' : 'כתוב תשובה'}
                  </button>
                </div>
                <div className="gos-meta mt-0.5">{p.askHe}</div>
                {existing && <div dir="auto" className="gos-detail mt-1 rounded bg-gray-50 p-2 text-gray-700">{existing.body}</div>}
                {isOpen && (
                  <div className="mt-2">
                    <textarea
                      dir="auto"
                      rows={3}
                      autoFocus
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="כתוב כאן בדיוק מה נכון לומר ללקוח."
                      className="w-full rounded-lg border border-blue-300 p-2 text-[14px]"
                    />
                    <button
                      type="button"
                      onClick={() => add(p)}
                      disabled={busy || !body.trim()}
                      className="mt-2 rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {busy ? 'שומר…' : 'הוסף והפעל'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <NextButton onClick={onNext}>סיימתי — מה עכשיו?</NextButton>
    </div>
  );
}

// ── Step D: start observing ──────────────────────────────────────────────────

function DoneStep() {
  const [home, setHome] = useState(null);
  const navigate = useNavigate();
  useEffect(() => { api.aiAgent.home().then(setHome).catch(() => setHome(null)); }, []);

  const enabled = home?.settings?.enabled;

  return (
    <div className="space-y-4">
      <Card title="זה מספיק כדי להתחיל">
        <p className="gos-detail text-gray-700">
          מעכשיו הסוכן יקרא שיחות אמיתיות עם לקוחות ויכין תשובה לכל אחת. הוא{' '}
          <strong>עדיין לא שולח כלום</strong> — כל הקטגוריות במצב צל, כלומר הוא רק רושם מה
          היה עונה.
        </p>
        <p className="gos-detail mt-2 text-gray-700">
          אחרי כמה ימים של שיחות אמיתיות תוכל לראות איפה הוא צודק, לתקן איפה שלא, ורק אז
          להחליט לאיזו קטגוריה לתת סמכות אמיתית.
        </p>
      </Card>

      {home && !enabled && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="gos-detail font-semibold text-amber-900">הסוכן עדיין כבוי</div>
          <p className="gos-detail mt-1 text-amber-900">בלי להדליק אותו הוא לא יקרא אף שיחה.</p>
          <Link to="/admin/ai-agent/authority" className="mt-2 inline-block rounded-lg bg-amber-600 px-3 py-1.5 text-[13px] font-semibold text-white">
            פתח הרשאות והדלק
          </Link>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => navigate('/admin/ai-agent/review?status=shadow')}
          className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-700"
        >
          ראה מה הסוכן היה עונה
        </button>
        <Link to="/admin/ai-agent" className="rounded-lg border border-gray-300 px-4 py-2 text-[13px] text-gray-700 transition hover:bg-gray-50">
          חזרה למסך הבית
        </Link>
      </div>
    </div>
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────

function Card({ title, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="gos-detail mb-2 font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

function Level({ labelHe, bodyHe, tone }) {
  const tones = {
    slate: 'border-slate-200 bg-slate-50 text-slate-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
      <div className="gos-detail font-semibold">{labelHe}</div>
      <div className="gos-detail mt-0.5 opacity-90">{bodyHe}</div>
    </div>
  );
}

function ConceptRow({ titleHe, exampleHe, bodyHe }) {
  return (
    <div className="mb-3 last:mb-0 border-s-2 border-gray-200 ps-3">
      <div className="gos-detail font-semibold text-gray-900">{titleHe}</div>
      <div className="gos-detail text-gray-700">{bodyHe}</div>
      <div className="gos-meta mt-0.5">{exampleHe}</div>
    </div>
  );
}

function NextButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-700"
    >
      {children}
    </button>
  );
}
