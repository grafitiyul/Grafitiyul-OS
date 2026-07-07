import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import WhatsAppLogo from '../common/WhatsAppLogo.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import ChatThread from './ChatThread.jsx';
import ChatListRow from './ChatListRow.jsx';
import PhoneFlag from './PhoneFlag.jsx';
import DealDrawer from './DealDrawer.jsx';
import { hasDirtyForms } from '../../lib/dirtyForms.js';
import { ensureSeen, isUnread, markSeen, markUnread, readManualUnread, readSeen } from './seenStore.js';

// Active WhatsApp inbox — WhatsApp-style two-pane workspace:
//   RIGHT: pinned conversation list (resizable, persisted width) with the
//          account switcher, scope + status filters and search. Rows are
//          CLEAN (name / preview / time / indicators only) — actions live in
//          a hover cluster (pin / read / snooze); פתח דיל lives in the
//          THREAD header, not on rows.
//   LEFT:  the selected conversation (full thread + composer). Manual
//          contact-linking lives HERE (unmatched chats only). Opening a deal
//          slides the drawer over the chat area while the list stays visible.
// Default scope is the WORK QUEUE: linked conversations + recent unknown
// ones; ancient unknown numbers stay behind the "הכל" scope or search.
// Keyboard: ↑/↓ move the cursor, Enter opens it, Esc closes/clears, Ctrl+K
// focuses search.

const LAYOUT_KEY = 'gos-whatsapp-inbox'; // { listWidth }
const LIST_MIN = 300;
const LIST_MAX = 540;

function fmtTourDate(d) {
  if (!d) return null;
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return d;
  }
}

function fmtMoney(minor) {
  const n = Number(minor);
  if (!Number.isFinite(n) || n === 0) return null;
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(n / 100);
}

function contactLabel(c) {
  return c.fullNameHe || c.fullNameEn || `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim() || '—';
}

function errText(prefix, e) {
  const code = e?.payload?.error;
  const detail = e?.payload?.detail;
  return `${prefix} — נסו שוב.${code ? ` (${code}${detail ? `: ${detail}` : ''})` : ''}`;
}

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}

const DEAL_STATUS = {
  open: { label: 'פתוח', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
  won: { label: 'נסגר', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  lost: { label: 'אבוד', cls: 'bg-gray-100 text-gray-500 ring-gray-200' },
};

// Status filters — applied client-side on the loaded list.
const STATUS_FILTERS = [
  { key: 'all', label: 'הכל' },
  { key: 'unread', label: 'לא נקראו' },
  { key: 'awaiting', label: 'ממתינות למענה' },
  { key: 'deal', label: 'עם דיל' },
  { key: 'nodeal', label: 'בלי דיל' },
  { key: 'today', label: 'היום' },
];

function DealChoiceRow({ deal, onPick }) {
  const st = DEAL_STATUS[deal.status] || DEAL_STATUS.open;
  const money = fmtMoney(deal.valueMinor);
  const tour = fmtTourDate(deal.tourDate);
  return (
    <button
      type="button"
      onClick={onPick}
      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-right transition hover:border-emerald-400 hover:bg-emerald-50/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[14px] font-semibold text-gray-900" dir="auto">{deal.title}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${st.cls}`}>
          {st.label}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-gray-500">
        {tour && <span>🗓 {tour}</span>}
        {deal.organizationName && <span dir="auto">🏢 {deal.organizationName}</span>}
        {money && <span dir="ltr">{money}</span>}
        {deal.stageName && <span>{deal.stageName}</span>}
      </div>
    </button>
  );
}

