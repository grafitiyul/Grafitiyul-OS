import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import WhatsAppLogo from '../common/WhatsAppLogo.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import ChatThread from './ChatThread.jsx';
import DealDrawer from './DealDrawer.jsx';

// Active WhatsApp inbox — WhatsApp-style two-pane workspace:
//   RIGHT: pinned conversation list (resizable, persisted width) with the
//          account switcher, scope filter and search. Clicking a ROW opens
//          the chat; the primary row action is פתח דיל.
//   LEFT:  the selected conversation (full thread + composer). Manual
//          contact-linking lives HERE (unmatched chats only) — not as row
//          noise. Opening a deal slides the drawer over the chat area while
//          the list stays visible.
// Default scope is the WORK QUEUE: linked conversations + recent unknown
// ones; ancient unknown numbers stay behind the "הכל" scope or search.

const LAYOUT_KEY = 'gos-whatsapp-inbox'; // { listWidth }
const LIST_MIN = 300;
const LIST_MAX = 540;

function fmtWhen(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const today = new Date();
    const same =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    return same
      ? d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
  } catch {
    return '';
  }
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

function snippet(msg) {
  if (!msg) return 'אין הודעות';
  if (msg.textContent) return msg.textContent.slice(0, 60);
  return { image: '📷 תמונה', video: '🎬 סרטון', audio: '🎤 הודעה קולית', document: '📄 מסמך', sticker: 'סטיקר' }[msg.messageType] || 'הודעה';
}

function contactLabel(c) {
  return c.fullNameHe || c.fullNameEn || `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim() || '—';
}

function errText(prefix, e) {
  const code = e?.payload?.error;
  const detail = e?.payload?.detail;
  return `${prefix} — נסו שוב.${code ? ` (${code}${detail ? `: ${detail}` : ''})` : ''}`;
}

const DEAL_STATUS = {
  open: { label: 'פתוח', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
  won: { label: 'נסגר', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  lost: { label: 'אבוד', cls: 'bg-gray-100 text-gray-500 ring-gray-200' },
};

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
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null); // chat object snapshot
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [drawerDealId, setDrawerDealId] = useState(null);
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

  const load = useCallback(async () => {
    try {
      const data = await api.whatsapp.inboxChats({
        search: search || undefined,
        accountId: accountFilter === 'all' ? undefined : accountFilter,
        scope: search ? 'all' : scope,
      });
      setChats(data.chats);
      setUnmatchedCount(data.unmatchedCount);
      onCountChange?.(data.unmatchedCount);
      // Keep the open thread's snapshot fresh (name/contact may change).
      setSelected((cur) => (cur ? data.chats.find((c) => c.id === cur.id) || cur : cur));
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e?.message || 'failed');
    }
  }, [search, accountFilter, scope, onCountChange]);

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

  async function createAndOpen(chat) {
    setBusy(chat.id);
    try {
      const { dealId } = await api.whatsapp.openDealFromChat(chat.id);
      setDialog(null);
      setDrawerDealId(dealId);
      await load();
    } catch (e) {
      setError(errText('יצירת הדיל נכשלה', e));
    } finally {
      setBusy(null);
    }
  }

  const scopeChips = [
    { key: 'active', label: 'שיחות' },
    { key: 'unmatched', label: unmatchedCount > 0 ? `ללא שיוך (${unmatchedCount})` : 'ללא שיוך' },
    { key: 'all', label: 'הכל' },
  ];

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
            <div className="flex items-center gap-1.5">
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
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם או מספר…"
              dir="auto"
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-[13px] focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {chats === null ? (
              <p className="px-4 py-10 text-center text-sm text-gray-400">טוען שיחות…</p>
            ) : chats.length === 0 ? (
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
                {chats.map((chat) => {
                  const active = selected && chat.id === selected.id;
                  return (
                    <li key={chat.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setSelected(chat);
                          setLinking(false);
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && setSelected(chat)}
                        className={`cursor-pointer px-3 py-2.5 transition ${
                          active ? 'bg-emerald-50/70' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-gray-900" dir="auto">
                            {chat.displayName || chat.phoneNumber || 'לא מזוהה'}
                          </span>
                          <span className="shrink-0 text-[11px] text-gray-400" dir="ltr">
                            {fmtWhen(chat.lastMessageAt)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[12px] text-gray-500" dir="auto">
                            {snippet(chat.lastMessage)}
                          </span>
                          {accountFilter === 'all' && accounts.length > 1 && (
                            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                              {chat.account?.label || chat.accountId}
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          {chat.contact ? (
                            <span className="min-w-0 truncate rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                              {chat.contact.name || 'איש קשר'}
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 ring-1 ring-amber-200">
                              ללא שיוך
                            </span>
                          )}
                          <button
                            type="button"
                            disabled={busy === chat.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              openDeal(chat);
                            }}
                            className="mr-auto rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {busy === chat.id ? 'פותח…' : 'פתח דיל'}
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
          aria-label="שינוי רוחב רשימת השיחות"
          onMouseDown={() => {
            draggingRef.current = true;
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'col-resize';
          }}
          className="w-1 shrink-0 cursor-col-resize bg-gray-100 hover:bg-emerald-400/60"
        />

        {/* LEFT — the selected conversation */}
        <section className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-gray-900" dir="auto">
                    {selected.displayName || selected.phoneNumber || 'לא מזוהה'}
                  </p>
                  <p className="flex items-center gap-2 text-[11.5px] text-gray-500">
                    {selected.phoneNumber && <span dir="ltr">{selected.phoneNumber}</span>}
                    <span>· {selected.account?.label || selected.accountId}</span>
                    {selected.contact ? (
                      <span className="text-emerald-700">· {selected.contact.name}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setLinking(!linking)}
                        className="text-blue-700 hover:underline"
                      >
                        · שיוך לאיש קשר
                      </button>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy === selected.id}
                  onClick={() => openDeal(selected)}
                  className="shrink-0 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy === selected.id ? 'פותח…' : 'פתח דיל'}
                </button>
              </div>
              {linking && !selected.contact && (
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
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={dialog?.kind === 'no_contact'}
        title="יצירת איש קשר ודיל חדשים"
        body={`לשיחה הזו אין עדיין איש קשר במערכת.\nיווצרו איש קשר חדש (${dialog?.suggestedName || dialog?.chat?.phoneNumber || 'ללא שם'}) ודיל חדש, והשיחה תקושר אליהם. להמשיך?`}
        confirmLabel="צור ופתח דיל"
        onCancel={() => setDialog(null)}
        onConfirm={() => createAndOpen(dialog.chat)}
      />

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
          onClose={() => setDialog(null)}
        />
      )}

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

      {drawerDealId && (
        <DealDrawer
          dealId={drawerDealId}
          onClose={() => {
            setDrawerDealId(null);
            load();
          }}
        />
      )}
    </>
  );
}
