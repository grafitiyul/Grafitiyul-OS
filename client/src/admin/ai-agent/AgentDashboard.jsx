import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { RISK_STYLE, RISK_LABELS, ratePct } from './config.js';

// סקירה — the state of the agent, understandable in seconds.
//
// It answers, in this order and no other:
//   1. is it on, is it configured, is anything waiting for me?
//   2. how much work is it helping with?
//   3. where is it good / bad?
//   4. what could safely become more automated?
//
// Every rate is shown WITH its denominator, and a rate with no denominator is
// rendered as "אין מספיק נתונים" rather than as 0% — a number that looks
// authoritative but is not is worse than no number.
export default function AgentDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    try {
      setData(await api.aiAgent.metrics({ days }));
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e.message);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="p-4 text-rose-700">{error}</div>;
  if (!data) return <div className="p-4 gos-meta">טוען…</div>;

  const { runs, proposals, capabilities, readinessRule, escalationReasons, settings, providerConfigured } = data;
  const readyCandidates = capabilities.filter((c) => c.ready);

  return (
    <div className="mx-auto max-w-6xl p-4">
      {/* ── 1. State ──────────────────────────────────────────────────── */}
      {!providerConfigured && (
        <Banner tone="rose" title="הסוכן לא מוגדר בשרת">
          חסר <code dir="ltr" className="rounded bg-white/60 px-1 font-mono text-[12px]">ANTHROPIC_API_KEY</code> בסביבת
          השרת. עד שהוא יוגדר, הסוכן לא מנתח שום שיחה.
        </Banner>
      )}
      {providerConfigured && !settings.enabled && (
        <Banner tone="gray" title="הסוכן כבוי">
          הוא לא מנתח שיחות כרגע. אפשר להדליק אותו במסך <Link className="underline" to="/admin/ai-agent/authority">הרשאות</Link>.
          גם כשהוא דלוק, הוא מתחיל במצב צל — הוא לא שולח כלום.
        </Banner>
      )}
      {providerConfigured && settings.enabled && (
        <Banner tone="emerald" title="הסוכן פעיל">
          הוא מנתח שיחות ורושם מה היה עונה. שום הודעה לא נשלחת ללקוח בלי אישור אנושי מפורש.
        </Banner>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h1 className="gos-title text-[18px]">סקירה</h1>
        <div className="flex items-center gap-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-md px-2.5 py-1 text-[13px] transition ${
                days === d ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {d} ימים
            </button>
          ))}
        </div>
      </div>

      {/* ── What needs my attention ───────────────────────────────────── */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="ממתין לאישור"
          value={proposals.open}
          tone={proposals.open > 0 ? 'amber' : 'neutral'}
          to="/admin/ai-agent/review"
        />
        <Stat label="הועברו לאדם" value={runs.escalations} hint={ratePct(runs.escalationRate) ? `${ratePct(runs.escalationRate)} מהניתוחים` : null} />
        <Stat label="תקלות" value={runs.failures} tone={runs.failures > 0 ? 'rose' : 'neutral'} to="/admin/ai-agent/history?status=failed" />
        <Stat label="שיחות שנותחו" value={runs.analysed} />
      </div>

      {/* ── 2. How much is it helping ─────────────────────────────────── */}
      <Card title="מה קרה עם ההצעות">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <MiniStat label="נשלחו ללא שינוי" value={proposals.sentUnchanged} tone="emerald" />
          <MiniStat label="נשלחו אחרי עריכה" value={proposals.sentEdited} tone="sky" />
          <MiniStat label="נדחו" value={proposals.rejected} tone="rose" />
          <MiniStat label="המפעיל ענה בעצמו" value={proposals.bypassed} />
          <MiniStat label="נרשמו בצל" value={proposals.shadow} />
        </div>
        <div className="gos-meta mt-2">
          זמן תגובה ממוצע: {runs.avgLatencyMs != null ? `${(runs.avgLatencyMs / 1000).toFixed(1)} שניות` : '—'}
          {' · '}
          טוקנים: {(runs.inputTokens || 0).toLocaleString('he-IL')} קלט / {(runs.outputTokens || 0).toLocaleString('he-IL')} פלט
        </div>
      </Card>

      {/* ── 3. Where is it good / bad ─────────────────────────────────── */}
      <Card title="איכות לפי סוג מצב">
        {capabilities.every((c) => c.handled === 0) ? (
          <EmptyState>
            עדיין אין החלטות אנושיות על הצעות, ולכן אין מה למדוד. אחרי שהסוכן ירוץ במצב צל
            ותתחילו לאשר או לדחות הצעות — הטבלה הזו תתמלא.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-gray-200 text-start">
                  <Th>מצב</Th><Th>נצפו</Th><Th>הוכרעו</Th><Th>ללא שינוי</Th><Th>נערכו</Th><Th>נדחו</Th><Th>מוכן לאוטומציה?</Th>
                </tr>
              </thead>
              <tbody>
                {capabilities.filter((c) => c.observed > 0).map((c) => (
                  <tr key={c.key} className="border-b border-gray-100 last:border-0">
                    <td className="py-2">
                      <div className="gos-detail font-medium text-gray-900">{c.labelHe}</div>
                      <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[11px] ${RISK_STYLE[c.risk]}`}>
                        {RISK_LABELS[c.risk]}
                      </span>
                    </td>
                    <td className="py-2 tabular-nums">{c.observed}</td>
                    <td className="py-2 tabular-nums">{c.handled}</td>
                    <td className="py-2 tabular-nums">
                      {c.handled ? <>{c.unchanged} <span className="gos-meta">({ratePct(c.unchangedRate)})</span></> : <span className="gos-meta">—</span>}
                    </td>
                    <td className="py-2 tabular-nums">{c.edited}</td>
                    <td className="py-2 tabular-nums">{c.rejected + c.bypassed}</td>
                    <td className="py-2">
                      {c.ready ? (
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-800">כן — לשיקולך</span>
                      ) : c.readyBlockedByCeiling ? (
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-[12px] text-gray-600">חסום בקוד — אנושי בלבד</span>
                      ) : (
                        <span className="gos-meta">
                          {c.handled < readinessRule.minSamples ? `צריך ${readinessRule.minSamples} מקרים (יש ${c.handled})` : 'לא עומד בסף'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="gos-meta mt-2">כלל המוכנות: {readinessRule.textHe} זו המלצה בלבד — שום דבר לא משתנה לבד.</div>
      </Card>

      {/* ── 4. What could become more automated ───────────────────────── */}
      {readyCandidates.length > 0 && (
        <Card title="מועמדים להרחבת סמכות">
          <ul className="space-y-1">
            {readyCandidates.map((c) => (
              <li key={c.key} className="gos-detail text-gray-800">
                • <strong>{c.labelHe}</strong> — {c.unchanged} מתוך {c.handled} נשלחו ללא שינוי ({ratePct(c.unchangedRate)}).
                {' '}<Link className="text-blue-700 underline" to="/admin/ai-agent/authority">שנה הרשאה</Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Why it escalates: the shopping list for Knowledge ──────────── */}
      {escalationReasons?.length > 0 && (
        <Card title="למה הסוכן מעביר לאדם">
          <div className="gos-meta mb-2">כל שורה כאן היא ידע שחסר לו. זו רשימת הקניות של מסך הידע.</div>
          <ul className="space-y-1">
            {escalationReasons.map((e, i) => (
              <li key={i} className="gos-detail text-gray-800">
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[12px]">{e.labelHe}</span>{' '}
                {e.reason} <span className="gos-meta">({e.count})</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.recentFailures?.length > 0 && (
        <Card title="תקלות אחרונות">
          <ul className="space-y-1">
            {data.recentFailures.map((f) => (
              <li key={f.id} className="gos-detail text-rose-800">
                <code dir="ltr" className="font-mono text-[12px]">{f.errorCode}</code> — {f.errorMessage || 'ללא פירוט'}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Banner({ tone, title, children }) {
  const tones = {
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
    gray: 'border-gray-200 bg-gray-100 text-gray-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };
  return (
    <div className={`mb-4 rounded-lg border px-4 py-3 text-[13px] ${tones[tone]}`}>
      <div className="gos-detail font-semibold">{title}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="gos-detail mb-3 font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, hint, tone = 'neutral', to }) {
  const tones = {
    neutral: 'border-gray-200 bg-white',
    amber: 'border-amber-300 bg-amber-50',
    rose: 'border-rose-300 bg-rose-50',
  };
  const body = (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <div className="text-[26px] font-semibold leading-none tabular-nums text-gray-900">{value ?? 0}</div>
      <div className="gos-detail mt-1 text-gray-700">{label}</div>
      {hint && <div className="gos-meta mt-0.5">{hint}</div>}
    </div>
  );
  return to ? <Link to={to} className="block transition hover:opacity-80">{body}</Link> : body;
}

function MiniStat({ label, value, tone }) {
  const tones = { emerald: 'text-emerald-700', sky: 'text-sky-700', rose: 'text-rose-700' };
  return (
    <div>
      <div className={`text-[20px] font-semibold tabular-nums ${tones[tone] || 'text-gray-900'}`}>{value ?? 0}</div>
      <div className="gos-meta">{label}</div>
    </div>
  );
}

function Th({ children }) {
  return <th className="gos-meta py-2 text-start font-normal">{children}</th>;
}

function EmptyState({ children }) {
  return <div className="rounded-lg bg-gray-50 px-4 py-6 text-center gos-detail text-gray-600">{children}</div>;
}
