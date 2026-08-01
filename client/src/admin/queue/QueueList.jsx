import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';

// The queue itself. Each row expands to the FULL rendered preview — the whole
// point of the screen is seeing exactly what will go out, to whom, and when.

const STATUS_TONE = {
  waiting: 'border-amber-200 bg-amber-50 text-amber-700',
  sending: 'border-blue-200 bg-blue-50 text-blue-700',
  sent: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
  skipped: 'border-gray-200 bg-gray-100 text-gray-600',
};

function fmt(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Strip HTML for the collapsed one-line summary; the expanded view keeps it. */
const plain = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

export default function QueueList({ channel, scope, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setData(null);
    try {
      const r = await api.queue.list({ channel, scope });
      setData(r);
      setError('');
      onChanged?.();
    } catch (e) {
      setError(e.payload?.error || e.message);
    }
  }, [channel, scope, onChanged]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>;
  }
  if (!data) return <div className="py-10 text-center text-[13px] text-gray-400">טוען…</div>;

  return (
    <div className="space-y-3">
      {/* An adapter that failed is reported rather than silently omitted — a
          queue view that quietly hides a source is worse than none. */}
      {data.errors?.length ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          חלק מהמקורות לא נטענו: {data.errors.join(' · ')}
        </div>
      ) : null}

      {data.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 py-12 text-center">
          <div className="text-[14px] font-medium text-gray-700">
            {scope === 'pending' ? 'אין הודעות בהמתנה' : 'אין היסטוריה להצגה'}
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {data.items.map((item) => {
            const expanded = open === item.key;
            return (
              <li key={item.key} className="rounded-xl border border-gray-200 bg-white">
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : item.key)}
                  className="flex w-full flex-wrap items-start gap-3 p-3.5 text-start"
                >
                  {item.queuePosition ? (
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-medium text-white" dir="ltr">
                      {item.queuePosition}
                    </span>
                  ) : <span className="w-6 shrink-0" />}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium text-gray-900">
                        {item.recipient.name || item.recipient.phone || item.recipient.email || 'ללא נמען'}
                      </span>
                      {item.recipient.kindHe ? (
                        <span className="rounded bg-gray-100 px-1.5 text-[10.5px] text-gray-600">{item.recipient.kindHe}</span>
                      ) : null}
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_TONE[item.status] || ''}`}>
                        {item.statusHe}
                      </span>
                    </div>

                    <div className="mt-0.5 truncate text-[12.5px] text-gray-600">
                      {item.preview.subject ? `${item.preview.subject} — ` : ''}
                      {plain(item.preview.body).slice(0, 120) || 'אין תצוגה מוקפאת עדיין'}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-gray-500">
                      <span>{item.origin.moduleHe}{item.origin.label ? ` · ${item.origin.label}` : ''}</span>
                      <span>מתוזמן: {fmt(item.scheduledAt)}</span>
                      {item.effectiveAt ? <span className="text-amber-700">יישלח: {fmt(item.effectiveAt)}</span> : null}
                    </div>

                    {/* The single most useful line on the screen. */}
                    {item.waitReasonHe ? (
                      <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-[11.5px] text-amber-800">
                        ⏳ {item.waitReasonHe}
                      </div>
                    ) : null}
                    {item.failureReasonHe ? (
                      <div className="mt-1 rounded bg-red-50 px-2 py-1 text-[11.5px] text-red-700">
                        {item.terminal ? '✕' : '↻'} {item.failureReasonHe}
                      </div>
                    ) : null}
                  </div>

                  <span className="mt-0.5 text-gray-400">{expanded ? '▲' : '▼'}</span>
                </button>

                {expanded ? (
                  <div className="border-t border-gray-100 px-3.5 py-3">
                    <dl className="mb-3 grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
                      <Field label="נמען" value={[item.recipient.name, item.recipient.phone, item.recipient.email].filter(Boolean).join(' · ')} />
                      <Field label="שולח" value={item.sender.label || item.sender.accountId} />
                      <Field label="מועד מתוכנן" value={fmt(item.scheduledAt)} />
                      <Field label="מועד אפשרי" value={item.effectiveAt ? fmt(item.effectiveAt) : 'מיידי'} />
                      <Field label="סטטוס במקור" value={item.sourceStatus} />
                      <Field label="ניסיונות" value={String(item.attemptCount ?? 0)} />
                      {item.sentAt ? <Field label="נשלח" value={fmt(item.sentAt)} /> : null}
                    </dl>

                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="mb-1 text-[11.5px] font-medium text-gray-500">תצוגה מלאה</div>
                      {item.preview.subject ? (
                        <div className="mb-1.5 text-[13px] font-medium text-gray-900">{item.preview.subject}</div>
                      ) : null}
                      {item.preview.body ? (
                        <div
                          className="gos-prose text-[13px] text-gray-800"
                          // The body is the FROZEN rendered content produced by the
                          // owning subsystem — displayed, never re-rendered here.
                          dangerouslySetInnerHTML={{ __html: item.preview.body }}
                        />
                      ) : (
                        <div className="text-[12.5px] text-gray-500">
                          התוכן טרם הוקפא — הוא נוצר ברגע השליחה כדי שישקף את הנתונים העדכניים.
                        </div>
                      )}
                      {item.preview.attachments?.length ? (
                        <div className="mt-2 text-[11.5px] text-gray-600">
                          קבצים מצורפים: {item.preview.attachments.map((a) => a.filename || a.fileName).filter(Boolean).join(', ')}
                        </div>
                      ) : null}
                    </div>

                    {item.origin.link ? (
                      <div className="mt-2.5">
                        <Link to={item.origin.link} className="text-[12.5px] text-blue-600 hover:underline">
                          פתיחה ב{item.origin.moduleHe} ↗
                        </Link>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Field({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-gray-500">{label}</dt>
      <dd className="flex-1 text-gray-800">{value}</dd>
    </div>
  );
}