function DealPickDialog({ title, body, deals, allowNew, busy, onPick, onNew, onClose }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-bold text-gray-900">{title}</h3>
        {body && <p className="mt-1 text-[13px] leading-relaxed text-gray-500">{body}</p>}
        <div className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto">
          {deals.map((d) => (
            <DealChoiceRow key={d.id} deal={d} onPick={() => onPick(d)} />
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-[13px] text-gray-500 hover:bg-gray-100">
            ביטול
          </button>
          {allowNew && (
            <button
              type="button"
              disabled={busy}
              onClick={onNew}
              className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'יוצר…' : '+ פתיחת דיל חדש'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Contact-creation dialog for "צור דיל" on an unknown number — everything is
// editable BEFORE anything is created. Pre-filled from the WhatsApp identity:
// the pushed name lands in the Hebrew or English fields by script detection,
// the phone comes from the chat, and the communication language defaults by
// country (Israeli number → עברית, foreign → English).
function CreateDealDialog({ chat, suggestedName, busy, onConfirm, onClose }) {
  const [form, setForm] = useState(() => {
    const name = (suggestedName || '').trim();
    const hasHebrew = /[֐-׿]/.test(name);
    const [first, ...rest] = name.split(/\s+/).filter(Boolean);
    const last = rest.join(' ');
    const phone = chat.phoneNumber || '';
    return {
      firstNameHe: hasHebrew ? first || '' : '',
      lastNameHe: hasHebrew ? last : '',
      firstNameEn: !hasHebrew && name ? first || '' : '',
      lastNameEn: !hasHebrew && name ? last : '',
      phone,
      communicationLanguage: phone.startsWith('972') ? 'he' : 'en',
    };
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = (form.firstNameHe.trim() || form.firstNameEn.trim()) && form.phone.trim();

  const field = 'w-full rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] focus:border-blue-500 focus:outline-none';
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-bold text-gray-900">יצירת איש קשר ודיל חדשים</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
          בדקו וערכו את הפרטים — איש הקשר והדיל ייווצרו רק לאחר אישור, והשיחה תקושר אליהם.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <label className="space-y-1">
            <span className="text-[11.5px] font-medium text-gray-500">שם פרטי (עברית)</span>
            <input value={form.firstNameHe} onChange={set('firstNameHe')} dir="rtl" className={field} />
          </label>
          <label className="space-y-1">
            <span className="text-[11.5px] font-medium text-gray-500">שם משפחה (עברית)</span>
            <input value={form.lastNameHe} onChange={set('lastNameHe')} dir="rtl" className={field} />
          </label>
          <label className="space-y-1">
            <span className="text-[11.5px] font-medium text-gray-500">First name</span>
            <input value={form.firstNameEn} onChange={set('firstNameEn')} dir="ltr" className={field} />
          </label>
          <label className="space-y-1">
            <span className="text-[11.5px] font-medium text-gray-500">Last name</span>
            <input value={form.lastNameEn} onChange={set('lastNameEn')} dir="ltr" className={field} />
          </label>
          <label className="space-y-1">
            <span className="text-[11.5px] font-medium text-gray-500">טלפון</span>
            <input value={form.phone} onChange={set('phone')} dir="ltr" className={field} />
          </label>
          <label className="space-y-1">
            <span className="text-[11.5px] font-medium text-gray-500">שפת תקשורת</span>
            <select value={form.communicationLanguage} onChange={set('communicationLanguage')} className={field}>
              <option value="he">עברית</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-[13px] text-gray-500 hover:bg-gray-100">
            ביטול
          </button>
          <button
            type="button"
            disabled={busy || !valid}
            onClick={() => onConfirm(form)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'יוצר…' : 'צור איש קשר ודיל'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Inline contact picker for manual linking (thread header, unmatched only).
function ContactPicker({ onPick, onCancel, busy }) {
  const [contacts, setContacts] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    api.contacts.list().then(setContacts).catch(() => setContacts([]));
  }, []);

  const filtered = useMemo(() => {
    if (!contacts) return [];
    const needle = q.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    if (!needle) return contacts.slice(0, 8);
    return contacts
      .filter((c) => {
        const name = contactLabel(c).toLowerCase();
        const phone = c.phones?.[0]?.value?.replace(/\D/g, '') || '';
        return name.includes(needle) || (digits.length >= 3 && phone.includes(digits));
      })
      .slice(0, 8);
  }, [contacts, q]);

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-2.5">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש איש קשר לפי שם או טלפון…"
          dir="auto"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] focus:border-blue-500 focus:outline-none"
        />
        <button type="button" onClick={onCancel} className="text-[12px] text-gray-500 hover:text-gray-700">
          ביטול
        </button>
      </div>
      <div className="mt-2 max-h-56 overflow-y-auto">
        {contacts === null ? (
          <p className="px-2 py-3 text-center text-[12px] text-gray-400">טוען אנשי קשר…</p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-3 text-center text-[12px] text-gray-400">
            לא נמצאו אנשי קשר תואמים. אפשר גם "פתח דיל" — שיציע ליצור איש קשר חדש מהשיחה.
          </p>
        ) : (
          <ul className="divide-y divide-blue-100">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPick(c)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-right hover:bg-white disabled:opacity-50"
                >
                  <span className="text-[13px] font-medium text-gray-800">{contactLabel(c)}</span>
                  <span dir="ltr" className="text-[12px] text-gray-400">{c.phones?.[0]?.value || ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function WhatsAppInbox({ accounts = [], onCountChange }) {
  const [chats, setChats] = useState(null);
  const [unmatchedCount, setUnmatchedCount] = useState(0);
  const [accountFilter, setAccountFilter] = useState('all');
  const [scope, setScope] = useState('active'); // active | unmatched | all
  // Conversation kind: private (default, the CRM workflow) | group | all.
  // Groups are read/reply-only here — no CRM linking or deal actions.
  const [kind, setKind] = useState('private');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null); // chat object snapshot
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [drawerDealId, setDrawerDealId] = useState(null);
  // Work-queue drawer follow: a chat waiting for "switch despite unsaved
  // deal edits" confirmation (null = no pending confirmation).
  const [followConfirm, setFollowConfirm] = useState(null);
  const [error, setError] = useState(null);
  // Per-chat unread counts (device-local seen markers + server counts).
  const [unreadCounts, setUnreadCounts] = useState({});
  // Manual "mark unread" flags (mirrors the shared store, for rendering).
  const [manualUnread, setManualUnread] = useState(() => readManualUnread());
  // Which chat's snooze menu is open (chat id or null).
  const [snoozeMenuFor, setSnoozeMenuFor] = useState(null);
  // Keyboard cursor (chat id) — ↑/↓ move it, Enter opens it.
  const [cursorId, setCursorId] = useState(null);
  const [listWidth, setListWidth] = useState(() => {
    try {
      const w = Number(JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}').listWidth);
      return Number.isFinite(w) && w >= LIST_MIN && w <= LIST_MAX ? w : 360;
    } catch {
      return 360;
    }
  });
  const draggingRef = useRef(false);
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);

  // Unread counts for chats whose last message is newer than the seen marker.
  // Bounded: only unread candidates hit the count endpoint (usually a few).
  const computeUnread = useCallback(async (list) => {
    const seen = ensureSeen(list.map((c) => c.id));
    setManualUnread(readManualUnread());
    // Counts reflect REAL new messages only (manual flags are display-only),
    // so pass an empty manual map when picking count candidates.
    const candidates = list.filter((c) => isUnread(c, seen, {})).slice(0, 25);
    const entries = await Promise.all(
      candidates.map(async (c) => {
        try {
          const { count } = await api.whatsapp.chatMessages(c.id, { count: 1, after: seen[c.id] });
          return [c.id, count || 0];
        } catch {
          return [c.id, 1]; // it IS unread — show at least a dot-equivalent
        }
      }),
    );
    setUnreadCounts(Object.fromEntries(entries.filter(([, n]) => n > 0)));
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.whatsapp.inboxChats({
        search: search || undefined,
        accountId: accountFilter === 'all' ? undefined : accountFilter,
        scope: search ? 'all' : scope,
        kind,
      });
      setChats(data.chats);
      setUnmatchedCount(data.unmatchedCount);
      onCountChange?.(data.unmatchedCount);
      // Keep the open thread's snapshot fresh (name/contact may change).
      setSelected((cur) => (cur ? data.chats.find((c) => c.id === cur.id) || cur : cur));
      setError(null);
      computeUnread(data.chats);
    } catch (e) {
      setError(e?.payload?.error || e?.message || 'failed');
    }
  }, [search, accountFilter, scope, kind, onCountChange, computeUnread]);

  useEffect(() => {
    const t = setTimeout(() => load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden && !drawerDealId) load();
    }, 20_000);
    return () => clearInterval(t);
  }, [load, drawerDealId]);

  // Reading the open conversation = seen (also as new messages arrive).
  useEffect(() => {
    if (!selected) return;
    markSeen(selected.id);
    setManualUnread((cur) => {
      if (!cur[selected.id]) return cur;
      const next = { ...cur };
      delete next[selected.id];
      return next;
    });
    setUnreadCounts((cur) => {
      if (!cur[selected.id]) return cur;
      const next = { ...cur };
      delete next[selected.id];
      return next;
    });
  }, [selected?.id, selected?.lastMessageAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // List resize — anchored to the container's RIGHT edge (RTL list).
  useEffect(() => {
    function onMove(e) {
      if (!draggingRef.current) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setListWidth(Math.max(LIST_MIN, Math.min(LIST_MAX, rect.right - e.clientX)));
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setListWidth((w) => {
        try {
          localStorage.setItem(LAYOUT_KEY, JSON.stringify({ listWidth: w }));
        } catch { /* non-fatal */ }
        return w;
      });
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Status filter — client-side over the loaded window.
  const filteredChats = useMemo(() => {
    if (!chats) return null;
    if (statusFilter === 'all') return chats;
    const seen = readSeen();
    return chats.filter((c) => {
      switch (statusFilter) {
        case 'unread':
          return isUnread(c, seen, manualUnread);
        case 'awaiting':
          return c.lastMessage?.direction === 'incoming';
        case 'deal':
          return !!c.deal;
        case 'nodeal':
          return !c.deal;
        case 'today':
          return isToday(c.lastMessageAt);
        default:
          return true;
      }
    });
  }, [chats, statusFilter, unreadCounts, manualUnread]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open a conversation. WORK-QUEUE MODE: when the deal drawer is already
  // open, switching conversations follows PASSIVELY — exactly-one matching
  // deal swaps the drawer in place, several raise the choose dialog, and NO
  // matching deal simply CLOSES the drawer and shows the conversation
  // (creating/opening a deal stays a deliberate act via the panel button —
  // browsing must never be interrupted by a create-deal popup). Unsaved
  // Deal edits are guarded by the global dirty-forms registry; note +
  // WhatsApp drafts persist on their own (localStorage).
  function openChat(chat) {
    const switching = selected?.id !== chat.id;
    setSelected(chat);
    setCursorId(chat.id);
    setLinking(false);
    if (!drawerDealId || !switching) return;
    if (hasDirtyForms()) {
      setFollowConfirm(chat); // ask before dropping the edits
    } else {
      followDrawer(chat);
    }
  }

  // Passive drawer follow — never opens create/confirm flows on its own.
  async function followDrawer(chat) {
    // Groups have no CRM identity — never resolve deals for them.
    if (chat.type === 'group') {
      setDrawerDealId(null);
      return;
    }
    try {
      const r = await api.whatsapp.dealResolution(chat.id);
      if (r.kind === 'open') setDrawerDealId(r.dealId);
      else if (r.kind === 'choose') setDialog({ ...r, chat, follow: true });
      else setDrawerDealId(null); // no matching deal — just show the conversation
    } catch (e) {
      // Never trap the reader in an unrelated deal because resolution failed.
      setDrawerDealId(null);
      setError(errText('איתור הדיל לשיחה נכשל', e));
    }
  }

  // Keyboard shortcuts. Typing in inputs is respected (only Ctrl+K / Esc
  // reach through); the cursor follows ↑/↓ and Enter opens it.
  useEffect(() => {
    function onKey(e) {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        if (followConfirm) {
          setFollowConfirm(null);
          return;
        }
        if (drawerDealId) return; // the drawer handles its own ESC
        if (dialog) {
          setDialog(null);
          return;
        }
        if (inField) {
          e.target.blur();
          if (e.target === searchInputRef.current) setSearch('');
          return;
        }
        if (snoozeMenuFor) setSnoozeMenuFor(null);
        else if (selected) setSelected(null);
        return;
      }
      if (inField || dialog || drawerDealId) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const list = filteredChats || [];
        if (list.length === 0) return;
        e.preventDefault();
        const idx = list.findIndex((c) => c.id === (cursorId || selected?.id));
        const next =
          e.key === 'ArrowDown'
            ? list[Math.min(list.length - 1, idx + 1)] || list[0]
            : list[Math.max(0, idx - 1)] || list[0];
        setCursorId(next.id);
        document.querySelector(`[data-chat-row="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'Enter') {
        const list = filteredChats || [];
        const cur = list.find((c) => c.id === cursorId);
        if (cur) openChat(cur);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filteredChats, cursorId, selected, dialog, drawerDealId, snoozeMenuFor, followConfirm]);

  async function link(chat, contact) {
    setBusy(chat.id);
    try {
      await api.whatsapp.linkChat(chat.id, contact.id);
      setLinking(false);
      await load();
    } catch (e) {
      setError(errText('השיוך נכשל', e));
    } finally {
      setBusy(null);
    }
  }

  async function openDeal(chat) {
    setBusy(chat.id);
    setError(null);
    try {
      const r = await api.whatsapp.dealResolution(chat.id);
      if (r.kind === 'open') setDrawerDealId(r.dealId);
      else setDialog({ ...r, chat });
    } catch (e) {
      setError(errText('פתיחת הדיל נכשלה', e));
    } finally {
      setBusy(null);
    }
  }

  async function createAndOpen(chat, form = null) {
    setBusy(chat.id);
    try {
      const { dealId } = await api.whatsapp.openDealFromChat(chat.id, form || {});
      setDialog(null);
      setDrawerDealId(dealId);
      await load();
    } catch (e) {
      setError(errText('יצירת הדיל נכשלה', e));
    } finally {
      setBusy(null);
    }
  }

  async function setChatState(chat, data) {
    try {
      await api.whatsapp.chatState(chat.id, data);
      await load();
    } catch (e) {
      setError(errText('הפעולה נכשלה', e));
    }
  }

  function toggleRead(chat) {
    const seen = readSeen();
    if (isUnread(chat, seen, manualUnread) || unreadCounts[chat.id]) {
      markSeen(chat.id);
      setManualUnread((cur) => {
        const next = { ...cur };
        delete next[chat.id];
        return next;
      });
      setUnreadCounts((cur) => {
        const next = { ...cur };
        delete next[chat.id];
        return next;
      });
    } else {
      // WhatsApp-style manual unread: a display flag (empty circle) — counts
      // stay honest and only reflect real new messages.
      markUnread(chat.id);
      setManualUnread((cur) => ({ ...cur, [chat.id]: true }));
      if (selected?.id === chat.id) setSelected(null);
    }
  }

  const kindChips = [
    { key: 'private', label: 'פרטיות' },
    { key: 'group', label: 'קבוצות' },
    { key: 'all', label: 'הכל' },
  ];

  // The unmatched (CRM repair) scope is a private-chat concept — hidden in
  // the groups view.
  const scopeChips = [
    { key: 'active', label: 'שיחות' },
    ...(kind === 'group'
      ? []
      : [{ key: 'unmatched', label: unmatchedCount > 0 ? `ללא שיוך (${unmatchedCount})` : 'ללא שיוך' }]),
    { key: 'all', label: 'הכל' },
  ];

  // Deal-based filters are meaningless for groups.
  const statusFilters = STATUS_FILTERS.filter(
    (f) => kind !== 'group' || (f.key !== 'deal' && f.key !== 'nodeal'),
  );

  return (
    <>
      {error && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700" dir="auto">
          {error}
        </div>
      )}

      <div
        ref={containerRef}
        className="flex h-[calc(100vh-190px)] min-h-[460px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
      >
        {/* RIGHT — conversation list (pinned, resizable) */}
        <aside style={{ width: listWidth }} className="flex min-w-0 shrink-0 flex-col border-l border-gray-200">
          <div className="space-y-2 border-b border-gray-100 p-2.5">
            <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1">
              {[{ id: 'all', label: 'כל המספרים' }, ...accounts.map((a) => ({ id: a.id, label: a.label }))].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setAccountFilter(t.id)}
                  className={`whitespace-nowrap rounded-lg px-3 py-1 text-[12px] font-semibold transition ${
                    accountFilter === t.id
                      ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-200'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {/* Kind switch — groups live behind an explicit toggle so the
                  default CRM work queue stays private-chat only. */}
              <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-gray-100 p-0.5">
                {kindChips.map((k) => (
                  <button
                    key={k.key}
                    type="button"
                    onClick={() => {
                      setKind(k.key);
                      if (k.key === 'group' && scope === 'unmatched') setScope('active');
                      if (k.key === 'group') setStatusFilter((f) => (f === 'deal' || f === 'nodeal' ? 'all' : f));
                    }}
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold transition ${
                      kind === k.key ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              <span className="h-4 w-px shrink-0 bg-gray-200" />
              {scopeChips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setScope(c.key)}
                  className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                    scope === c.key && !search
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 overflow-x-auto">
              {statusFilters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setStatusFilter(f.key)}
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium transition ${
                    statusFilter === f.key
                      ? 'bg-gray-800 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם או מספר…  (Ctrl+K)"
              dir="auto"
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-[13px] focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredChats === null ? (
              <p className="px-4 py-10 text-center text-sm text-gray-400">טוען שיחות…</p>
            ) : filteredChats.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50">
                  <WhatsAppLogo size={24} />
                </div>
                <p className="text-sm text-gray-500">
                  {search ? 'אין תוצאות' : scope === 'unmatched' ? 'אין שיחות ללא שיוך 🎉' : 'אין שיחות בתצוגה הזו'}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filteredChats.map((chat) => (
                  <li key={chat.id}>
                    <ChatListRow
                      chat={chat}
                      active={!!selected && chat.id === selected.id}
                      cursor={cursorId === chat.id}
                      unreadCount={unreadCounts[chat.id] || 0}
                      manualUnread={!!manualUnread[chat.id]}
                      snoozeMenuOpen={snoozeMenuFor === chat.id}
                      onOpen={openChat}
                      onTogglePin={(c) => setChatState(c, { pinned: !c.pinnedAt })}
                      onToggleRead={toggleRead}
                      onToggleSnoozeMenu={(c) => setSnoozeMenuFor(c && snoozeMenuFor !== c.id ? c.id : null)}
                      onSnooze={(untilIso) => {
                        setSnoozeMenuFor(null);
                        setChatState(chat, { snoozedUntil: untilIso });
                      }}
                      onToggleHidden={(c) => {
                        setSnoozeMenuFor(null);
                        setChatState(c, { hidden: !c.hiddenAt });
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Resize handle */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="שינוי רוחב רשימת השיחות"
          onMouseDown={() => {
            draggingRef.current = true;
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'col-resize';
          }}
          className="w-1 shrink-0 cursor-col-resize bg-gray-100 hover:bg-emerald-400/60"
        />

        {/* LEFT — the selected conversation. position:relative so the deal
            drawer (rendered at the bottom of this section) covers exactly the
            chat area and stops at the conversation-list boundary. */}
        <section className="relative flex min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-gray-900" dir="auto">
                    {selected.displayName || selected.phoneNumber || 'לא מזוהה'}
                  </p>
                  <p className="flex items-center gap-2 text-[11.5px] text-gray-500">
                    {selected.type === 'group' && <span>👥 קבוצה</span>}
                    {selected.phoneNumber && (
                      <span className="flex items-center gap-1" dir="ltr">
                        <PhoneFlag phone={selected.phoneNumber} />
                        {selected.phoneNumber}
                      </span>
                    )}
                    <span>· {selected.account?.label || selected.accountId}</span>
                    {/* CRM identity is a PRIVATE-chat concept — groups get no
                        linking affordance and no deal actions. */}
                    {selected.type !== 'group' &&
                      (selected.contact ? (
                        <span className="text-emerald-700">· {selected.contact.name}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setLinking(!linking)}
                          className="text-blue-700 hover:underline"
                        >
                          · שיוך לאיש קשר
                        </button>
                      ))}
                  </p>
                </div>
                {selected.type !== 'group' && (
                  <button
                    type="button"
                    disabled={busy === selected.id}
                    onClick={() => openDeal(selected)}
                    className={`shrink-0 rounded-lg px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50 ${
                      selected.contact ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    {busy === selected.id ? 'פותח…' : selected.contact ? 'פתח דיל' : 'צור דיל'}
                  </button>
                )}
              </div>
              {linking && !selected.contact && selected.type !== 'group' && (
                <div className="border-b border-gray-100 px-3 py-2.5">
                  <ContactPicker
                    busy={busy === selected.id}
                    onPick={(c) => link(selected, c)}
                    onCancel={() => setLinking(false)}
                  />
                </div>
              )}
              <div className="min-h-0 flex-1">
                <ChatThread key={selected.id} chat={selected} fill />
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
                <WhatsAppLogo size={30} />
              </div>
              <p className="text-sm text-gray-500">בחרו שיחה מהרשימה כדי לצפות ולהשיב</p>
              <p className="text-[11.5px] text-gray-400">↑↓ מעבר בין שיחות · Enter פתיחה · Ctrl+K חיפוש</p>
            </div>
          )}

          {/* Deal drawer — covers the chat area only; the list stays visible. */}
          {drawerDealId && (
            <DealDrawer
              dealId={drawerDealId}
              onClose={() => {
                setDrawerDealId(null);
                load();
              }}
            />
          )}
        </section>
      </div>

      {dialog?.kind === 'no_contact' && (
        <CreateDealDialog
          chat={dialog.chat}
          suggestedName={dialog.suggestedName}
          busy={busy === dialog.chat?.id}
          onConfirm={(form) => createAndOpen(dialog.chat, form)}
          onClose={() => setDialog(null)}
        />
      )}

      <ConfirmDialog
        open={dialog?.kind === 'no_deals'}
        title="פתיחת דיל חדש"
        body={`ל${dialog?.contactName || 'איש הקשר'} אין עדיין דילים במערכת.\nייפתח דיל חדש עבורו. להמשיך?`}
        confirmLabel="פתח דיל חדש"
        onCancel={() => setDialog(null)}
        onConfirm={() => createAndOpen(dialog.chat)}
      />

      {dialog?.kind === 'choose' && (
        <DealPickDialog
          title={`לאיזה דיל של ${dialog.contactName || 'איש הקשר'}?`}
          body="נמצאו כמה דילים רלוונטיים — בחרו את הנכון."
          deals={dialog.deals}
          allowNew={false}
          onPick={(d) => {
            setDialog(null);
            setDrawerDealId(d.id);
          }}
          onClose={() => {
            // A drawer-follow choice that was dismissed: don't leave the
            // PREVIOUS conversation's deal on screen — show the conversation.
            if (dialog.follow) setDrawerDealId(null);
            setDialog(null);
          }}
        />
      )}

      {/* Switching conversations while the drawer holds unsaved Deal edits —
          never replace them silently. Cancel keeps the current deal open
          (the conversation still switches; nothing is lost either way).
          Note + WhatsApp drafts auto-persist regardless. */}
      <ConfirmDialog
        open={!!followConfirm}
        title="שינויים שלא נשמרו בדיל"
        body={'בדיל הפתוח יש שינויים שעדיין לא נשמרו.\nלהמשיך לשיחה החדשה? (טיוטות של פתקים והודעות נשמרות אוטומטית — אבל שינויים בשדות הדיל יאבדו.)'}
        confirmLabel="המשך בלי לשמור"
        onCancel={() => setFollowConfirm(null)}
        onConfirm={() => {
          const chat = followConfirm;
          setFollowConfirm(null);
          if (chat) followDrawer(chat);
        }}
      />

      {dialog?.kind === 'old_or_new' && (
        <DealPickDialog
          title={`אין דיל פעיל ל${dialog.contactName || 'איש הקשר'}`}
          body="הדילים הקיימים ישנים (אבודים או שהסיור כבר עבר). אפשר לפתוח דיל חדש או לבחור אחד מהישנים."
          deals={dialog.deals}
          allowNew
          busy={busy === dialog.chat?.id}
          onNew={() => createAndOpen(dialog.chat)}
          onPick={(d) => {
            setDialog(null);
            setDrawerDealId(d.id);
          }}
          onClose={() => setDialog(null)}
        />
      )}

    </>
  );
}
