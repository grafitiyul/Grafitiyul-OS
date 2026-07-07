import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api.js';
import { PRIORITY_OPTIONS, defaultDueDate } from './taskConfig.js';
import TaskIcon from './TaskIcon.jsx';
import { DateField, TimeField } from '../../common/pickers/DateTimeFields.jsx';

// Task composer — the "משימה" tab of the Deal timeline composer. Renders whatever
// active TaskTypes exist (never hard-coded). A 'whatsapp' type reveals the
// message + sender-chat fields and schedules a WhatsApp message on save; the
// backend links the two atomically. Owner defaults to the current admin.

export default function TaskComposer({ dealId, onCreated }) {
  const [types, setTypes] = useState([]);
  const [users, setUsers] = useState([]);
  const [meId, setMeId] = useState('');
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [text, setText] = useState('');
  const [dueDate, setDueDate] = useState(defaultDueDate(null));
  const [dueTime, setDueTime] = useState('');
  const [priority, setPriority] = useState('none');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [chats, setChats] = useState([]);
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const [chatId, setChatId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const selectedType = useMemo(
    () => types.find((t) => t.id === selectedTypeId) || null,
    [types, selectedTypeId],
  );
  const isWhatsapp = selectedType?.channel === 'whatsapp';

  // Load catalog + users once. Preselect the first type and "me" as owner.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // taskTypes errors are REAL (surface them). adminUsers/status are
        // best-effort (owner list can degrade). Both endpoints may return an
        // array OR an envelope — normalize to an array before using it.
        const [ttRes, usRes, status] = await Promise.all([
          api.taskTypes.list(true),
          api.adminUsers.list().catch(() => ({ users: [] })),
          api.auth.status().catch(() => ({})),
        ]);
        if (!alive) return;
        const tt = Array.isArray(ttRes) ? ttRes : ttRes?.taskTypes || [];
        const usersArr = Array.isArray(usRes) ? usRes : usRes?.users || [];
        setTypes(tt);
        const active = usersArr.filter((u) => u.isActive);
        setUsers(active);
        const me = active.find((u) => u.username === status?.username);
        setMeId(me?.id || '');
        setOwnerUserId(me?.id || active[0]?.id || '');
        if (tt[0]) applyType(tt[0]);
      } catch (e) {
        if (alive) setError(e.payload?.error || e.message);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyType(type) {
    setSelectedTypeId(type.id);
    setText('');
    setDueDate(defaultDueDate(type));
    setDueTime(type.channel === 'whatsapp' ? type.defaultTime || '10:00' : type.defaultTime || '');
    if (type.channel === 'whatsapp' && !chatsLoaded) loadChats();
  }

  async function loadChats() {
    setChatsLoaded(true);
    try {
      const data = await api.whatsapp.contextChats('deal', dealId);
      const list = data?.chats || [];
      setChats(list);
      setChatId(list[0]?.id || '');
    } catch {
      setChats([]);
    }
  }

  async function submit() {
    if (saving) return;
    setError(null);
    if (!dueDate) return setError('חובה לבחור תאריך');
    if (isWhatsapp && !text.trim()) return setError('חובה לכתוב את תוכן ההודעה');
    if (isWhatsapp && !chatId) return setError('לא נמצאה שיחת וואטסאפ מקושרת לדיל');
    setSaving(true);
    try {
      // For WhatsApp the exact send moment matters — compute it in the USER's
      // timezone (a bare "YYYY-MM-DDTHH:MM" is parsed as local) and send ISO, so
      // the UTC server never reinterprets the wall-clock time.
      const waTime = dueTime || '10:00';
      const scheduledAt = isWhatsapp ? new Date(`${dueDate}T${waTime}`).toISOString() : undefined;
      const payload = {
        taskTypeId: selectedTypeId || undefined,
        text: text.trim() || undefined,
        dueDate,
        dueTime: (isWhatsapp ? waTime : dueTime) || undefined,
        priority,
        ownerUserId: ownerUserId || undefined,
        ...(isWhatsapp ? { whatsappChatId: chatId, scheduledAt } : {}),
      };
      await api.dealTasks.create(dealId, payload);
      // Reset text but keep the type/owner for quick successive entry.
      setText('');
      onCreated?.();
    } catch (e) {
      setError(e.payload?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  const placeholder = selectedType?.defaultText || selectedType?.nameHe || 'תיאור המשימה';

  return (
    <div className="space-y-3" dir="rtl">
      {/* Type picker */}
      <div className="flex flex-wrap gap-1.5">
        {types.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => applyType(t)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium border transition ${
              selectedTypeId === t.id
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <TaskIcon name={t.icon} channel={t.channel} size={15} />
            <span>{t.nameHe}</span>
          </button>
        ))}
        {types.length === 0 && <span className="text-sm text-gray-400">טוען סוגי משימות…</span>}
      </div>

      {/* Text / message */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={isWhatsapp ? 'תוכן הודעת הוואטסאפ…' : placeholder}
        rows={isWhatsapp ? 3 : 2}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
      />

      {/* WhatsApp sender/chat selector */}
      {isWhatsapp && (
        <div>
          {chats.length > 0 ? (
            <label className="block text-[12px] text-gray-600">
              נשלח מ / אל
              <select
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                {chats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.account?.label || c.accountId} ← {c.displayName || c.phoneNumber || 'שיחה'}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-700">
              אין שיחת וואטסאפ מקושרת לדיל. פתחו שיחה עם איש הקשר לפני יצירת משימת וואטסאפ.
            </div>
          )}
        </div>
      )}

      {/* Date / time / priority / owner */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* Date is required (submit validates) → no clear; time stays optional
            for normal tasks. WhatsApp keeps its 10:00 default via applyType. */}
        <DateField label="תאריך" value={dueDate} onChange={setDueDate} clearable={false} />
        <TimeField label={`שעה ${isWhatsapp ? '' : '(רשות)'}`} value={dueTime} onChange={setDueTime} clearable={!isWhatsapp} />
        <label className="block text-[12px] text-gray-600">
          סדר עדיפות
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[12px] text-gray-600">
          אחראי
          <select
            value={ownerUserId}
            onChange={(e) => setOwnerUserId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
                {u.id === meId ? ' (אני)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="text-[12.5px] text-red-600">שגיאה: {error}</div>}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={saving || (isWhatsapp && !chatId)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'שומר…' : isWhatsapp ? 'תזמון משימת וואטסאפ' : 'הוספת משימה'}
        </button>
      </div>
    </div>
  );
}
