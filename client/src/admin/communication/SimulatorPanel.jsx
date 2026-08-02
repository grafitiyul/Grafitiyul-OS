import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import SearchSelect from './SearchSelect.jsx';
import { waPreviewHtml } from '../whatsapp/waPreview.jsx';
import { ACTIVITY_LABELS, STATUS_LABELS } from './commLabels.jsx';
import { getDynamicFieldByKey } from '../../lib/dynamicFields.js';

// ─────────────────────────────────────────────────────────────────────────────
// The communication simulator — a live dry-run of the CANONICAL pipeline
// (POST /messages/:id/simulate → prepare.js: the same applicability /
// recipient / variable / document / window / timing / serialization modules
// real deliveries use). Two context modes:
//   · synthetic — user-entered test fields shaped into the same context
//     object (no business record is read or written),
//   · real — an existing Deal loaded read-only through the exact context
//     loader real triggers use.
// The panel simulates the editor's CURRENT (possibly unsaved) draft via
// draftOverride — nothing is persisted, nothing is ever sent from here except
// the explicit "שלח בדיקה" flow with a deliberate safe destination.
// ─────────────────────────────────────────────────────────────────────────────

const inputCls = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100';
const selectCls = 'rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[12.5px] focus:border-blue-400 focus:outline-none';

const DEFAULT_FIELDS = {
  orderNo: '27999',
  dealTitle: 'סיור בדיקה — סימולטור',
  contactFirstName: 'ישראל',
  contactLastName: 'ישראלי',
  phone: '050-0000000',
  email: 'test@example.com',
  organization: '',
  subOrganization: '',
  ownerName: '',
  activityType: 'private',
  city: 'תל אביב',
  product: 'סיור גרפיטי',
  tourDate: '',
  tourTime: '10:00',
  participants: '25',
  totalAmount: '2500',
  paidAmount: '1000',
  language: 'he',
};

export function DealPicker({ value, onSelect }) {
  return (
    <SearchSelect
      value={value}
      onSelect={onSelect}
      search={async (q) => {
        if (!q.trim()) return [];
        const rows = await api.communication.dealsSearch(q);
        return rows.map((d) => ({
          id: d.id,
          label: `#${d.orderNo} · ${d.title}`,
          subtitle: [ACTIVITY_LABELS[d.activityType], d.tourDate, STATUS_LABELS[d.status] || d.status].filter(Boolean).join(' · '),
        }));
      }}
      placeholder="חיפוש דיל לפי שם או מספר הזמנה…"
      emptySearch={false}
    />
  );
}

