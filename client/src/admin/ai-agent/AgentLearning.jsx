import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { fmtDateTime } from './config.js';

const CATEGORY_LABELS = { knowledge: 'עובדה', playbook: 'שיטת עבודה', style: 'סגנון' };
const STRENGTH_LABELS = { initial: 'ראשוני', moderate: 'בינוני', strong: 'חזק' };
const STRENGTH_STYLE = {
  initial: 'bg-gray-100 text-gray-600',
  moderate: 'bg-amber-50 text-amber-800',
  strong: 'bg-emerald-50 text-emerald-800',
};

const FILTERS = [
  { key: 'open', label: 'ממתין להחלטה' },
  { key: 'approved', label: 'אושרו' },
  { key: 'rejected', label: 'נדחו' },
];

// למידה — the insight inbox.
//
// The safety property this screen makes visible: the agent NEVER rewrites its
// own instructions. Everything here is a PROPOSAL with the actual cases behind
// it, and approving one creates a DRAFT rule that still has to be approved on
// the Knowledge screen. Two human decisions before behaviour changes.
export default function AgentLearning() {
  const [filter, setFilter] = useState('open');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.aiAgent.insights({ status: filter });
      setRows(res.insights || []);
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e.message);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    setGenerating(true);
    setNote(null);
    setError(null);
    try {
      const res = await api.aiAgent.insightsGenerate(30);
      setNote(
        res.created > 0
          ? `נוצרו ${res.created} תובנות חדשות לבדיקה.`
          : res.reason === 'not_enough_evidence'
            ? `אין עדיין מספיק עדויות (${res.evidence || 0} מקרים שהוכרעו). התובנות נבנות רק מדפוס חוזר, לא ממקרה בודד.`
            : 'לא נמצאו תובנות חדשות מעבר למה שכבר ממתין להחלטה.',
      );
      load();
    } catch (e) {
      setError(e?.payload?.error === 'provider_not_configured'
        ? 'שירות ה-AI לא מוגדר בשרת.'
        : (e?.payload?.error || 'יצירת התובנות נכשלה'));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h1 className="gos-title text-[18px]">למידה</h1>
        <div className="ms-auto flex items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-md px-2.5 py-1 text-[13px] transition ${
                filter === f.key ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {f.label}
            </button>
          ))}
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? 'מנתח…' : 'חפש תובנות חדשות'}
          </button>
        </div>
      </div>

      <p className="gos-meta mb-4 max-w-3xl">
        הסוכן לא משנה את ההוראות של עצמו. כאן הוא רק <strong>מציע</strong> שינוי, על סמך דפוס
        חוזר בעריכות ובדחיות שלכם. אישור יוצר <strong>טיוטה</strong> במסך הידע — היא עדיין
        צריכה אישור נפרד שם כדי להשפיע על התנהגות הסוכן.
      </p>

      {note && <div className="mb-3 rounded bg-blue-50 px-3 py-2 text-[13px] text-blue-900">{note}</div>}
      {error && <div className="mb-3 rounded bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</div>}

      {rows === null && <div className="gos-meta">טוען…</div>}
      {rows?.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-10 text-center">
          <div className="gos-detail text-gray-700">אין תובנות להצגה.</div>
          <div className="gos-meta mt-1">
            תובנות נוצרות מדפוס חוזר — אחרי שהסוכן יציע תשובות ותערכו או תדחו כמה מהן.
          </div>
        </div>
      )}

      <div className="space-y-3">
        {(rows || []).map((i) => <InsightCard key={i.id} insight={i} onHandled={load} />)}
      </div>
    </div>
  );
}

