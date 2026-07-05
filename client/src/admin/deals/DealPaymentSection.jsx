import { useState } from 'react';
import { api } from '../../lib/api.js';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import { minorToInput } from '../../lib/money.js';
import { contactNameHe } from './config.js';

// "תשלום באייקאונט" — the Deal's personal iCount payment-link module.
// GOS is the source of truth: the link is generated ONCE, stored on the deal
// (DealPaymentLink) and shown here on every load. Regeneration is an explicit,
// confirmed action ({ regenerate: true }); the server 409s anything else, so a
// double-click can never mint two links. Generating a link never marks the
// deal paid — payment confirmation is a separate flow.

// Mirror of the server's prefill pick: first contact flagged to receive
// payment links, else the primary/first contact.
function pickPaymentContact(contacts) {
  const list = contacts || [];
  return list.find((dc) => dc.receivePaymentLinks) || list[0] || null;
}

function waHref(phone, text) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `972${digits.slice(1)}`;
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

const ERROR_HE = {
  icount_not_configured: 'חיבור אייקאונט אינו מוגדר בשרת (חסרים משתני סביבה של אייקאונט).',
  icount_paypage_not_configured: 'לא הוגדר עמוד תשלום (ICOUNT_DEFAULT_PAYPAGE_ID) בשרת.',
  amount_missing: 'לעסקה אין סכום — קבעו מחיר בבונה המחיר לפני יצירת לינק.',
  link_exists: 'כבר קיים לינק פעיל לעסקה זו. לחצו "צור לינק חדש" כדי להחליף אותו.',
};

function errorMessage(err) {
  const code = err?.payload?.error;
  if (code && ERROR_HE[code]) return ERROR_HE[code];
  const msg = err?.payload?.message || err?.message || '';
  if (msg.includes('icount_generate_failed')) {
    return `אייקאונט החזיר שגיאה: ${msg.split('icount_generate_failed:')[1]?.trim() || msg}`;
  }
  return 'יצירת הלינק נכשלה. נסו שוב או בדקו את הגדרות אייקאונט.';
}

function Detail({ label, value, warn }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={warn ? 'text-amber-600' : 'text-gray-900'}>{value || '—'}</span>
    </div>
  );
}

