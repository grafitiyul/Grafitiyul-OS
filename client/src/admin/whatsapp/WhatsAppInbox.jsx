import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import WhatsAppLogo from '../common/WhatsAppLogo.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import ChatThread from './ChatThread.jsx';
import DealDrawer from './DealDrawer.jsx';

// Active WhatsApp inbox — the working CRM surface that replaces "copy the
// number from WhatsApp Web and search for the deal": every conversation, per
// connected number, with a one-click "פתח דיל" that resolves to the RIGHT
// deal (server logic): confident → the deal drawer opens directly; ambiguous
// → a selection dialog; no contact / no deals → explicit confirmation before
// anything is created. Deals open in a 75% slide-in drawer so the operator
// never loses their place in the queue. Manual linking for unmatched chats
// stays here too.

function fmtWhen(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
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
  if (msg.textContent) return msg.textContent.slice(0, 80);
  return { image: '📷 תמונה', video: '🎬 סרטון', audio: '🎤 הודעה קולית', document: '📄 מסמך', sticker: 'סטיקר' }[msg.messageType] || 'הודעה';
}

function contactLabel(c) {
  return c.fullNameHe || c.fullNameEn || `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim() || '—';
}

const DEAL_STATUS = {
  open: { label: 'פתוח', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
  won: { label: 'נסגר', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  lost: { label: 'אבוד', cls: 'bg-gray-100 text-gray-500 ring-gray-200' },
};

// One deal row inside the selection dialogs — a useful at-a-glance summary.
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

// Selection dialog (multiple candidates / old-or-new).
function DealPickDialog({ title, body, deals, allowNew, busy, onPick, onNew, onClose }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
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

// Inline contact picker for manual linking (unchanged behavior).
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
  const [unmatchedOnly, setUnmatchedOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null); // chatId with open thread
  const [linking, setLinking] = useState(null); // chatId with open picker
  const [busy, setBusy] = useState(null); // chatId with an action in flight
  const [dialog, setDialog] = useState(null); // { type, chat, ... }
  const [drawerDealId, setDrawerDealId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.whatsapp.inboxChats({
        search: search || undefined,
        accountId: accountFilter === 'all' ? undefined : accountFilter,
        unmatched: unmatchedOnly ? 1 : undefined,
      });
      setChats(data.chats);
      setUnmatchedCount(data.unmatchedCount);
      onCountChange?.(data.unmatchedCount);
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e?.message || 'failed');
    }
  }, [search, accountFilter, unmatchedOnly, onCountChange]);

  useEffect(() => {
    const t = setTimeout(() => load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  // Keep the inbox fresh — this is a working queue, not a settings page.
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden && !drawerDealId) load();
    }, 20_000);
    return () => clearInterval(t);
  }, [load, drawerDealId]);

  async function link(chat, contact) {
    setBusy(chat.id);
    try {
      await api.whatsapp.linkChat(chat.id, contact.id);
      setLinking(null);
      await load();
    } catch {
      setError('השיוך נכשל — נסו שוב.');
    } finally {
      setBusy(null);
    }
  }

  // "פתח דיל" — ask the server which deal this conversation belongs to.
  async function openDeal(chat) {
    setBusy(chat.id);
    try {
      const r = await api.whatsapp.dealResolution(chat.id);
      if (r.kind === 'open') setDrawerDealId(r.dealId);
      else setDialog({ ...r, chat });
    } catch {
      setError('פתיחת הדיל נכשלה — נסו שוב.');
    } finally {
      setBusy(null);
    }
  }

  // Confirmed creation (new contact and/or new deal) → open the drawer.
  async function createAndOpen(chat) {
    setBusy(chat.id);
    try {
      const { dealId } = await api.whatsapp.openDealFromChat(chat.id);
      setDialog(null);
      setDrawerDealId(dealId);
      await load();
    } catch {
      setError('יצירת הדיל נכשלה — נסו שוב.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {/* Account switcher — one number at a time, or everything. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-100 p-1">
          {[{ id: 'all', label: 'כל המספרים' }, ...accounts.map((a) => ({ id: a.id, label: a.label }))].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setAccountFilter(t.id)}
              className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition ${
                accountFilter === t.id
                  ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-200'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setUnmatchedOnly(!unmatchedOnly)}
          className={`rounded-full border px-3 py-1 text-[12px] font-medium transition ${
            unmatchedOnly
              ? 'border-amber-500 bg-amber-500 text-white'
              : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          ללא שיוך בלבד{unmatchedCount > 0 ? ` (${unmatchedCount})` : ''}
        </button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש לפי שם או מספר…"
          dir="auto"
          className="w-full max-w-xs rounded-xl border border-gray-300 bg-white px-4 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {chats === null ? (
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-400">
          טוען שיחות…
        </div>
      ) : chats.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
            <WhatsAppLogo size={30} />
          </div>
          <h2 className="text-[15px] font-semibold text-gray-900">
            {search || unmatchedOnly ? 'אין שיחות תואמות' : 'אין עדיין שיחות'}
          </h2>
        </div>
      ) : (
        <ul className="space-y-2">
          {chats.map((chat) => (
            <li key={chat.id} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[14px] font-semibold text-gray-900" dir="auto">
                      {chat.displayName || 'לא מזוהה'}
                    </span>
                    {chat.phoneNumber && chat.displayName !== chat.phoneNumber && (
                      <span dir="ltr" className="text-[12px] text-gray-400">{chat.phoneNumber}</span>
                    )}
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
                      {chat.account?.label || chat.accountId}
                    </span>
                    {chat.contact ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                        {chat.contact.name || 'איש קשר'}
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
                        ללא שיוך
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-gray-500" dir="auto">
                    {snippet(chat.lastMessage)}
                    {chat.lastMessageAt && <span className="text-gray-400"> · {fmtWhen(chat.lastMessageAt)}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setExpanded(expanded === chat.id ? null : chat.id);
                      setLinking(null);
                    }}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-gray-50"
                  >
                    {expanded === chat.id ? 'סגור שיחה' : 'צפייה בשיחה'}
                  </button>
                  {!chat.contact && (
                    <button
                      type="button"
                      onClick={() => setLinking(linking === chat.id ? null : chat.id)}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-gray-50"
                    >
                      שיוך לאיש קשר
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy === chat.id}
                    onClick={() => openDeal(chat)}
                    className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {busy === chat.id ? 'פותח…' : 'פתח דיל'}
                  </button>
                </div>
              </div>
              {linking === chat.id && (
                <div className="border-t border-gray-100 px-4 py-3">
                  <ContactPicker busy={busy === chat.id} onPick={(c) => link(chat, c)} onCancel={() => setLinking(null)} />
                </div>
              )}
              {expanded === chat.id && (
                <div className="border-t border-gray-100 p-3">
                  <ChatThread chat={chat} heightClass="h-[22rem]" />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* No linked contact — explicit confirmation before creating anything. */}
      <ConfirmDialog
        open={dialog?.kind === 'no_contact'}
        title="יצירת איש קשר ודיל חדשים"
        body={`לשיחה הזו אין עדיין איש קשר במערכת.\nיווצרו איש קשר חדש (${dialog?.suggestedName || dialog?.chat?.phoneNumber || 'ללא שם'}) ודיל חדש, והשיחה תקושר אליהם. להמשיך?`}
        confirmLabel="צור ופתח דיל"
        onCancel={() => setDialog(null)}
        onConfirm={() => createAndOpen(dialog.chat)}
      />

      {/* Linked contact without any deal — confirm the new deal. */}
      <ConfirmDialog
        open={dialog?.kind === 'no_deals'}
        title="פתיחת דיל חדש"
        body={`ל${dialog?.contactName || 'איש הקשר'} אין עדיין דילים במערכת.\nייפתח דיל חדש עבורו. להמשיך?`}
        confirmLabel="פתח דיל חדש"
        onCancel={() => setDialog(null)}
        onConfirm={() => createAndOpen(dialog.chat)}
      />

      {/* Several plausible deals — never guess. */}
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

      {/* Only stale deals — open a new one or pick an old one. */}
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
    </div>
  );
}
