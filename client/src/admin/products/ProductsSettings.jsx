import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import SettingsChrome from '../settings/SettingsChrome.jsx';
import Dialog from '../common/Dialog.jsx';

// Products catalog (Settings → CRM → Products). Each product has bilingual name
// + rich marketing descriptions and AT LEAST ONE variant (Product × Location).
// Business invariant: a product can't exist without a variant, so creation
// requires picking an initial location (the backend creates both atomically).
//
// Deletion is NEVER silent: opening the delete dialog first fetches a relations
// audit. A product with commercial history (deals / quote lines) cannot be hard-
// deleted — the dialog offers Archive instead. Otherwise a hard delete is allowed
// but the dialog spells out exactly what cascades (variants + pricing rules).

const BLOCKER_LABEL = { deals: 'דילים', quoteLines: 'שורות הצעת מחיר' };

export default function ProductsSettings() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nameHe, setNameHe] = useState('');
  const [locationId, setLocationId] = useState('');
  const [busy, setBusy] = useState(false);

  // Delete/archive dialog state.
  const [target, setTarget] = useState(null); // the product row being acted on
  const [audit, setAudit] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [products, locs] = await Promise.all([
        api.products.list(),
        api.locations.list(),
      ]);
      setRows(products);
      setLocations(locs);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const hasLocations = locations.length > 0;

  async function add(e) {
    e.preventDefault();
    if (!nameHe.trim() || !locationId) return;
    setBusy(true);
    try {
      const p = await api.products.create({ nameHe: nameHe.trim(), locationId });
      setNameHe('');
      setLocationId('');
      navigate(`/admin/settings/crm/products/${p.id}`);
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  async function openDelete(product) {
    setTarget(product);
    setAudit(null);
    setActionError(null);
    setAuditLoading(true);
    try {
      setAudit(await api.products.relations(product.id));
    } catch (e) {
      setActionError('שגיאה בבדיקת תלויות: ' + (e.payload?.error || e.message));
    } finally {
      setAuditLoading(false);
    }
  }

  function closeDelete() {
    if (actionBusy) return;
    setTarget(null);
    setAudit(null);
    setActionError(null);
  }

  async function setActive(product, active) {
    setActionBusy(true);
    setActionError(null);
    try {
      await api.products.update(product.id, { active });
      await refresh();
      setTarget(null);
      setAudit(null);
    } catch (e) {
      setActionError('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setActionBusy(false);
    }
  }

  async function hardDelete(product) {
    setActionBusy(true);
    setActionError(null);
    try {
      await api.products.remove(product.id);
      await refresh();
      setTarget(null);
      setAudit(null);
    } catch (e) {
      // Server refused (e.g. a deal was linked after the preflight): show the
      // authoritative audit it returned and switch the dialog to blocked mode.
      if (e.payload?.audit) setAudit(e.payload.audit);
      setActionError(
        e.payload?.error === 'has_commercial_references'
          ? 'לא ניתן למחוק — נמצאו תלויות מסחריות. ניתן להעביר לארכיון.'
          : 'שגיאה: ' + (e.payload?.error || e.message),
      );
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <SettingsChrome />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">מוצרים</h1>
        <p className="text-[15px] text-gray-500 mt-1.5">קטלוג המוצרים שאנחנו מוכרים. כל מוצר מתקיים בוריאציות לפי מיקום.</p>
      </header>

      <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-2 sm:p-3">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">טוען…</div>
          ) : error ? (
            <div className="py-6 text-center text-sm text-red-600">שגיאה: {error}</div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-12 text-center text-sm text-gray-400">עדיין אין מוצרים. הוסיפו את הראשון למטה.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-2.5 py-3 rounded-lg hover:bg-gray-50">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Link to={`/admin/settings/crm/products/${p.id}`} className="font-medium text-[15px] text-blue-700 hover:underline truncate">
                      {p.nameHe}
                    </Link>
                    {p.nameEn && <span className="text-[12px] text-gray-400 truncate" dir="ltr">{p.nameEn}</span>}
                    <span className="text-[11px] text-gray-500 shrink-0">· {p._count?.variants ?? 0} וריאציות</span>
                    {!p.active && <span className="text-[11px] text-amber-600 shrink-0">בארכיון</span>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!p.active && (
                      <button
                        type="button"
                        onClick={() => setActive(p, true)}
                        className="text-[12px] font-medium text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100"
                      >
                        הפעלה
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openDelete(p)}
                      className="text-[12px] font-medium text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
                    >
                      מחיקה
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-4 sm:px-5 py-4 border-t border-gray-100 bg-gray-50/60">
          {hasLocations ? (
            <>
              <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
                <input value={nameHe} onChange={(e) => setNameHe(e.target.value)} placeholder="שם המוצר (עברית)"
                  className="flex-1 h-10 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)}
                  className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm sm:w-52 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400">
                  <option value="">בחרו מיקום ראשון…</option>
                  {locations.map((l) => (<option key={l.id} value={l.id}>{l.nameHe}</option>))}
                </select>
                <button type="submit" disabled={busy || !nameHe.trim() || !locationId}
                  className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
                  {busy ? 'יוצר…' : 'מוצר חדש'}
                </button>
              </form>
              <p className="text-[11px] text-gray-500 mt-2">
                מוצר חייב מיקום אחד לפחות כדי להיות שמיש. ניתן להוסיף מיקומים נוספים אחרי היצירה.
              </p>
            </>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
              כדי ליצור מוצר צריך קודם להגדיר לפחות <b>מיקום אחד</b>. מוצר תמיד מתקיים בוריאציה לפי מיקום.
              {' '}
              <Link to="/admin/settings/crm/locations" className="font-medium text-amber-900 underline">
                להגדרת מיקומים
              </Link>
            </div>
          )}
        </div>
      </section>

      <DeleteProductDialog
        target={target}
        audit={audit}
        auditLoading={auditLoading}
        actionBusy={actionBusy}
        actionError={actionError}
        onClose={closeDelete}
        onArchive={() => setActive(target, false)}
        onHardDelete={() => hardDelete(target)}
      />
    </div>
  );
}

// The confirmation dialog. Renders three states off the fetched audit:
//   loading           — checking dependencies
//   blocked           — commercial refs exist → Archive only (no delete)
//   deletable         — no commercial refs → Delete (with cascade warning) + Archive
function DeleteProductDialog({ target, audit, auditLoading, actionBusy, actionError, onClose, onArchive, onHardDelete }) {
  if (!target) return null;
  const blocked = audit && !audit.canHardDelete;
  const c = audit?.counts;

  const footer = (
    <>
      <button type="button" onClick={onClose} disabled={actionBusy}
        className="h-9 px-4 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
        ביטול
      </button>
      {target.active !== false && (
        <button type="button" onClick={onArchive} disabled={actionBusy || auditLoading}
          className="h-9 px-4 rounded-lg border border-amber-300 bg-amber-50 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50">
          {actionBusy ? '…' : 'העברה לארכיון'}
        </button>
      )}
      {audit && !blocked && (
        <button type="button" onClick={onHardDelete} disabled={actionBusy}
          className="h-9 px-4 rounded-lg bg-red-600 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50">
          {actionBusy ? 'מוחק…' : 'מחיקה לצמיתות'}
        </button>
      )}
    </>
  );

  return (
    <Dialog open onClose={onClose} title={`מחיקת מוצר: ${target.nameHe}`} footer={footer}>
      {auditLoading ? (
        <div className="py-6 text-center text-sm text-gray-400">בודק תלויות…</div>
      ) : audit ? (
        <div className="space-y-3 text-[14px] text-gray-700">
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] text-gray-600">
            <div className="font-medium text-gray-700 mb-1">מה משויך למוצר:</div>
            <ul className="space-y-0.5">
              <li>וריאציות (מיקומים): <b>{c.variants}</b></li>
              <li>חוקי תמחור: <b>{c.priceRules}</b></li>
              <li>דילים: <b>{c.deals}</b></li>
              <li>שורות הצעת מחיר: <b>{c.quoteLines}</b></li>
            </ul>
          </div>

          {blocked ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-[13px] text-amber-800">
              <p className="font-medium mb-1">לא ניתן למחוק מוצר זה.</p>
              <p>
                המוצר משויך ל
                {audit.blockers.map((b, i) => (
                  <span key={b.kind}>
                    {i > 0 ? ' ו' : '־'}
                    <b>{b.count}</b> {BLOCKER_LABEL[b.kind] || b.kind}
                  </span>
                ))}
                . מחיקה הייתה מנתקת נתונים מסחריים קיימים, ולכן היא חסומה.
              </p>
              <p className="mt-1.5">מומלץ <b>להעביר לארכיון</b> — המוצר יוסתר מרשימות פעילות אך הנתונים המסחריים יישמרו. ניתן להפעיל אותו מחדש בכל עת.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-[13px] text-red-700">
              <p className="font-medium mb-1">פעולה בלתי הפיכה.</p>
              {audit.cascades.variants > 0 || audit.cascades.priceRules > 0 ? (
                <p>
                  מחיקה תסיר לצמיתות את המוצר, <b>{audit.cascades.variants}</b> וריאציות
                  {audit.cascades.priceRules > 0 && <> ו־<b>{audit.cascades.priceRules}</b> חוקי תמחור</>}.
                  לא ניתן לשחזר.
                </p>
              ) : (
                <p>המוצר יימחק לצמיתות. לא ניתן לשחזר.</p>
              )}
              <p className="mt-1.5">אם ברצונכם לשמור את הנתונים, בחרו <b>העברה לארכיון</b> במקום.</p>
            </div>
          )}

          {actionError && <div className="text-[13px] text-red-600">{actionError}</div>}
        </div>
      ) : (
        <div className="py-6 text-center text-sm text-red-600">{actionError || 'שגיאה בטעינת התלויות.'}</div>
      )}
    </Dialog>
  );
}