export default function DealPaymentSection({ deal, productName, onChanged }) {
  const [confirm, setConfirm] = useState(null); // null | 'create' | 'regenerate'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const link = deal.paymentLinks?.[0] || null;
  const contact = pickPaymentContact(deal.contacts)?.contact || null;
  const customerName =
    contactNameHe(contact) || `${contact?.firstNameEn || ''} ${contact?.lastNameEn || ''}`.trim();
  const customerPhone = contact?.phones?.[0]?.value || '';
  const customerEmail = contact?.emails?.[0]?.value || '';
  const amountMinor = Number(deal.valueMinor || 0);
  const amountLabel = amountMinor > 0 ? `₪${minorToInput(amountMinor)}` : null;

  async function generate(regenerate) {
    setBusy(true);
    setError(null);
    try {
      await api.deals.createPaymentLink(deal.id, regenerate ? { regenerate: true } : {});
      setConfirm(null);
      await onChanged?.();
    } catch (err) {
      setConfirm(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link.paymentLinkUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('ההעתקה נכשלה — העתיקו את הקישור ידנית.');
    }
  }

  const waText = link
    ? `שלום${link.customerName ? ` ${link.customerName}` : ''}, מצורף קישור לתשלום עבור ${link.productName}: ${link.paymentLinkUrl}`
    : '';
  const wa = link ? waHref(link.customerPhone || customerPhone, waText) : null;
  // The link freezes what was sent to iCount — flag drift so a stale link is
  // never sent to the customer unnoticed.
  const amountDrifted = link && Number(link.amountMinor) !== amountMinor;

  const confirmBody = (
    <div className="space-y-2">
      <p className="text-sm text-gray-800">האם ליצור לינק תשלום אישי באייקאונט עבור העסקה הזו?</p>
      {confirm === 'regenerate' && (
        <p className="text-sm text-amber-700">הלינק הקיים יסומן כלא-פעיל ויוחלף בלינק חדש.</p>
      )}
      <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-1.5">
        <Detail label="לקוח" value={customerName} />
        <Detail label="סכום" value={amountLabel} />
        <Detail label="מוצר / שירות" value={productName} />
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* What a (re)generated link will be built from — the live deal data. */}
      <div className="space-y-1.5">
        <Detail label="סכום" value={amountLabel} />
        <Detail label="מוצר / שירות" value={productName} />
        <Detail label="לקוח" value={customerName} />
        <Detail label="טלפון" value={customerPhone} warn={!customerPhone} />
        <Detail label="אימייל" value={customerEmail} warn={!customerEmail} />
      </div>
      {(!customerPhone || !customerEmail) && (
        <p className="text-[12px] text-amber-600">
          {!customerPhone && !customerEmail
            ? 'לאיש הקשר אין טלפון ואימייל — הלינק ייווצר בלי מילוי מוקדם שלהם, והלקוח ישלים אותם בעמוד התשלום.'
            : !customerPhone
              ? 'לאיש הקשר אין טלפון — השדה לא ימולא מראש בעמוד התשלום.'
              : 'לאיש הקשר אין אימייל — השדה לא ימולא מראש בעמוד התשלום.'}
        </p>
      )}

      {link ? (
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <div className="text-[11px] text-gray-500">
            לינק אישי קיים · נוצר {new Date(link.createdAt).toLocaleDateString('he-IL')} · על סך{' '}
            <span dir="ltr">₪{minorToInput(link.amountMinor)}</span>
          </div>
          <div
            dir="ltr"
            className="truncate rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[12px] text-gray-700 font-mono"
            title={link.paymentLinkUrl}
          >
            {link.paymentLinkUrl}
          </div>
          {amountDrifted && (
            <p className="text-[12px] text-amber-600">
              סכום העסקה השתנה מאז שהלינק נוצר — שקלו ליצור לינק חדש לפני שליחה ללקוח.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copyLink}
              className="rounded-lg bg-blue-600 text-white text-[13px] font-semibold px-3 py-1.5 hover:bg-blue-700"
            >
              {copied ? '✓ הועתק' : 'העתק לינק'}
            </button>
            <a
              href={link.paymentLinkUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-gray-300 text-gray-700 text-[13px] font-medium px-3 py-1.5 hover:bg-gray-50"
            >
              פתח
            </a>
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-gray-300 text-gray-700 text-[13px] font-medium px-3 py-1.5 hover:bg-gray-50"
              >
                שלח בוואטסאפ
              </a>
            )}
            <button
              type="button"
              disabled={busy || amountMinor <= 0}
              onClick={() => setConfirm('regenerate')}
              className="rounded-lg border border-gray-300 text-gray-500 text-[13px] font-medium px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
            >
              צור לינק חדש
            </button>
          </div>
        </div>
      ) : (
        <div className="pt-2 border-t border-gray-100">
          <button
            type="button"
            disabled={busy || amountMinor <= 0}
            onClick={() => setConfirm('create')}
            className="rounded-lg bg-blue-600 text-white text-[13px] font-semibold px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'יוצר לינק…' : 'צור לינק תשלום באייקאונט'}
          </button>
          {amountMinor <= 0 && (
            <p className="mt-2 text-[12px] text-gray-500">
              קבעו מחיר לעסקה בבונה המחיר כדי לאפשר יצירת לינק.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-[12px] text-red-600">{error}</p>}

      <ConfirmDialog
        open={confirm !== null}
        title="לינק תשלום באייקאונט"
        body={confirmBody}
        confirmLabel={busy ? 'יוצר…' : confirm === 'regenerate' ? 'צור לינק חדש' : 'צור לינק'}
        onCancel={() => (busy ? null : setConfirm(null))}
        onConfirm={() => (busy ? null : generate(confirm === 'regenerate'))}
      />
    </div>
  );
}
