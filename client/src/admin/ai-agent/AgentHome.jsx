import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import SafetyPanel, { ModeRollup } from './SafetyPanel.jsx';
import OnboardingCard from './OnboardingCard.jsx';
import { fmtDateTime } from './config.js';

// בית — the operator's landing screen.
//
// It answers four questions, in this order, without opening another tab:
//   1. What is the agent doing right now, and can it message customers?
//   2. What needs me today?
//   3. What is it missing? (i.e. what should I teach it)
//   4. Is anything ready for more authority?
//
// It replaced a dashboard of zeros. The old analytics did not disappear —
// per-capability quality now lives next to the decision it informs (הרשאות),
// and volume/latency lives with the runs it describes (היסטוריה).
export default function AgentHome() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      setData(await api.aiAgent.home({ days: 30 }));
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  if (error) return <div className="p-4 text-rose-700">{error}</div>;
  if (!data) return <div className="p-4 gos-meta">טוען…</div>;

  const { safety, onboarding, attention, activity, brain, missingKnowledge, readyForPromotion, providerConfigured } = data;

  return (
    <div className="mx-auto max-w-5xl p-4">
      {/* ── 1. Status headline ─────────────────────────────────────────── */}
      <StatusHeadline headline={safety.headline} providerConfigured={providerConfigured} />

      {/* ── Onboarding, only while it is genuinely unfinished ───────────── */}
      {!onboarding.configured && <OnboardingCard onboarding={onboarding} />}

      {/* ── 2. What needs me today ─────────────────────────────────────── */}
      <section className="mb-4">
        <h2 className="gos-detail mb-2 font-semibold text-gray-900">מה מחכה לך</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {attention.map((a) => <AttentionCard key={a.key} item={a} />)}
        </div>
      </section>

      {/* ── Safety + authority rollup, side by side on desktop ─────────── */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <SafetyPanel safety={safety} />
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="gos-detail mb-1 font-semibold text-gray-900">סמכות לפי סוג מצב</h2>
          <p className="gos-meta mb-3">
            {safety.counts.total} סוגי פניות. לחיצה פותחת את מסך ההרשאות.
          </p>
          <ModeRollup counts={safety.counts} onNavigate={(mode) => navigate(`/admin/ai-agent/authority?mode=${mode}`)} />

          {readyForPromotion.length > 0 && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="gos-detail font-semibold text-emerald-900">מועמדים להרחבת סמכות</div>
              <ul className="mt-1 space-y-1">
                {readyForPromotion.map((c) => (
                  <li key={c.key} className="gos-detail text-emerald-900">
                    • <strong>{c.labelHe}</strong> — {c.reasonHe}
                  </li>
                ))}
              </ul>
              <Link to="/admin/ai-agent/authority" className="gos-meta mt-1 inline-block text-emerald-800 underline">
                פתח הרשאות
              </Link>
            </div>
          )}
        </section>
      </div>

      {/* ── 3. What the agent is missing ───────────────────────────────── */}
      <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="gos-detail mb-1 font-semibold text-gray-900">מה חסר לסוכן</h2>
        <p className="gos-meta mb-3">
          כל שורה כאן היא שיחה אמיתית שבה הוא לא ידע לענות והעביר אליך. זו רשימת הקניות של מסך הידע.
        </p>
        {missingKnowledge.length === 0 ? (
          <EmptyBox>
            {activity.analysed === 0
              ? 'הסוכן עוד לא ניתח אף שיחה, אז אין עדיין מה ללמוד ממנו. ברגע שיגיעו הודעות מלקוחות — הוא יתחיל לרשום מה חסר לו.'
              : 'הסוכן לא נתקע על אף שיחה בתקופה הזו.'}
          </EmptyBox>
        ) : (
          <ul className="space-y-1.5">
            {missingKnowledge.map((m, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[12px] text-gray-700">{m.labelHe}</span>
                <span className="gos-detail flex-1 text-gray-800">{m.reason}</span>
                <span className="gos-meta tabular-nums">×{m.count}</span>
              </li>
            ))}
          </ul>
        )}
        <Link
          to="/admin/ai-agent/knowledge"
          className="mt-3 inline-block rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] text-gray-700 transition hover:bg-gray-50"
        >
          פתח את הידע של הסוכן
        </Link>
      </section>

      {/* ── The brain, at a glance ─────────────────────────────────────── */}
      <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="gos-detail mb-1 font-semibold text-gray-900">מה הסוכן יודע</h2>
        <p className="gos-meta mb-3">רק פריטים מאושרים משפיעים על התנהגותו. טיוטות לא.</p>
        <div className="grid grid-cols-3 gap-3">
          <BrainStat labelHe="עובדות" sub="מה נכון" approved={brain.knowledgeApproved} draft={brain.knowledgeDraft} />
          <BrainStat labelHe="כללי עבודה" sub="מה עושים" approved={brain.playbookApproved} draft={brain.playbookDraft} />
          <BrainStat labelHe="פרופילי סגנון" sub="איך אומרים" approved={brain.styleApproved} draft={brain.styleTotal - brain.styleApproved} />
        </div>
      </section>

      {/* ── Activity strip ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="gos-detail mb-2 font-semibold text-gray-900">פעילות (30 יום)</h2>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <Metric labelHe="שיחות שנותחו" value={activity.analysed} />
          <Metric labelHe="הועברו לאדם" value={activity.escalations} />
          <Metric labelHe="הצעות שהוכרעו" value={activity.handled} />
          <Metric labelHe="תקלות" value={activity.failed} />
        </div>
        <div className="gos-meta mt-2">
          {activity.lastRunAt ? `ניתוח אחרון: ${fmtDateTime(activity.lastRunAt)}` : 'עדיין לא היה ניתוח'}
          {' · '}
          <Link to="/admin/ai-agent/history" className="underline">היסטוריה מלאה</Link>
        </div>
      </section>
    </div>
  );
}

function StatusHeadline({ headline, providerConfigured }) {
  if (!providerConfigured) {
    return (
      <div className="mb-4 rounded-xl border border-rose-300 bg-rose-50 p-4">
        <h1 className="gos-title text-[18px] text-rose-900">הסוכן לא מוגדר בשרת</h1>
        <p className="gos-detail mt-1 text-rose-900">
          חסר <code dir="ltr" className="rounded bg-white/70 px-1 font-mono text-[12px]">ANTHROPIC_API_KEY</code>.
          עד שזה יסודר הוא לא ינתח שום שיחה.
        </p>
      </div>
    );
  }
  const tones = {
    off: { box: 'border-gray-300 bg-gray-100', title: 'text-gray-800', body: 'text-gray-700', dot: 'bg-gray-400' },
    shadow: { box: 'border-sky-300 bg-sky-50', title: 'text-sky-950', body: 'text-sky-900', dot: 'bg-sky-500' },
    approval: { box: 'border-amber-300 bg-amber-50', title: 'text-amber-950', body: 'text-amber-900', dot: 'bg-amber-500' },
    live: { box: 'border-rose-300 bg-rose-50', title: 'text-rose-950', body: 'text-rose-900', dot: 'bg-rose-500' },
  };
  const t = tones[headline.tone] || tones.off;
  return (
    <div className={`mb-4 rounded-xl border p-4 ${t.box}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${t.dot}`} aria-hidden />
        <h1 className={`gos-title text-[18px] ${t.title}`}>{headline.titleHe}</h1>
      </div>
      <p className={`gos-detail mt-1 ${t.body}`}>{headline.bodyHe}</p>
    </div>
  );
}

function AttentionCard({ item }) {
  const tones = {
    neutral: 'border-gray-200 bg-white',
    amber: 'border-amber-300 bg-amber-50',
    purple: 'border-purple-300 bg-purple-50',
    orange: 'border-orange-300 bg-orange-50',
    rose: 'border-rose-300 bg-rose-50',
  };
  return (
    <Link to={item.to} className={`block rounded-xl border p-3 transition hover:opacity-80 ${tones[item.tone] || tones.neutral}`}>
      <div className="text-[26px] font-semibold leading-none tabular-nums text-gray-900">{item.count}</div>
      <div className="gos-detail mt-1 text-gray-800">{item.labelHe}</div>
      {item.count === 0 && <div className="gos-meta mt-0.5">{item.emptyHe}</div>}
    </Link>
  );
}

function BrainStat({ labelHe, sub, approved, draft }) {
  return (
    <div>
      <div className="text-[22px] font-semibold leading-none tabular-nums text-gray-900">{approved}</div>
      <div className="gos-detail mt-0.5 text-gray-800">{labelHe}</div>
      <div className="gos-meta">{sub}{draft > 0 ? ` · ${draft} בטיוטה` : ''}</div>
    </div>
  );
}

function Metric({ labelHe, value }) {
  return (
    <div>
      <span className="text-[18px] font-semibold tabular-nums text-gray-900">{value ?? 0}</span>
      <span className="gos-meta ms-1.5">{labelHe}</span>
    </div>
  );
}

function EmptyBox({ children }) {
  return <div className="rounded-lg bg-gray-50 px-4 py-5 gos-detail text-gray-600">{children}</div>;
}
