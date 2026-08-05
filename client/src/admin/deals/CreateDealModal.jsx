import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { contactNamesFromFull } from '../../lib/nameSplit.js';
import { useDirtyWhen } from '../../lib/dirtyForms.js';
import { OrgPicker, resolveOrganization } from '../crm/common/OrgPicker.jsx';
import { contactDisplayName, presetOrgForContact } from './createDealPreset.js';

const MODAL_INPUT =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

// Create Deal — THE canonical new-deal dialog (deals list + contact page).
// Optimised around how a lead actually arrives: first the PERSON (full name +
// phone + source), not stage/value. It creates the contact, the deal, and
// links them in one flow, reusing the existing contacts/deals APIs. Stage
// defaults to the first pipeline stage server-side and value defaults to 0 —
// both intentionally out of the lead-capture flow (still backend-compatible).
//
// presetContact — opening a deal FROM a Contact page: the existing contact is
// the deal's primary contact (NO new contact is created, no re-searching), its
// primary linked organization is preselected, and the title auto-derives from
// its name. Everything else (source, inquiry, org override) is the same flow.
//
// Catalogs: pass types/subtypes/sources when the host page already holds them
// (deals list); omit them and the modal loads the small catalogs itself
// (contact page). Pass `orgs` for a preloaded org list; omit for server search.
export default function CreateDealModal({
  orgs = null,
  types: typesProp,
  subtypes: subtypesProp,
  sources: sourcesProp,
  presetContact = null,
  onClose,
  onCreated,
}) {
  const preset = presetContact || null;
  const presetName = preset ? contactDisplayName(preset) : '';
  const presetOrg = preset ? presetOrgForContact(preset) : null;

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState(presetName);
  const [titleTouched, setTitleTouched] = useState(false);
  const [inquiry, setInquiry] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [sourceFree, setSourceFree] = useState('');
  const [showBiz, setShowBiz] = useState(!!presetOrg);
  const [orgRes, setOrgRes] = useState(null); // resolution from the shared OrgPicker
  const [busy, setBusy] = useState(false);

  // Self-load the small reference catalogs when the host didn't pass them.
  const selfLoad = sourcesProp == null;
  const [cat, setCat] = useState({ types: [], subtypes: [], sources: [] });
  useEffect(() => {
    if (!selfLoad) return undefined;
    let live = true;
    Promise.all([
      api.organizationTypes.list(),
      api.organizationSubtypes.list(),
      api.dealSources.list(),
    ])
      .then(([ty, st, src]) => {
        if (live) setCat({ types: ty, subtypes: st, sources: src });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [selfLoad]);
  const types = selfLoad ? cat.types : typesProp || [];
  const subtypes = selfLoad ? cat.subtypes : subtypesProp || [];
  const sources = selfLoad ? cat.sources : sourcesProp || [];

  // Auto-derive the deal title from the full name until the user edits it.
  // In preset mode the name is fixed, so the initial title already holds it.
  useEffect(() => {
    if (!preset && !titleTouched) setTitle(fullName.trim());
  }, [preset, fullName, titleTouched]);

  const activeSources = sources.filter((s) => s.active);
  // A new organization requires a type (OrgPicker reports `invalid`); gate only
  // while the org section is open.
  const orgInvalid = showBiz && orgRes?.invalid;
  const ready = preset
    ? sourceId && !orgInvalid
    : fullName.trim() && phone.trim() && sourceId && !orgInvalid;

  // Unsaved-work guard (auto-update): dirty once real lead data is entered; clears
  // on revert, and on create/cancel (the modal unmounts). The modal is only ever
  // mounted while open, so no extra gating is needed.
  useDirtyWhen(
    { fullName, phone, email, inquiry, sourceId, sourceFree, org: !!orgRes },
    { fullName: '', phone: '', email: '', inquiry: '', sourceId: '', sourceFree: '', org: !!presetOrg },
  );

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      // 1) The primary contact: the preset contact AS-IS (never a duplicate),
      //    else a new contact from the single full-name field (split) + phone.
      let contactId;
      if (preset) {
        contactId = preset.id;
      } else {
        const contact = await api.contacts.create(contactNamesFromFull(fullName));
        await api.contacts.addPhone(contact.id, { value: phone.trim(), isPrimary: true });
        if (email.trim()) {
          await api.contacts.addEmail(contact.id, { value: email.trim(), isPrimary: true });
        }
        contactId = contact.id;
      }

      // 2) Resolve the organization (existing match | new) BEFORE the deal, via
      //    the shared OrgPicker helper — no duplicate org logic. A new org owns
      //    its type; the subtype is the deal-level field; the backend keeps
      //    Deal.organizationTypeId null while an org is linked (no duplicate truth).
      let orgFields = {};
      if (showBiz && orgRes && (orgRes.isExisting || orgRes.isNew)) {
        const { organizationId } = await resolveOrganization(orgRes);
        if (organizationId) {
          orgFields = {
            activityType: 'business',
            organizationId,
            organizationSubtypeId: orgRes.subtypeId || null,
          };
        }
      }

      // 3) The deal. Source → catalog ref; sourceFree → free text. The inquiry is
      //    NOT stored on the deal anymore — it becomes the first timeline note.
      const deal = await api.deals.create({
        title: title.trim() || (preset ? presetName : fullName.trim()),
        dealSourceId: sourceId,
        source: sourceFree.trim() || null,
        ...orgFields,
      });

      // 4) Link the contact as the deal's primary contact.
      await api.deals.addContact(deal.id, { contactId, isPrimary: true });

      // 5) Inquiry content → the deal's FIRST timeline note. A completely normal
      //    note, only tagged origin:'inquiry' so the feed renders a small
      //    "תוכן הפנייה" label above it. Best-effort: must not block the new deal.
      if (inquiry.trim()) {
        try {
          await api.timeline.create({
            subjectType: 'deal',
            subjectId: deal.id,
            kind: 'note',
            body: plainToHtml(inquiry),
            data: { origin: 'inquiry' },
          });
        } catch {
          /* non-fatal — the deal is already created */
        }
      }

      onCreated(deal);
    } catch (e) {
      alert('שגיאה ביצירת דיל: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  const presetNameEn = preset
    ? `${preset.firstNameEn || ''} ${preset.lastNameEn || ''}`.trim()
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl flex flex-col max-h-[90vh]">
        <div className="px-6 pt-6 pb-3 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">דיל חדש</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">
            {preset
              ? 'דיל חדש עבור איש הקשר הנוכחי — נותר רק לבחור מקור.'
              : 'פנייה חדשה — מי פנה, באיזה טלפון ומאיפה הגיע.'}
          </p>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          {preset ? (
            <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
              <div className="text-[11px] text-gray-500">איש קשר</div>
              <div className="text-[15px] font-semibold text-gray-900">{presetName}</div>
              {presetNameEn && presetNameEn !== presetName && (
                <div className="text-[12px] text-gray-500" dir="ltr">{presetNameEn}</div>
              )}
              <p className="text-[11px] text-gray-500 mt-1">
                הדיל ייקשר לאיש הקשר הזה — לא ייווצר איש קשר חדש.
              </p>
            </div>
          ) : (
            <>
              <Field label="שם מלא *">
                <input autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="לדוגמה: ישראל ישראלי" className={MODAL_INPUT} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="טלפון *">
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" className={MODAL_INPUT} />
                </Field>
                <Field label="אימייל">
                  <input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" className={MODAL_INPUT} />
                </Field>
              </div>
            </>
          )}
          <Field label="כותרת הדיל">
            <input
              value={title}
              onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }}
              placeholder="נוצר אוטומטית מהשם"
              className={MODAL_INPUT}
            />
          </Field>
          <Field label="תוכן הפנייה">
            <textarea value={inquiry} onChange={(e) => setInquiry(e.target.value)} rows={3} placeholder="מה הם רוצים? מה נאמר בפנייה הראשונה…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
          </Field>
          <Field label="מקור *">
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={`${MODAL_INPUT} bg-white`}>
              <option value="">— בחר מקור —</option>
              {activeSources.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
            </select>
            {activeSources.length === 0 && (
              <p className="text-[11px] text-amber-600 mt-1">אין מקורות מוגדרים. הוסיפו ב: הגדרות CRM ← מקורות דיל.</p>
            )}
          </Field>
          <Field label="פירוט מקור (אופציונלי)">
            <input value={sourceFree} onChange={(e) => setSourceFree(e.target.value)} placeholder="לדוגמה: קמפיין פייסבוק, שם ממליץ, כנס…" className={MODAL_INPUT} />
          </Field>

          {/* Optional organization — ONE free-typed field with autocomplete.
              Pick a suggestion (or type an exact existing name) → existing org,
              type locked (it is the source of truth). Type a fresh name → a new
              org is created + linked on save. No "existing vs new" decision up
              front — typing is enough. With a preset contact the primary linked
              organization arrives preselected (removable like any selection). */}
          {!showBiz ? (
            <button type="button" onClick={() => setShowBiz(true)} className="text-sm font-medium text-blue-700 hover:bg-blue-50 rounded-lg px-2 py-1.5">
              + הוסף ארגון
            </button>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-gray-700">ארגון</span>
                <button
                  type="button"
                  onClick={() => { setShowBiz(false); setOrgRes(null); }}
                  className="text-[12px] text-gray-500 hover:text-gray-700"
                >
                  הסר
                </button>
              </div>
              <OrgPicker
                orgs={orgs || []}
                serverSearch={!orgs}
                types={types}
                subtypes={subtypes}
                showSubtype
                initialSelected={presetOrg}
                onResolve={setOrgRes}
              />
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex gap-2">
          <button type="submit" disabled={busy || !ready} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'יוצר…' : 'צור דיל'}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50">ביטול</button>
        </div>
      </form>
    </div>
  );
}

// Wrap plain textarea text as simple rich HTML (paragraphs + line breaks) so the
// imported inquiry reads as a normal rich note in the timeline.
function plainToHtml(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return String(text || '')
    .trim()
    .split(/\n{2,}/)
    .map((block) => `<p>${esc(block).split('\n').join('<br>')}</p>`)
    .join('');
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-gray-500">{label}</span>
      {children}
    </label>
  );
}
