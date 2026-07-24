import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { registerDynamicFields } from '../../lib/dynamicFields.js';
import SettingsChrome from '../settings/SettingsChrome.jsx';
import Pager from '../common/Pager.jsx';
import Dialog from '../common/Dialog.jsx';
import useDebouncedValue from '../../shell/search/useDebouncedValue.js';
import SendingWindowsDialog from './SendingWindowsDialog.jsx';
import DeliveryLogDialog from './DeliveryLogDialog.jsx';
import {
  STATUS_LABELS, CHANNEL_LABELS, AUDIENCE_LABELS, ACTIVITY_LABELS,
  timingLabel, StatusChip, ChannelBadge,
} from './commLabels.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// "נוסחים למייל + WhatsApp" — the Communication Center management screen.
// Full-width, server-paginated, searchable (including by #number), grouped:
// each event row expands its child messages so the event↔messages relationship
// is never hidden.
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function CommunicationPage() {
  const navigate = useNavigate();
  const [meta, setMeta] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [status, setStatus] = useState('');
  const [trigger, setTrigger] = useState('');
  const [channel, setChannel] = useState('');
  const [sort, setSort] = useState('updatedAt:desc');
  const [expanded, setExpanded] = useState(() => new Set());
  const [dialog, setDialog] = useState(null); // 'windows' | 'deliveries' | 'new'

  useEffect(() => {
    api.communication.meta().then((m) => {
      registerDynamicFields(m.variables.map((v) => ({ key: v.key, label: v.labelHe })));
      setMeta(m);
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.communication.events({
        page, pageSize: PAGE_SIZE, search: search || undefined,
        status: status || undefined, trigger: trigger || undefined,
        channel: channel || undefined, sort,
      });
      setData(r);
      // Auto-expand everything when the result set is small or searched.
      if (r.rows.length <= 8 || search) setExpanded(new Set(r.rows.map((e) => e.id)));
    } catch (err) {
      setError(err?.payload?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [page, search, status, trigger, channel, sort]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status, trigger, channel]);

  const selectCls = 'rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[13px] text-gray-700 focus:border-blue-400 focus:outline-none';

  const toggleExpand = (id) => setExpanded((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function createEvent(form) {
    const created = await api.communication.createEvent(form);
    navigate(`/admin/settings/communication/events/${created.id}`);
  }

  return (
    <div dir="rtl" className="mx-auto max-w-[1600px] px-5 pb-16 lg:px-8">
      <SettingsChrome />

      {/* header — "זמני שליחה" pinned to the visual top-left (RTL: end side) */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-xl text-white shadow-sm">💬</div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight text-gray-900">נוסחים למייל + WhatsApp</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            מרכז התקשורת של GOS — נוסחים, טריגרים, תזמונים וחלונות שליחה. לכל מסר מספר קבוע (#).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setDialog('deliveries')}
            className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50">
            יומן שליחות
          </button>
          <button type="button" onClick={() => setDialog('windows')}
            className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50">
            🕐 זמני שליחה
          </button>
          <button type="button" onClick={() => setDialog('new')}
            className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-blue-700">
            + אירוע תקשורת חדש
          </button>
        </div>
      </div>

      {/* filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder='חיפוש לפי שם, תיאור או מספר מסר (למשל "#24")…'
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pe-4 ps-10 text-[13.5px] shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-gray-400">🔎</span>
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
          <option value="">כל הסטטוסים</option>
          {['draft', 'active', 'disabled', 'archived'].map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select value={trigger} onChange={(e) => setTrigger(e.target.value)} className={selectCls}>
          <option value="">כל הטריגרים</option>
          {(meta?.triggers || []).map((t) => <option key={t.type} value={t.type}>{t.labelHe}</option>)}
        </select>
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className={selectCls}>
          <option value="">כל הערוצים</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">מייל</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className={selectCls}>
          <option value="updatedAt:desc">עודכן לאחרונה</option>
          <option value="createdAt:desc">נוצר לאחרונה</option>
          <option value="internalName:asc">לפי שם</option>
          <option value="triggerType:asc">לפי טריגר</option>
        </select>
      </div>

      {/* table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-right">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/70 text-[11.5px] font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5">אירוע / מסר</th>
                <th className="px-3 py-2.5">טריגר</th>
                <th className="px-3 py-2.5">תזמון</th>
                <th className="px-3 py-2.5">ערוץ</th>
                <th className="px-3 py-2.5">נמען</th>
                <th className="px-3 py-2.5">פעילות</th>
                <th className="px-3 py-2.5">שפות</th>
                <th className="px-3 py-2.5">חלון שליחה</th>
                <th className="px-3 py-2.5">סטטוס</th>
                <th className="px-3 py-2.5">עודכן</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-[13px] text-gray-400">טוען…</td></tr>
              )}
              {!loading && error && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-[13px] text-red-600">שגיאה: <span className="font-mono">{error}</span></td></tr>
              )}
              {!loading && !error && data?.rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-16 text-center">
                    <div className="text-3xl">💬</div>
                    <div className="mt-2 text-[14px] font-medium text-gray-700">
                      {search || status || trigger || channel ? 'אין תוצאות מתאימות' : 'עדיין אין אירועי תקשורת'}
                    </div>
                    <div className="mt-1 text-[12.5px] text-gray-500">
                      {search || status || trigger || channel
                        ? 'נסו לנקות את הסינון.'
                        : 'צרו אירוע ראשון — למשל "דיל נסגר" עם וואטסאפ ללקוח ומייל למשרד.'}
                    </div>
                  </td>
                </tr>
              )}
              {!loading && !error && data?.rows.map((event) => {
                const open = expanded.has(event.id);
                return [
                  <tr key={event.id}
                    onClick={() => navigate(`/admin/settings/communication/events/${event.id}`)}
                    className="cursor-pointer border-b border-gray-100 bg-gray-50/40 transition-colors hover:bg-blue-50/40">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); toggleExpand(event.id); }}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-gray-200"
                          title={open ? 'כווץ' : 'הרחב'}>
                          <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>‹</span>
                        </button>
                        <span className="text-[13.5px] font-semibold text-gray-900">{event.internalName}</span>
                        <span className="rounded-full bg-gray-200/80 px-2 py-0.5 text-[10.5px] font-semibold text-gray-600">
                          {event.messages.length} מסרים
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[12.5px] text-gray-700">
                      {meta?.triggers.find((t) => t.type === event.triggerType)?.labelHe || event.triggerType}
                    </td>
                    <td className="px-3 py-2.5 text-[12.5px] text-gray-700">{timingLabel(event)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1">
                        {[...new Set(event.messages.map((m) => m.channel))].map((c) => <ChannelBadge key={c} channel={c} />)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5" />
                    <td className="px-3 py-2.5 text-[12px] text-gray-600">
                      {event.activityMode === 'all'
                        ? 'הכל'
                        : `${event.activityMode === 'include' ? 'רק' : 'ללא'} ${event.activityTypes.map((t) => ACTIVITY_LABELS[t]).join(', ')}`}
                    </td>
                    <td className="px-3 py-2.5" />
                    <td className="px-3 py-2.5" />
                    <td className="px-3 py-2.5"><StatusChip status={event.status} /></td>
                    <td className="px-3 py-2.5 text-[12px] text-gray-500" dir="ltr">
                      {new Date(event.updatedAt).toLocaleDateString('he-IL')}
                    </td>
                  </tr>,
                  ...(open ? event.messages.map((m) => (
                    <tr key={m.id}
                      onClick={() => navigate(`/admin/settings/communication/events/${event.id}`)}
                      className="cursor-pointer border-b border-gray-100 transition-colors hover:bg-blue-50/40">
                      <td className="py-2 pe-4 ps-14">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[12px] font-bold text-gray-400">#{m.publicNumber}</span>
                          <span className="text-[13px] text-gray-800">{m.internalName || CHANNEL_LABELS[m.channel]}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2"><ChannelBadge channel={m.channel} /></td>
                      <td className="px-3 py-2 text-[12px] text-gray-600">
                        {m.channel === 'whatsapp' && m.waDestinationType === 'group'
                          ? `קבוצה (${m.waAccountId || '—'})`
                          : AUDIENCE_LABELS[m.audienceType] || m.audienceType}
                      </td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <LangDot lang="עב" state={m.languageState?.he} />
                          <LangDot lang="EN" state={m.languageState?.en} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[12px] text-gray-600">
                        {m.windowEnabled ? '🕐 כפוף לחלון' : 'מיידי'}
                      </td>
                      <td className="px-3 py-2"><StatusChip status={m.status} small /></td>
                      <td className="px-3 py-2 text-[12px] text-gray-500" dir="ltr">
                        {new Date(m.updatedAt).toLocaleDateString('he-IL')}
                      </td>
                    </tr>
                  )) : []),
                ];
              })}
            </tbody>
          </table>
        </div>
        {data && data.total > PAGE_SIZE && (
          <div className="border-t border-gray-100 px-4 py-2">
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )}
      </div>

      {dialog === 'windows' && <SendingWindowsDialog onClose={() => setDialog(null)} />}
      {dialog === 'deliveries' && <DeliveryLogDialog onClose={() => setDialog(null)} />}
      {dialog === 'new' && meta && (
        <NewEventDialog meta={meta} onCreate={createEvent} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function LangDot({ lang, state }) {
  const tone = state === 'complete' ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
    : state === 'ai_draft' ? 'bg-amber-100 text-amber-700 ring-amber-200'
      : 'bg-gray-100 text-gray-400 ring-gray-200';
  const title = state === 'complete' ? 'מלא' : state === 'ai_draft' ? 'טיוטת AI — ממתין לאישור' : 'חסר';
  return (
    <span title={title} className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ring-1 ${tone}`}>
      {lang}
    </span>
  );
}

function NewEventDialog({ meta, onCreate, onClose }) {
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState(meta.triggers[0]?.type || '');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose} title="אירוע תקשורת חדש" size="md">
      <div dir="rtl" className="space-y-3 p-1">
        <div>
          <label className="text-[12.5px] font-semibold text-gray-700">שם פנימי</label>
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus
            placeholder='למשל: "אישור סגירה ללקוח"'
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div>
          <label className="text-[12.5px] font-semibold text-gray-700">טריגר</label>
          <select value={trigger} onChange={(e) => setTrigger(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13.5px] focus:border-blue-400 focus:outline-none">
            {meta.triggers.map((t) => <option key={t.type} value={t.type}>{t.labelHe}</option>)}
          </select>
        </div>
        <p className="text-[12px] text-gray-500">האירוע נוצר כטיוטה — תזמון, תנאים ומסרים מוגדרים במסך העריכה.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-[13px] text-gray-700">ביטול</button>
          <button
            type="button" disabled={!name.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try { await onCreate({ internalName: name.trim(), triggerType: trigger }); }
              catch (err) { alert(`יצירה נכשלה: ${err?.payload?.error || err.message}`); setBusy(false); }
            }}
            className="rounded-lg bg-blue-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
            {busy ? 'יוצר…' : 'צור ופתח לעריכה'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