function InsightCard({ insight, onHandled }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(insight.proposedChange);
  const [title, setTitle] = useState(insight.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const open = insight.status === 'open';

  useEffect(() => {
    setText(insight.proposedChange);
    setTitle(insight.title);
    setEditing(false);
  }, [insight.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      await api.aiAgent.insightApprove(insight.id, { proposedChange: text, title });
      onHandled();
    } catch (e) {
      setError(e?.payload?.error || 'האישור נכשל');
    } finally { setBusy(false); }
  }

  async function reject() {
    setBusy(true);
    try {
      await api.aiAgent.insightReject(insight.id, null);
      onHandled();
    } catch (e) {
      setError(e?.payload?.error || 'הדחייה נכשלה');
    } finally { setBusy(false); }
  }

  const evidence = Array.isArray(insight.evidenceRefs) ? insight.evidenceRefs : [];

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded bg-purple-50 px-2 py-0.5 text-[12px] font-medium text-purple-800">
          {CATEGORY_LABELS[insight.category] || insight.category}
        </span>
        <span className={`rounded px-2 py-0.5 text-[12px] ${STRENGTH_STYLE[insight.strength]}`}>
          ביסוס {STRENGTH_LABELS[insight.strength]} · {insight.evidenceCount} מקרים
        </span>
        {insight.status !== 'open' && (
          <span className="gos-meta">
            {insight.status === 'approved' ? 'אושר' : 'נדחה'} {fmtDateTime(insight.reviewedAt)}
          </span>
        )}
        <span className="gos-meta ms-auto">{fmtDateTime(insight.createdAt)}</span>
      </div>

      {editing ? (
        <input
          dir="auto"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-2 w-full rounded-lg border border-blue-300 p-2 text-[15px] font-semibold"
        />
      ) : (
        <h3 className="gos-title-sm mb-1 text-gray-900">{insight.title}</h3>
      )}

      {editing ? (
        <textarea
          dir="auto"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full rounded-lg border border-blue-300 p-2 text-[14px]"
        />
      ) : (
        <div dir="auto" className="gos-detail whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-gray-800">
          {insight.proposedChange}
        </div>
      )}

      {insight.rationale && (
        <div className="gos-meta mt-2">למה: {insight.rationale}</div>
      )}

      {insight.appliedRecordId && (
        <div className="mt-2 rounded bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">
          נוצרה טיוטה במסך <Link className="underline" to="/admin/ai-agent/knowledge">ידע</Link>. היא עדיין צריכה אישור שם.
        </div>
      )}
      {insight.status === 'approved' && !insight.appliedRecordId && insight.category === 'style' && (
        <div className="mt-2 rounded bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          תובנת סגנון לא יוצרת רשומה חדשה — עדכנו את השדה המתאים בפרופיל הסגנון במסך{' '}
          <Link className="underline" to="/admin/ai-agent/knowledge">ידע</Link>.
        </div>
      )}

      {error && <div className="mt-2 rounded bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</div>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {open && (
          <>
            <button
              type="button"
              onClick={approve}
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? 'שומר…' : 'אשר — צור טיוטה'}
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setEditing((v) => !v)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50"
            >
              {editing ? 'סיים עריכה' : 'ערוך'}
            </button>
            <button
              type="button"
              onClick={reject}
              disabled={busy}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50"
            >
              דחה
            </button>
          </>
        )}
        {evidence.length > 0 && (
          <button
            type="button"
            onClick={() => setShowEvidence((v) => !v)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50"
          >
            {showEvidence ? 'סגור עדויות' : `הצג ${evidence.length} עדויות`}
          </button>
        )}
      </div>

      {showEvidence && (
        <div className="mt-3 space-y-2">
          {evidence.map((e, idx) => (
            <div key={idx} className="rounded-lg border border-gray-200 bg-gray-50 p-2">
              <div className="gos-meta mb-0.5">
                מקרה {idx + 1} · {e.outcome === 'sent_edited' ? 'נערך לפני שליחה' : e.outcome === 'rejected' ? 'נדחה' : 'המפעיל ענה בעצמו'}
              </div>
              <div dir="auto" className="gos-detail whitespace-pre-wrap text-gray-800">{e.excerpt || '—'}</div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
