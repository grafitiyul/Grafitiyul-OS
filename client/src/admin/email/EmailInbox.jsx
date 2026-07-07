import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import DealDrawer from '../whatsapp/DealDrawer.jsx';
import EmailThreadView from './EmailThreadView.jsx';
import EmailComposer from './EmailComposer.jsx';
import { hasDirtyForms } from '../../lib/dirtyForms.js';

// Email inbox — the working surface for business email, mirroring the
// WhatsApp inbox workflow:
//   RIGHT: thread list (resizable, persisted width) with account switcher,
//          filters and search. Unread state is GOS-side (server-counted).
//   LEFT:  the selected conversation (thread + reply). Manual contact linking
//          lives here (unmatched threads only). פתח דיל opens the SAME
//          DealDrawer over the reading pane; the list stays visible.
// Switching threads while the drawer is open follows PASSIVELY (exactly-one
// matching deal swaps the drawer; several ask; none closes it) with the same
// dirty-forms guard as WhatsApp.

const LAYOUT_KEY = 'gos-email-inbox'; // { listWidth }
const LIST_MIN = 300;
const LIST_MAX = 540;

// All chips except ארכיון are scoped to the ACTIVE inbox (threads Gmail's own
// inbox would show); ארכיון exposes the rest of the mirror. Search spans both.
const FILTERS = [
  { key: 'all', label: 'הכל' },
  { key: 'unread', label: 'לא נקראו' },
  { key: 'unmatched', label: 'ללא שיוך' },
  { key: 'deal', label: 'עם דיל' },
  { key: 'nodeal', label: 'בלי דיל' },
  { key: 'today', label: 'היום' },
  { key: 'archive', label: 'ארכיון' },
];

