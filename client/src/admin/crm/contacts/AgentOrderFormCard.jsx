import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import { showToast, showErrorToast } from '../../../lib/toast.js';

// "טופס הזמנה" — the agent's order form, one click from the Contact page.
//
// This is a LAUNCHER, not a second manager. The permanent link is minted,
// rotated, disabled and revoked in ReservationLinkSection further down the
// page; that stays the one write path. Here the operator only opens or copies
// the link they are about to send an agent — the thing they actually do daily,
// which used to mean scrolling past every phone, email and deal to a URL box.
//
// ELIGIBILITY IS CAPABILITY-DRIVEN, NEVER NAME-DRIVEN. The server answers from
// OrganizationType.agentReservations across the contact's canonical
// ContactOrganization memberships (reservations/links.js). Nothing here reads
// an organization's name, and no list of agency names exists anywhere in this
// file — a new agency type is a settings toggle, not a code change.
//
// ONE FORM PER AGENT, NOT PER AGENCY. AgentReservationLink hangs off the
// CONTACT: the form belongs to the person placing orders. So when a contact
// qualifies through several agencies, the card names all of them and shows the
// one link that applies — it does not fabricate a link per agency, because no
// such link exists in the model.

export default function AgentOrderFormCard({ contactId }) {
  const [state, setState] = useState(null); // { eligible, agencies, link }
  const [copying, setCopying] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api.contacts.reservationLink(contactId));
    } catch {
      // Additive card — a load failure must never break the Contact page.
      setState(null);
    }
  }, [contactId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!state) return null;
  const agencies = state.agencies || (state.organization ? [state.organization] : []);
  // Not an agency contact → the card does not exist. A configuration GAP (an
  // agency contact with no form) is a different thing and is shown loudly below.
  if (!state.eligible || agencies.length === 0) return null;

  const link = state.link;
  // A revoked link never reaches the client, but a kill-switched one does — and
  // an operator must not hand a customer a URL that answers 403.
  const usable = !!link?.url && link.isEnabled;

  async function copy() {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(link.url);
      showToast('הקישור הועתק', 'טופס ההזמנה מוכן להדבקה');
    } catch {
      showErrorToast('לא ניתן להעתיק בדפדפן הזה', 'אפשר לפתוח את הטופס ולהעתיק מסרגל הכתובות');
    } finally {
      setCopying(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-[14px] font-semibold text-gray-900">טופס הזמנה</h2>
        {link && !link.isEnabled && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">מושבת</span>
        )}
      </div>

      {/* WHICH agency (or agencies) this form belongs to. Named explicitly —
          with several memberships the operator must see all of them rather than
          trust that the right one was picked. */}
      <p className="mb-3 text-[12px] leading-relaxed text-gray-500">
        {agencies.length === 1 ? (
          <>
            הקישור הקבוע להזמנת סיורים עבור <span className="font-medium text-gray-700">{agencies[0].name}</span>.
          </>
        ) : (
          <>
            טופס ההזמנה שייך לאיש הקשר, וחל על הסוכנויות{' '}
            <span className="font-medium text-gray-700">{agencies.map((a) => a.name).join(' · ')}</span>.
          </>
        )}
      </p>

      {usable ? (
        <div className="flex flex-wrap items-center gap-2">
          {/* Primary action — a real button, not a bare link in a text box.
              rel=noopener because this opens a public capability URL. */}
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700"
          >
            פתח טופס הזמנה ↗
          </a>
          <button
            type="button"
            onClick={copy}
            disabled={copying}
            className="rounded-md border border-gray-300 px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            העתק קישור
          </button>
        </div>
      ) : (
        // A configuration gap is stated, never hidden: an agency contact with
        // no usable form is exactly the case an operator needs to find out
        // about BEFORE promising an agent a link.
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-[13px] font-medium text-amber-900">
            {link ? 'טופס ההזמנה של סוכנות זו מושבת' : 'לא הוגדר טופס הזמנה לסוכנות זו'}
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-amber-800">
            {link
              ? 'הקישור קיים אך מושבת — אפשר להפעיל אותו מחדש בקטע "קישור הזמנות לסוכן" בהמשך העמוד.'
              : 'אפשר ליצור קישור קבוע בקטע "קישור הזמנות לסוכן" בהמשך העמוד.'}
          </p>
        </div>
      )}
    </section>
  );
}
