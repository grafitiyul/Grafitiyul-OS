import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import SettingsChrome from '../settings/SettingsChrome.jsx';
import Toggle from '../common/Toggle.jsx';
import { StatusBadge, fmtWhen, RUN_STATUS_HE, RUN_TONE } from './parts.jsx';

// One automation, read-only. The layout answers, in order:
//   1. is it running, and if not — why?      (status + dependencies)
//   2. what makes it fire?                   (trigger + condition)
//   3. what does it actually do?             (the execution chain, resolved live)
//   4. what has it done?                     (run history with reasons)
//
// Nothing describing behaviour is editable here. The only controls are the
// operator's on/off switch and copy-id.

export default function AutomationDetailPage() {
  const { autId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.automations.get(autId));
    } catch (e) {
      setError(e.payload?.error === 'automation_not_found' ? 'האוטומציה אינה קיימת' : (e.payload?.error || e.message));
    }
  }, [autId]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (enabled) => {
    setBusy(true);
    try {
      setData(await api.automations.setEnabled(autId, enabled));
    } catch (e) {
      setError(e.payload?.error || e.message);
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="px-5 py-8 lg:px-10" dir="rtl"><SettingsChrome />
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>
      </div>
    );
  }
  if (!data) {
    return <div className="px-5 py-8 lg:px-10" dir="rtl"><SettingsChrome /><div className="py-10 text-center text-[13px] text-gray-400">טוען…</div></div>;
  }

  const d = data.definition;
  const retired = data.retired;

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10" dir="rtl">
      <SettingsChrome currentLabel={d?.nameHe || data.id} />
      <div className="space-y-5">
        {/* 1. Header — identity + live status */}
        <header className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-start gap-3">
            <code
              className="rounded bg-gray-100 px-2 py-1 font-mono text-[13px] text-gray-700"
              dir="ltr"
              title="לחצו להעתקה"
              role="button"
              tabIndex={0}
              onClick={() => navigator.clipboard?.writeText(data.id)}
              onKeyDown={(e) => e.key === 'Enter' && navigator.clipboard?.writeText(data.id)}
            >
              {data.id}
            </code>
            <div className="flex-1">
              <div className="text-[16px] font-semibold text-gray-900">{d?.nameHe || data.id}</div>
              {d?.descriptionHe ? <div className="mt-0.5 text-[13px] text-gray-600">{d.descriptionHe}</div> : null}
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <StatusBadge status={data.health.status} label={data.health.statusHe} />
              {data.health.secondary?.map((s) => (
                <StatusBadge key={s.status} status={s.status} label={s.statusHe} small />
              ))}
            </div>
          </div>
          {data.health.reasonHe ? (
            <div className="mt-2.5 text-[12.5px] text-gray-600">{data.health.reasonHe}</div>
          ) : null}

          {retired ? (
            <div className="mt-3 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-[12.5px] text-gray-600">
              האוטומציה הוסרה ב-{retired.retiredOn} · {retired.reasonHe}. המזהה שמור לצמיתות ולא ישמש שוב.
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-3 border-t border-gray-100 pt-3">
              <Toggle
                checked={data.health.enabled}
                disabled={busy}
                onChange={toggle}
                label={data.health.enabled ? 'פעילה' : 'מושבתת'}
                showLabel
              />
              <span className="text-[11.5px] text-gray-500">
                השבתה עוצרת את האוטומציה מיידית. ההגדרה עצמה נשארת בקוד.
              </span>
            </div>
          )}
        </header>

        {/* 2. Dependencies — the "why isn't this running" answer */}
        {data.dependencies.length ? (
          <Card title="תלויות">
            <ul className="space-y-2">
              {data.dependencies.map((dep, i) => (
                <li key={i} className="flex flex-wrap items-start gap-2 text-[12.5px]">
                  <span className={dep.ok ? 'text-emerald-600' : dep.severity === 'hard' ? 'text-red-600' : 'text-amber-600'}>
                    {dep.ok ? '✓' : dep.severity === 'hard' ? '✕' : '⏳'}
                  </span>
                  <div className="flex-1">
                    <div className="font-medium text-gray-800">{dep.labelHe}</div>
                    <div className={dep.ok ? 'text-gray-500' : 'text-gray-700'}>{dep.detailHe}</div>
                  </div>
                  {dep.link ? <Link to={dep.link} className="text-blue-600 hover:underline">פתיחה ↗</Link> : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {/* 3. Trigger + condition */}
        {d ? (
          <Card title="מתי האוטומציה מופעלת">
            <Row label="מקור הפעלה" value={d.triggerHe} />
            <Row label="שאלון" value={d.questionnaireKey} mono />
            {d.purpose ? <Row label="ייעוד" value={d.purpose} mono /> : null}
            <Row label="תנאי התשובות" value={d.conditionHe} />
            <Row label="הגשה חוזרת" value={d.idempotencyHe} />
            <p className="mt-2 text-[11.5px] text-gray-500">
              התנאי מתייחס למפתחות קבועים של השאלות והתשובות. שינוי נוסח השאלה או
              סדר השאלות אינו משפיע על האוטומציה.
            </p>
          </Card>
        ) : null}

        {/* 4. The execution chain, resolved live from the Communication Center */}
        {d ? (
          <Card title="שרשרת הפעולות">
            <ol className="space-y-3">
              {d.actions.map((a) => (
                <li key={a.order} className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[11px] text-white">{a.order}</span>
                    <span className="font-medium text-gray-900">{a.labelHe}</span>
                    {a.ownerLink ? (
                      <Link to={a.ownerLink} className="text-[12px] text-blue-600 hover:underline">
                        {a.ownerLabelHe} ↗
                      </Link>
                    ) : null}
                  </div>
                  {a.kind === 'communication' ? (
                    <CommunicationRules rules={data.communicationRules} />
                  ) : null}
                  {a.retryHe ? <div className="mt-2 text-[11.5px] text-gray-500">{a.retryHe}</div> : null}
                </li>
              ))}
            </ol>
          </Card>
        ) : null}

        {/* 5. Run history — every stop explained */}
        <Card title={`היסטוריית הרצות (${data.stats.totalRuns})`}>
          {data.runs.length === 0 ? (
            <div className="py-6 text-center text-[12.5px] text-gray-400">האוטומציה טרם רצה</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[12.5px]">
                <thead className="text-[11.5px] text-gray-500">
                  <tr>
                    <th className="px-2 py-1.5 text-start font-medium">מתי</th>
                    <th className="px-2 py-1.5 text-start font-medium">תוצאה</th>
                    <th className="px-2 py-1.5 text-start font-medium">פירוט</th>
                    <th className="px-2 py-1.5 text-start font-medium">הגשה</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.runs.map((r) => (
                    <tr key={r.id}>
                      <td className="px-2 py-2 text-gray-600">{fmtWhen(r.startedAt)}</td>
                      <td className="px-2 py-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${RUN_TONE[r.status] || ''}`}>
                          {RUN_STATUS_HE[r.status] || r.status}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-gray-700">{r.reasonHe || '—'}</td>
                      <td className="px-2 py-2">
                        {r.tourEventId ? (
                          <Link to={`/admin/tours/${r.tourEventId}`} className="text-blue-600 hover:underline">סיור ↗</Link>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* 6. Change history — auto-detected definition drift + operator actions */}
        {data.changes.length ? (
          <Card title="היסטוריית שינויים">
            <ul className="space-y-1.5 text-[12.5px]">
              {data.changes.map((c, i) => (
                <li key={i} className="flex flex-wrap gap-2">
                  <span className="text-gray-400">{fmtWhen(c.createdAt)}</span>
                  <span className="text-gray-800">{c.summaryHe}</span>
                  {c.actorName ? <span className="text-gray-500">· {c.actorName}</span> : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {d?.notesHe ? (
          <Card title="הערות יישום">
            <p className="text-[12.5px] leading-relaxed text-gray-700">{d.notesHe}</p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

/** The live-resolved Communication Center rules — by real #N number and status. */
function CommunicationRules({ rules }) {
  if (!rules?.length) {
    return (
      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-800">
        טרם הוגדר כלל תקשורת על הטריגר הזה — האוטומציה תרוץ אך לא תישלח הודעה.
        הגדירו אירוע חדש במרכז התקשורת ובחרו את הטריגר של האוטומציה.
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      {rules.map((e) => (
        <div key={e.id} className="rounded-lg border border-gray-200 bg-white p-2.5">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="font-medium text-gray-900">{e.internalName}</span>
            <span className={`rounded-full border px-1.5 text-[10.5px] ${
              e.status === 'active' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-300 bg-gray-100 text-gray-600'
            }`}>
              {e.status === 'active' ? 'פעיל' : e.status}
            </span>
            <Link to={e.link} className="text-[12px] text-blue-600 hover:underline">עריכה ↗</Link>
          </div>
          <ul className="mt-1.5 space-y-1">
            {e.messages.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 text-[12px] text-gray-700">
                <span className="font-mono text-[11.5px] text-gray-500" dir="ltr">#{m.number}</span>
                <span>{m.internalName || '—'}</span>
                <span className="text-gray-400">·</span>
                <span>{m.channel === 'email' ? 'אימייל' : 'WhatsApp'}</span>
                {!m.live ? <span className="rounded bg-gray-100 px-1.5 text-[10.5px] text-gray-500">לא פעיל</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Card({ title, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="mb-2.5 text-[14px] font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value, mono = false }) {
  if (!value) return null;
  return (
    <div className="flex flex-wrap gap-2 border-b border-gray-100 py-1.5 last:border-0 text-[12.5px]">
      <span className="w-32 shrink-0 text-gray-500">{label}</span>
      <span className={`flex-1 text-gray-800 ${mono ? 'font-mono text-[12px]' : ''}`} dir={mono ? 'ltr' : undefined}>{value}</span>
    </div>
  );
}
