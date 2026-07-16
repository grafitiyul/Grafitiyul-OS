import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';

// Travel Agency Reservations — the permanent per-agent reservation link,
// managed from the Contact page (BINDING #3: this is the module's entry
// point). The section renders ONLY when relevant: the contact is currently
// eligible (belongs to an organization whose type has the agentReservations
// capability), or an active link exists (so a detached contact's blocked
// link stays visible and manageable instead of silently disappearing).
export default function ReservationLinkSection({ contactId }) {
  const [state, setState] = useState(null); // { eligible, organization, link }
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await api.contacts.reservationLink(contactId));
    } catch {
      setState(null); // section is additive — a load error never breaks the page
    }
  }, [contactId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!state) return null;
  const { eligible, organization, link } = state;
  // Not an agency contact and no link to manage — stay out of the way.
  if (!eligible && !link) return null;

  async function run(fn, confirmMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (permissions); the URL stays selectable.
    }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-[14px] font-semibold text-gray-900">קישור הזמנות לסוכן</h2>
        {link && (
          <span
            className={`text-[11px] rounded-full px-2 py-0.5 ${
              link.isEnabled && eligible
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}
          >
            {!eligible ? 'חסום — לא משויך לסוכנות' : link.isEnabled ? 'פעיל' : 'מושבת'}
          </span>
        )}
      </div>
      <div className="text-[12px] text-gray-500 mb-3">
        {eligible
          ? `קישור קבוע להזמנת סיורים עבור ${organization.name}. הטופס נפתח ללא התחברות — הקישור הוא ההרשאה.`
          : 'איש הקשר אינו משויך כעת לארגון מסוג סוכנות תיירות — הקישור נחסם אוטומטית עד לשיוך מחדש.'}
      </div>

      {!link ? (
        <button
          onClick={() => run(() => api.contacts.mintReservationLink(contactId))}
          disabled={busy || !eligible}
          className="bg-blue-600 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50"
        >
          צור קישור הזמנות קבוע
        </button>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={link.url}
              dir="ltr"
              onFocus={(e) => e.target.select()}
              className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-[12px] font-mono bg-gray-50 text-gray-700"
            />
            <button
              onClick={copyUrl}
              className="text-sm border border-gray-300 rounded-md px-3 py-1.5 hover:bg-gray-50 whitespace-nowrap"
            >
              {copied ? 'הועתק ✓' : 'העתק'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <label className="flex items-center gap-1.5">
              <span className="text-gray-500">שפת טופס:</span>
              <select
                value={link.defaultLanguage}
                onChange={(e) =>
                  run(() =>
                    api.contacts.updateReservationLink(contactId, {
                      defaultLanguage: e.target.value,
                    }),
                  )
                }
                disabled={busy}
                className="border border-gray-300 rounded-md px-2 py-1 text-[13px] bg-white"
              >
                <option value="he">עברית</option>
                <option value="en">English</option>
              </select>
            </label>
            <div className="flex-1" />
            <button
              onClick={() =>
                run(() =>
                  api.contacts.updateReservationLink(contactId, {
                    isEnabled: !link.isEnabled,
                  }),
                )
              }
              disabled={busy}
              className="border border-gray-300 rounded-md px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
            >
              {link.isEnabled ? 'השבת זמנית' : 'הפעל מחדש'}
            </button>
            <button
              onClick={() =>
                run(
                  () => api.contacts.rotateReservationLink(contactId),
                  'להחליף את הקישור? הקישור הנוכחי יפסיק לעבוד מיידית ויונפק קישור חדש.',
                )
              }
              disabled={busy}
              className="border border-gray-300 rounded-md px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
            >
              החלף קישור
            </button>
            <button
              onClick={() =>
                run(
                  () => api.contacts.revokeReservationLink(contactId),
                  'לבטל את הקישור לצמיתות? הסוכן לא יוכל להזמין עד שיונפק קישור חדש.',
                )
              }
              disabled={busy}
              className="text-red-700 border border-red-300 rounded-md px-3 py-1 hover:bg-red-50 disabled:opacity-50"
            >
              בטל קישור
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