const VERDICTS = {
  send: { label: 'ההודעה תישלח', tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200', icon: '✅' },
  wait_window: { label: 'תמתין לחלון שליחה', tone: 'bg-amber-50 text-amber-800 ring-amber-200', icon: '⏳' },
  wait_dependency: { label: 'תמתין לנתונים חסרים', tone: 'bg-amber-50 text-amber-800 ring-amber-200', icon: '⏳' },
  skip: { label: 'לא תישלח (דילוג)', tone: 'bg-red-50 text-red-700 ring-red-200', icon: '⛔' },
};

export default function SimulatorPanel({ meta, message, draft, triggerType, onOpenTest }) {
  const [mode, setMode] = useState('synthetic');
  const [deal, setDeal] = useState(null);
  const [fields, setFields] = useState(DEFAULT_FIELDS);
  const [language, setLanguage] = useState('');
  const [fieldsOpen, setFieldsOpen] = useState(true);
  // Sample change payload for "מועד הסיור השתנה" — rides body.triggerData in
  // both modes through the same applyTriggerOverrides path real deliveries use.
  const [change, setChange] = useState({ prevDate: '2030-08-10', prevTime: '10:00', newDate: '2030-08-12', newTime: '14:00' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const seq = useRef(0);
  const isChangeTrigger = triggerType === 'tour_datetime_changed';

  // Debounced auto-run over everything that affects the result.
  useEffect(() => {
    if (!message) return undefined;
    if (mode === 'real' && !deal) { setData(null); return undefined; }
    const mySeq = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const body = {
          mode,
          language: language || undefined,
          draftOverride: draft ? { ...draft.draftContent, attachments: draft.attachments } : undefined,
          triggerData: isChangeTrigger ? change : undefined,
        };
        if (mode === 'real') body.dealId = deal.id;
        else body.fields = fields;

        // BOTH languages, through the SAME simulate endpoint — the preview must
        // not be a second renderer. When the operator pins a language we run it
        // once; otherwise we run he + en in parallel and show them side by side.
        const langs = language ? [language] : ['he', 'en'];
        const results = await Promise.all(
          langs.map((l) => api.communication
            .simulate(message.id, { ...body, language: l })
            .then((r) => ({ lang: l, r }))
            .catch((err) => ({ lang: l, err }))),
        );
        if (seq.current !== mySeq) return;
        const ok = results.find((x) => x.r);
        if (!ok) throw results[0].err;
        setData({
          ...ok.r,
          // lang → rendered (or an error for that language only).
          byLang: Object.fromEntries(results.map((x) => [x.lang, x.r ? x.r.rendered : null])),
          langs,
        });
        setError(null);
      } catch (err) {
        if (seq.current === mySeq) { setError(err?.payload?.error || err.message); setData(null); }
      } finally {
        if (seq.current === mySeq) setLoading(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [message?.id, mode, deal, fields, language, draft, change, isChangeTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!message) return null;

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const field = (key, label, type = 'text', extra = {}) => (
    <label className="block">
      <span className="mb-0.5 block text-[10.5px] font-semibold text-gray-500">{label}</span>
      <input
        type={type} value={fields[key] ?? ''} dir={['phone', 'email', 'tourDate', 'tourTime', 'orderNo', 'totalAmount', 'paidAmount'].includes(key) ? 'ltr' : 'rtl'}
        onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
        className={inputCls} {...extra}
      />
    </label>
  );

  const verdict = data ? VERDICTS[data.verdict?.action] || VERDICTS.skip : null;
  const isWa = message.channel === 'whatsapp';

  return (
    <div dir="rtl" className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div>
          <h3 className="text-[13.5px] font-bold text-gray-900">🧪 סימולטור</h3>
          <p className="text-[11px] text-gray-400">אותו צינור בדיוק כמו שליחה אמיתית — בלי לשלוח</p>
        </div>
        {/* Default shows BOTH languages side by side; pinning one is for
            focusing, not for discovering that the other exists. */}
        <select value={language} onChange={(e) => setLanguage(e.target.value)} className={selectCls}>
          <option value="">עברית + אנגלית</option>
          <option value="he">עברית בלבד</option>
          <option value="en">English only</option>
        </select>
      </div>

      <div className="space-y-3 p-4">
        {/* context mode */}
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setMode('synthetic')}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-[12px] font-medium ${mode === 'synthetic' ? 'border-violet-400 bg-violet-50 text-violet-800' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            נתוני בדיקה
          </button>
          <button type="button" onClick={() => setMode('real')}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-[12px] font-medium ${mode === 'real' ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            דיל אמיתי
          </button>
        </div>

        {mode === 'real' ? (
          <div>
            <DealPicker value={deal} onSelect={setDeal} />
            <p className="mt-1 text-[10.5px] text-gray-400">קריאה בלבד — נטען דרך אותו טוען-הקשר של טריגר אמיתי. שום דבר לא נשלח.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-violet-100 bg-violet-50/40">
            <button type="button" onClick={() => setFieldsOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-[12px] font-semibold text-violet-800">
              פרטי הבדיקה (סינתטיים — לא נשמרים)
              <span className={`transition-transform ${fieldsOpen ? 'rotate-90' : ''}`}>‹</span>
            </button>
            {fieldsOpen && (
              <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                {field('contactFirstName', 'שם פרטי')}
                {field('contactLastName', 'שם משפחה')}
                {field('phone', 'טלפון', 'tel')}
                {field('email', 'אימייל', 'email')}
                {field('orderNo', 'מס׳ הזמנה')}
                {field('dealTitle', 'שם הדיל')}
                <label className="block">
                  <span className="mb-0.5 block text-[10.5px] font-semibold text-gray-500">סוג פעילות</span>
                  <select value={fields.activityType} onChange={(e) => setFields((f) => ({ ...f, activityType: e.target.value }))} className={`${selectCls} w-full`}>
                    {Object.entries(ACTIVITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                {field('ownerName', 'בעלים של הדיל')}
                {field('organization', 'ארגון')}
                {field('subOrganization', 'תת-ארגון')}
                {field('product', 'מוצר / פעילות')}
                {field('city', 'עיר')}
                {field('tourDate', 'תאריך סיור', 'date')}
                {field('tourTime', 'שעת סיור', 'time')}
                {field('participants', 'משתתפים', 'number')}
                <label className="block">
                  <span className="mb-0.5 block text-[10.5px] font-semibold text-gray-500">שפת תקשורת</span>
                  <select value={fields.language} onChange={(e) => setFields((f) => ({ ...f, language: e.target.value }))} className={`${selectCls} w-full`}>
                    <option value="he">עברית</option>
                    <option value="en">English</option>
                  </select>
                </label>
                {field('totalAmount', 'סכום עסקה (₪)', 'number')}
                {field('paidAmount', 'שולם (₪)', 'number')}
              </div>
            )}
          </div>
        )}

        {/* change payload for "מועד הסיור השתנה" (both modes) */}
        {isChangeTrigger && (
          <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3">
            <div className="mb-1.5 text-[11px] font-semibold text-amber-800">שינוי המועד לסימולציה</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-0.5 block text-[10.5px] font-semibold text-gray-500">תאריך קודם</span>
                <input type="date" dir="ltr" value={change.prevDate} onChange={(e) => setChange((c) => ({ ...c, prevDate: e.target.value }))} className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[10.5px] font-semibold text-gray-500">שעה קודמת</span>
                <input type="time" dir="ltr" value={change.prevTime} onChange={(e) => setChange((c) => ({ ...c, prevTime: e.target.value }))} className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[10.5px] font-semibold text-gray-500">תאריך חדש</span>
                <input type="date" dir="ltr" value={change.newDate} onChange={(e) => setChange((c) => ({ ...c, newDate: e.target.value }))} className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[10.5px] font-semibold text-gray-500">שעה חדשה</span>
                <input type="time" dir="ltr" value={change.newTime} onChange={(e) => setChange((c) => ({ ...c, newTime: e.target.value }))} className={inputCls} />
              </label>
            </div>
          </div>
        )}

        {/* results */}
        {loading && <div className="py-3 text-center text-[12px] text-gray-400">מריץ סימולציה…</div>}
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">שגיאה: {error}</div>}
        {mode === 'real' && !deal && !loading && (
          <div className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-[12px] text-gray-400">
            בחרו דיל כדי להריץ סימולציה על נתונים אמיתיים.
          </div>
        )}

        {data && !loading && (
          <div className="space-y-3">
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
              data.mode === 'synthetic' ? 'bg-violet-50 text-violet-700 ring-violet-200' : 'bg-blue-50 text-blue-700 ring-blue-200'
            }`}>
              {data.mode === 'synthetic' ? 'סימולציה על נתוני בדיקה' : 'נתונים אמיתיים · קריאה בלבד'}
            </span>

            {/* verdict */}
            <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 ring-1 ${verdict.tone}`}>
              <span className="text-[15px] leading-none">{verdict.icon}</span>
              <div className="min-w-0">
                <div className="text-[12.5px] font-bold">{verdict.label}</div>
                {data.verdict.reason && <div className="text-[11.5px]">{data.verdict.reason}</div>}
              </div>
            </div>

            {/* applicability */}
            <Section title="תנאי האירוע">
              {data.applicability.checks.map((c) => (
                <div key={c.key} className={`text-[11.5px] ${c.pass ? 'text-emerald-700' : 'text-red-600'}`}>
                  {c.pass ? '✓' : '✗'} {c.label}{c.detail ? ` (${c.detail})` : ''}
                </div>
              ))}
            </Section>

            {/* recipient + sender */}
            <Section title="נמען ושולח">
              {data.group ? (
                <Row k="קבוצה" v={data.group.subject || data.group.jid} />
              ) : data.recipients.length ? data.recipients.map((r) => (
                <div key={r.key} className="mb-1 border-b border-gray-100 pb-1 last:mb-0 last:border-0 last:pb-0">
                  <Row k="שם" v={r.name || '—'} />
                  {isWa
                    ? <Row k="טלפון" v={r.phone || '⚠ חסר'} bad={!r.phone} />
                    : <Row k="אימייל" v={r.email || '⚠ חסר'} bad={!r.email} />}
                </div>
              )) : <div className="text-[11.5px] text-amber-700">⚠ {data.recipientError || 'לא נמצא נמען'}</div>}
              {isWa && (
                <Row k="חשבון שולח" v={data.sender?.waAccountId || '⚠ לא נבחר'} bad={!data.sender?.waAccountId} />
              )}
              <Row k="שפה" v={data.language === 'en' ? 'English' : 'עברית'} />
            </Section>

            {/* timing */}
            <Section title="תזמון">
              <Row k="מועד מיועד" v={fmt(data.timing.intendedAt)} />
              <Row k="מועד בפועל" v={fmt(data.timing.effectiveAt)} />
              {data.timing.windowReason && <div className="mt-0.5 text-[11.5px] text-amber-700">⏳ {data.timing.windowReason}</div>}
            </Section>

            {/* variables */}
            {data.variables.length > 0 && (
              <Section title="משתנים">
                {data.variables.map((v) => {
                  const def = getDynamicFieldByKey(v.key);
                  return (
                    <div key={v.key} className="flex items-baseline justify-between gap-2 py-0.5 text-[11.5px]">
                      <span className={v.unknown ? 'text-red-600' : 'text-gray-500'}>
                        {v.unknown ? `⚠ לא מוכר: {{${v.key}}}` : def?.label || v.key}
                      </span>
                      <span className={`min-w-0 truncate text-left font-medium ${v.missing || v.unknown ? 'text-amber-700' : 'text-gray-900'}`} dir="auto">
                        {v.unknown ? '—' : v.missing ? 'חסר' : v.value}
                      </span>
                    </div>
                  );
                })}
              </Section>
            )}

            {/* rendered message — one panel per language, side by side, so the
                operator sees exactly what each recipient will receive without
                switching anything. */}
            <Section title={isWa ? 'ההודעה כפי שתישלח' : 'המייל כפי שיישלח'}>
              <div className={`grid gap-2.5 ${(data.langs || ['he']).length > 1 ? 'lg:grid-cols-2' : ''}`}>
                {(data.langs || ['he']).map((l) => {
                  const rendered = (data.byLang || {})[l] || (l === data.language ? data.rendered : null);
                  return (
                    <div key={l} className="min-w-0">
                      {(data.langs || []).length > 1 && (
                        <div className="mb-1 text-[11px] font-semibold text-gray-500">
                          {l === 'he' ? 'עברית' : 'English'}
                        </div>
                      )}
                      {!rendered ? (
                        <div className="rounded-lg border border-dashed border-gray-200 px-2.5 py-3 text-center text-[11.5px] text-gray-400">
                          אין תוכן בשפה זו — יישלח בשפת ברירת המחדל
                        </div>
                      ) : (
                        <>
                          {!isWa && (
                            <div className="mb-1.5 text-[12px]" dir={l === 'en' ? 'ltr' : 'rtl'}>
                              <span className="text-gray-400">נושא: </span>
                              <span className="font-semibold text-gray-900">{rendered.subject || '—'}</span>
                            </div>
                          )}
                          {isWa ? (
                            <div className="rounded-lg bg-[#efe7dd] p-2">
                              <div className="mr-auto max-w-full rounded-lg rounded-tr-sm bg-[#d9fdd3] px-2.5 py-1.5 shadow-sm">
                                {(rendered.attachments || []).map((a) => (
                                  <div key={a.kind} className="mb-1 flex items-center gap-1.5 rounded bg-white/70 px-2 py-1 text-[11px]">
                                    📄 <span className="truncate font-medium">{a.filename || a.kind}</span>
                                  </div>
                                ))}
                                <div className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-gray-900"
                                  dir={l === 'en' ? 'ltr' : 'rtl'}
                                  // eslint-disable-next-line react/no-danger
                                  dangerouslySetInnerHTML={{ __html: waPreviewHtml(rendered.body || '') }} />
                              </div>
                            </div>
                          ) : (
                            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-100 bg-white p-2.5 text-[12px]"
                              dir={l === 'en' ? 'ltr' : 'rtl'}
                              // eslint-disable-next-line react/no-danger
                              dangerouslySetInnerHTML={{ __html: rendered.body || '<span style="color:#9ca3af">אין תוכן</span>' }} />
                          )}
                          {(rendered.links || []).map((lk) => (
                            <div key={lk.kind} className="mt-1 truncate text-[11px] text-blue-700" dir="ltr">🔗 {lk.url}</div>
                          ))}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>

            <button type="button" onClick={() => onOpenTest?.(mode === 'real' ? { dealId: deal?.id } : { synthetic: fields })}
              className="w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[12.5px] font-semibold text-blue-700 hover:bg-blue-100">
              🧪 שלח בדיקה ליעד בטוח…
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">{title}</div>
      {children}
    </div>
  );
}
function Row({ k, v, bad }) {
  return (
    <div className="flex justify-between gap-2 py-0.5 text-[11.5px]">
      <span className="shrink-0 text-gray-500">{k}</span>
      <span className={`min-w-0 truncate text-left font-medium ${bad ? 'text-amber-700' : 'text-gray-900'}`} dir="auto">{v ?? '—'}</span>
    </div>
  );
}