const DEAL_STATUS = {
  open: { label: 'פתוח', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
  won: { label: 'נסגר', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  lost: { label: 'אבוד', cls: 'bg-gray-100 text-gray-500 ring-gray-200' },
};

function fmtListTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

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

function threadTitle(t) {
  if (t.contactName) return t.contactName;
  const p = (t.participants || [])[0];
  return p?.name || p?.email || '(לא מזוהה)';
}

function errText(prefix, e) {
  const code = e?.payload?.error;
  const detail = e?.payload?.detail;
  return `${prefix} — נסו שוב.${code ? ` (${code}${detail ? `: ${detail}` : ''})` : ''}`;
}

function DealChoiceRow({ deal, onPick }) {
  const st = DEAL_STATUS[deal.status] || DEAL_STATUS.open;
  const money = fmtMoney(deal.valueMinor);
  const tour = fmtTourDate(deal.tourDate);
  return (
    <button
      type="button"
      onClick={onPick}
      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-right transition hover:border-blue-400 hover:bg-blue-50/40"
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

// Contact + deal creation from an unknown email sender — everything editable
// BEFORE anything is created (same rule as WhatsApp: no silent auto-creation).
function CreateDealDialog({ suggestedName, suggestedEmail, busy, onConfirm, onClose }) {
  const [form, setForm] = useState(() => {
    const name = (suggestedName || '').trim();
    const hasHebrew = /[֐-׿]/.test(name);
    const [first, ...rest] = name.split(/\s+/).filter(Boolean);
    const last = rest.join(' ');
    return {
      firstNameHe: hasHebrew ? first || '' : '',
      lastNameHe: hasHebrew ? last : '',
      firstNameEn: !hasHebrew && name ? first || '' : '',
      lastNameEn: !hasHebrew && name ? last : '',
      email: suggestedEmail || '',
      communicationLanguage: hasHebrew ? 'he' : 'en',
    };
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = (form.firstNameHe.trim() || form.firstNameEn.trim()) && form.email.trim();

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
            <span className="text-[11.5px] font-medium text-gray-500">אימייל</span>
            <input value={form.email} onChange={set('email')} dir="ltr" className={field} />
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

// Inline contact picker for manual linking (unmatched threads only) —
// searches by name or email address.
function ContactPicker({ onPick, onCancel, busy }) {
  const [contacts, setContacts] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    api.contacts.list().then(setContacts).catch(() => setContacts([]));
  }, []);

  const filtered = useMemo(() => {
    if (!contacts) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return contacts.slice(0, 8);
    return contacts
      .filter((c) => {
        const name = `${c.firstNameHe || ''} ${c.lastNameHe || ''} ${c.firstNameEn || ''} ${c.lastNameEn || ''}`.toLowerCase();
        const emails = (c.emails || []).map((e) => e.value.toLowerCase()).join(' ');
        return name.includes(needle) || emails.includes(needle);
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
          placeholder="חיפוש איש קשר לפי שם או אימייל…"
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
                  <span className="text-[13px] font-medium text-gray-800">
                    {`${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim() || `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim() || '—'}
                  </span>
                  <span dir="ltr" className="text-[12px] text-gray-400">{c.emails?.[0]?.value || ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function EmailInbox({ accounts = [] }) {
  const [threads, setThreads] = useState(null);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [accountFilter, setAccountFilter] = useState('all');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null); // thread snapshot
  const [composing, setComposing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [drawerDealId, setDrawerDealId] = useState(null);
  const [followConfirm, setFollowConfirm] = useState(null);
  const [error, setError] = useState(null);
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

  const load = useCallback(async () => {
    try {
      const data = await api.email.inbox({
        q: search || undefined,
        accountId: accountFilter === 'all' ? undefined : accountFilter,
        filter,
      });
      setThreads(data.threads);
      setUnreadTotal(data.unreadTotal || 0);
      setSelected((cur) => (cur ? data.threads.find((t) => t.id === cur.id) || cur : cur));
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e?.message || 'failed');
    }
  }, [search, accountFilter, filter]);

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

  // Open a thread. WORK-QUEUE MODE (same as WhatsApp): with the drawer open,
  // switching threads follows passively — one matching deal swaps the drawer,
  // several ask, none closes it. Unsaved Deal edits are guarded.
  function openThread(thread) {
    const switching = selected?.id !== thread.id;
    setSelected(thread);
    setComposing(false);
    setLinking(false);
    if (!drawerDealId || !switching) return;
    if (hasDirtyForms()) {
      setFollowConfirm(thread);
    } else {
      followDrawer(thread);
    }
  }

  async function followDrawer(thread) {
    try {
      const r = await api.email.dealResolution(thread.id);
      if (r.kind === 'open') setDrawerDealId(r.dealId);
      else if (r.kind === 'choose') setDialog({ ...r, thread, follow: true });
      else setDrawerDealId(null);
    } catch (e) {
      setDrawerDealId(null);
      setError(errText('איתור הדיל לשיחה נכשל', e));
    }
  }

  // Keyboard: Esc closes (dialog → search → thread), Ctrl+K focuses search.
  useEffect(() => {
    function onKey(e) {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        if (followConfirm) return setFollowConfirm(null);
        if (drawerDealId) return; // the drawer handles its own ESC
        if (dialog) return setDialog(null);
        if (inField) {
          e.target.blur();
          if (e.target === searchInputRef.current) setSearch('');
          return;
        }
        if (selected) setSelected(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, drawerDealId, selected, followConfirm]);

  async function linkContact(thread, contact) {
    setBusy(thread.id);
    try {
      await api.email.linkContact(thread.id, contact.id);
      setLinking(false);
      await load();
    } catch (e) {
      setError(errText('השיוך נכשל', e));
    } finally {
      setBusy(null);
    }
  }

  async function openDeal(thread) {
    setBusy(thread.id);
    setError(null);
    try {
      const r = await api.email.dealResolution(thread.id);
      if (r.kind === 'open') setDrawerDealId(r.dealId);
      else setDialog({ ...r, thread });
    } catch (e) {
      setError(errText('פתיחת הדיל נכשלה', e));
    } finally {
      setBusy(null);
    }
  }

  async function pickDeal(thread, deal) {
    // An explicit pick from the dialog also LINKS the thread (so the deal's
    // email tab and history show it from now on).
    setDialog(null);
    setDrawerDealId(deal.id);
    try {
      await api.email.linkDeal(thread.id, deal.id);
      await load();
    } catch (e) {
      setError(errText('קישור השיחה לדיל נכשל', e));
    }
  }

  async function createAndOpen(thread, form = null) {
    setBusy(thread.id);
    try {
      const { dealId } = await api.email.openDealFromThread(thread.id, form || {});
      setDialog(null);
      setDrawerDealId(dealId);
      await load();
    } catch (e) {
      setError(errText('יצירת הדיל נכשלה', e));
    } finally {
      setBusy(null);
    }
  }

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
        {/* RIGHT — thread list */}
        <aside style={{ width: listWidth }} className="flex min-w-0 shrink-0 flex-col border-l border-gray-200">
          <div className="space-y-2 border-b border-gray-100 p-2.5">
            {accounts.length > 1 && (
              <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1">
                {[{ id: 'all', label: 'כל החשבונות' }, ...accounts.map((a) => ({ id: a.id, label: a.emailAddress }))].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setAccountFilter(t.id)}
                    className={`whitespace-nowrap rounded-lg px-3 py-1 text-[12px] font-semibold transition ${
                      accountFilter === t.id
                        ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-200'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1 overflow-x-auto">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium transition ${
                    filter === f.key ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {f.key === 'unread' && unreadTotal > 0 ? `${f.label} (${unreadTotal})` : f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש לפי נושא, שם או כתובת…  (Ctrl+K)"
                dir="auto"
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-[13px] focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setComposing(true);
                }}
                title="מייל חדש"
                className="shrink-0 rounded-xl bg-blue-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-700"
              >
                +
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {threads === null ? (
              <p className="px-4 py-10 text-center text-sm text-gray-400">טוען מיילים…</p>
            ) : threads.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-xl">📧</div>
                <p className="text-sm text-gray-500">{search ? 'אין תוצאות' : 'אין מיילים בתצוגה הזו'}</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {threads.map((t) => {
                  const active = !!selected && t.id === selected.id;
                  const unread = t.unreadCount > 0 || t.manualUnread;
                  return (
                    <li key={t.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => openThread(t)}
                        onKeyDown={(e) => e.key === 'Enter' && openThread(t)}
                        className={`group flex w-full cursor-pointer items-start gap-2 px-3 py-2.5 text-right transition ${
                          active ? 'bg-blue-50/70' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5">
                            <span
                              className={`truncate text-[13.5px] ${unread ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}
                              dir="auto"
                            >
                              {threadTitle(t)}
                            </span>
                            {t.linkedDeal && (
                              <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-px text-[10px] font-semibold text-blue-700 ring-1 ring-blue-200">
                                דיל
                              </span>
                            )}
                            {!t.contactId && (
                              <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
                                ללא שיוך
                              </span>
                            )}
                            {t.inInbox === false && (
                              <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-px text-[10px] font-semibold text-gray-500 ring-1 ring-gray-200">
                                ארכיון
                              </span>
                            )}
                          </p>
                          <p className={`truncate text-[12.5px] ${unread ? 'font-semibold text-gray-700' : 'text-gray-500'}`} dir="auto">
                            {t.subject || '(ללא נושא)'}
                          </p>
                          <p className="truncate text-[12px] text-gray-400" dir="auto">{t.snippet || ''}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="text-[11px] text-gray-400">{fmtListTime(t.lastMessageAt)}</span>
                          {t.unreadCount > 0 ? (
                            <span className="rounded-full bg-blue-600 px-1.5 text-[10.5px] font-bold text-white">
                              {t.unreadCount}
                            </span>
                          ) : t.manualUnread ? (
                            // Manual "סמן כלא נקרא" — display dot only; the
                            // honest Gmail-matching count is never inflated.
                            <span
                              className="h-3 w-3 rounded-full border-[2.5px] border-blue-500"
                              title="סומנה כלא נקראה"
                            />
                          ) : null}
                          {/* Hover action — mark read/unread (GOS-side only;
                              Gmail is never written). */}
                          <button
                            type="button"
                            title={unread ? 'סמן כנקרא' : 'סמן כלא נקרא'}
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                if (unread) await api.email.markThreadRead(t.id);
                                else await api.email.markThreadUnread(t.id);
                                await load();
                              } catch (err) {
                                setError(errText('הפעולה נכשלה', err));
                              }
                            }}
                            className="hidden h-6 w-6 items-center justify-center rounded-md bg-white text-[12px] text-gray-500 shadow-sm ring-1 ring-gray-200 hover:text-gray-800 group-hover:flex"
                          >
                            {unread ? '✓' : '✉'}
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Resize handle */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="שינוי רוחב רשימת המיילים"
          onMouseDown={() => {
            draggingRef.current = true;
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'col-resize';
          }}
          className="w-1 shrink-0 cursor-col-resize bg-gray-100 hover:bg-blue-400/60"
        />

        {/* LEFT — the selected thread / composer. position:relative bounds the
            deal drawer to the reading pane; the list stays visible. */}
        <section className="relative flex min-w-0 flex-1 flex-col">
          {composing ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <h3 className="mb-3 text-[15px] font-bold text-gray-900">מייל חדש</h3>
              <EmailComposer
                onCancel={() => setComposing(false)}
                onSent={() => {
                  setComposing(false);
                  load();
                }}
              />
            </div>
          ) : selected ? (
            <>
              <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-gray-900" dir="auto">
                    {selected.subject || '(ללא נושא)'}
                  </p>
                  <p className="flex items-center gap-2 text-[11.5px] text-gray-500">
                    <span dir="auto">{threadTitle(selected)}</span>
                    {(selected.participants || [])[0]?.email && (
                      <span dir="ltr">{(selected.participants || [])[0].email}</span>
                    )}
                    {selected.contactName ? (
                      <span className="text-emerald-700">· {selected.contactName}</span>
                    ) : (
                      <button type="button" onClick={() => setLinking(!linking)} className="text-blue-700 hover:underline">
                        · שיוך לאיש קשר
                      </button>
                    )}
                    {selected.linkedDeal && (
                      <span className="inline-flex items-center gap-1 text-blue-700" dir="auto">
                        · {selected.linkedDeal.title}
                        <button
                          type="button"
                          title="ניתוק השיחה מהדיל (אפשר לקשר מחדש)"
                          onClick={async () => {
                            try {
                              await api.email.linkDeal(selected.id, null);
                              await load();
                            } catch (e) {
                              setError(errText('ניתוק הדיל נכשל', e));
                            }
                          }}
                          className="rounded px-0.5 text-gray-400 hover:text-red-600"
                        >
                          ×
                        </button>
                      </span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy === selected.id}
                  onClick={() => openDeal(selected)}
                  className={`shrink-0 rounded-lg px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50 ${
                    selected.contactId ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {busy === selected.id ? 'פותח…' : selected.contactId ? 'פתח דיל' : 'צור דיל'}
                </button>
              </div>
              {linking && !selected.contactId && (
                <div className="border-b border-gray-100 px-3 py-2.5">
                  <ContactPicker
                    busy={busy === selected.id}
                    onPick={(c) => linkContact(selected, c)}
                    onCancel={() => setLinking(false)}
                  />
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <EmailThreadView key={selected.id} threadId={selected.id} onChanged={load} />
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-3xl">📧</div>
              <p className="text-sm text-gray-500">בחרו שיחת מייל מהרשימה — או פתחו מייל חדש עם +</p>
              <p className="text-[11.5px] text-gray-400">Ctrl+K חיפוש · Esc סגירה</p>
            </div>
          )}

          {/* Deal drawer — covers the reading pane only; the list stays visible. */}
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
          suggestedName={dialog.suggestedName}
          suggestedEmail={dialog.suggestedEmail}
          busy={busy === dialog.thread?.id}
          onConfirm={(form) => createAndOpen(dialog.thread, form)}
          onClose={() => setDialog(null)}
        />
      )}

      <ConfirmDialog
        open={dialog?.kind === 'no_deals'}
        title="פתיחת דיל חדש"
        body={`ל${dialog?.contactName || 'איש הקשר'} אין עדיין דילים במערכת.\nייפתח דיל חדש עבורו. להמשיך?`}
        confirmLabel="פתח דיל חדש"
        onCancel={() => setDialog(null)}
        onConfirm={() => createAndOpen(dialog.thread)}
      />

      {dialog?.kind === 'choose' && (
        <DealPickDialog
          title={`לאיזה דיל של ${dialog.contactName || 'איש הקשר'}?`}
          body="נמצאו כמה דילים רלוונטיים — בחרו את הנכון. השיחה תקושר לדיל שתבחרו."
          deals={dialog.deals}
          allowNew={false}
          onPick={(d) => pickDeal(dialog.thread, d)}
          onClose={() => {
            if (dialog.follow) setDrawerDealId(null);
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === 'old_or_new' && (
        <DealPickDialog
          title={`אין דיל פעיל ל${dialog.contactName || 'איש הקשר'}`}
          body="הדילים הקיימים ישנים (אבודים או שהסיור כבר עבר). אפשר לפתוח דיל חדש או לבחור אחד מהישנים."
          deals={dialog.deals}
          allowNew
          busy={busy === dialog.thread?.id}
          onNew={() => createAndOpen(dialog.thread)}
          onPick={(d) => pickDeal(dialog.thread, d)}
          onClose={() => setDialog(null)}
        />
      )}

      <ConfirmDialog
        open={!!followConfirm}
        title="שינויים שלא נשמרו בדיל"
        body={'בדיל הפתוח יש שינויים שעדיין לא נשמרו.\nלהמשיך לשיחה החדשה? (טיוטות נשמרות אוטומטית — אבל שינויים בשדות הדיל יאבדו.)'}
        confirmLabel="המשך בלי לשמור"
        onCancel={() => setFollowConfirm(null)}
        onConfirm={() => {
          const thread = followConfirm;
          setFollowConfirm(null);
          if (thread) followDrawer(thread);
        }}
      />
    </>
  );
}
