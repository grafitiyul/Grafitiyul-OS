import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api.js';
import { PRIORITY_OPTIONS, defaultDueDate } from './taskConfig.js';
import TaskIcon from './TaskIcon.jsx';
import { DateField, TimeField } from '../../common/pickers/DateTimeFields.jsx';
import AccountBubbles from '../../whatsapp/AccountBubbles.jsx';
import { useSubjectChats } from '../../whatsapp/useSubjectChats.js';
import { materializeChat, START_ERRORS } from '../../whatsapp/chatTarget.js';

// Task composer — the "משימה" tab of the Deal timeline composer. Renders whatever
// active TaskTypes exist (never hard-coded). A 'whatsapp' type reveals the
// message + sender fields and schedules a WhatsApp message on save; the
// backend links the two atomically. Owner defaults to the current admin.
//
// The sender is chosen through the SAME model as every other WhatsApp surface
// (useSubjectChats + AccountBubbles + the browser's remembered number). It used
// to be a dropdown of conversations that already existed, which meant a deal
// with no WhatsApp history could not have a WhatsApp task at all. Now the
// conversation is created when the message is scheduled, and the queued message
// becomes its first message when its time comes.

export default function TaskComposer({ dealId, onCreated }) {
  const [types, setTypes] = useState([]);
  const [users, setUsers] = useState([]);
  const [meId, setMeId] = useState('');
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [text, setText] = useState('');
  const [dueDate, setDueDate] = useState(defaultDueDate(null));
  const [dueTime, setDueTime] = useState('');
  const [dueTouched, setDueTouched] = useState(false);
  const [priority, setPriority] = useState('none');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const selectedType = useMemo(
    () => types.find((t) => t.id === selectedTypeId) || null,
    [types, selectedTypeId],
  );
  const isWhatsapp = selectedType?.channel === 'whatsapp';

  // The canonical WhatsApp selection — loaded only once a WhatsApp type is
  // actually picked, so an ordinary task costs no extra requests.
  const {
    contacts,
    activeContact,
    accounts,
    activeAccountId,
    activeAccount,
    activeChat,
    chatByAccount,
    selectContact,
    selectAccount,
  } = useSubjectChats('deal', dealId, { enabled: isWhatsapp, pollMs: 0 });

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

  // There is ONE draft. Switching type re-seeds the type-driven defaults
  // (date/time) only while the user hasn't picked them — it never touches the
  // typed text, so a half-written "שיחה ראשונית" simply becomes a WhatsApp task.
  function applyType(type) {
    setSelectedTypeId(type.id);
    if (!dueTouched) {
      setDueDate(defaultDueDate(type));
      setDueTime(type.channel === 'whatsapp' ? type.defaultTime || '10:00' : type.defaultTime || '');
    }
  }

  async function submit() {
    if (saving) return;
    setError(null);
    if (!dueDate) return setError('חובה לבחור תאריך');
    if (isWhatsapp && !text.trim()) return setError('חובה לכתוב את תוכן ההודעה');
    if (isWhatsapp && !activeChat) return setError('בחרו איש קשר ומספר שליחה');
    setSaving(true);
    try {
      // Scheduling to a number with no conversation yet CREATES the
      // conversation here — the same single ensure path every other WhatsApp
      // surface uses — so the queued message has a real thread to land in and
      // simply becomes its first message when its time comes.
      const chat = isWhatsapp ? await materializeChat(activeChat) : null;
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
        ...(isWhatsapp ? { whatsappChatId: chat.id, scheduledAt } : {}),
      };
      await api.dealTasks.create(dealId, payload);
      // Reset text but keep the type/owner for quick successive entry. The
      // saved task consumed the draft — the next one starts untouched again.
      setText('');
      setDueTouched(false);
      onCreated?.();
    } catch (e) {
      // A failure to OPEN the conversation is a business problem (the contact
      // has no phone), not a technical one — say it in those words.
      const code = e.payload?.error;
      setError(START_ERRORS[code] || code || e.message);
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

      {/* WhatsApp recipient + sender — the same two axes, the same controls
          and the same remembered number as the Deal conversation panel. */}
      {isWhatsapp && (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-[12px] font-medium text-gray-600">נשלח אל</span>
            {contacts.length > 1 ? (
              <select
                value={activeContact?.id || ''}
                onChange={(e) => selectContact(e.target.value)}
                aria-label="בחירת איש הקשר"
                className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-[12.5px]"
              >
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            ) : (
              <span className="text-[12.5px] font-medium text-gray-800">
                {activeContact?.name || '—'}
              </span>
            )}
            {/* Named even when there is only one number and the bubbles below
                are hidden — the sending number is never left to be guessed. */}
            {activeAccount?.label && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
                {activeAccount.label}
              </span>
            )}
          </div>
          <AccountBubbles
            accounts={accounts}
            activeId={activeAccountId}
            chatByAccount={chatByAccount}
            onSelect={selectAccount}
          />
          {!activeContact ? (
            <p className="text-[12px] text-amber-700">
              אין אנשי קשר בדיל — הוסיפו איש קשר לפני יצירת משימת וואטסאפ.
            </p>
          ) : !activeAccountId ? (
            <p className="text-[12px] text-amber-700">אין מספר WhatsApp מחובר.</p>
          ) : !chatByAccount[activeAccountId] ? (
            <p className="text-[12px] text-gray-500">
              עדיין אין שיחה עם {activeContact.name}
              {activeAccount?.label ? ` מ־${activeAccount.label}` : ''} — ההודעה המתוזמנת תהיה הראשונה בשיחה.
            </p>
          ) : null}
        </div>
      )}

      {/* Date / time / priority / owner */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* Date is required (submit validates) → no clear; time stays optional
            for normal tasks. WhatsApp keeps its 10:00 default via applyType. */}
        <DateField label="תאריך" value={dueDate} onChange={(v) => { setDueTouched(true); setDueDate(v); }} clearable={false} />
        <TimeField label={`שעה ${isWhatsapp ? '' : '(רשות)'}`} value={dueTime} onChange={(v) => { setDueTouched(true); setDueTime(v); }} clearable={!isWhatsapp} />
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
          disabled={saving || (isWhatsapp && !activeChat)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'שומר…' : isWhatsapp ? 'תזמון משימת וואטסאפ' : 'הוספת משימה'}
        </button>
      </div>
    </div>
  );
}
