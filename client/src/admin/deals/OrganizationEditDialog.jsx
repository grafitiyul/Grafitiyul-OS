import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Dialog from '../common/Dialog.jsx';
import { api } from '../../lib/api.js';
import OrgContactsSection from '../crm/common/OrgContactsSection.jsx';
import { OrgPicker, resolveOrganization } from '../crm/common/OrgPicker.jsx';
import UnitPicker from '../crm/common/UnitPicker.jsx';
import { contactOrganizationSuggestions } from '../crm/common/contactOrganizations.js';
import { useDirtyWhen } from '../../lib/dirtyForms.js';

// Choose / edit the Deal's organization binding from the header — a focused
// chooser, NOT a second organization editor. Organization selection goes
// through THE canonical OrgPicker (live server search + "+ צור ארגון חדש" →
// the one CreateOrgDialog/create API); unit selection goes through the shared
// UnitPicker (search + create through the one unit API). It links out to the
// full Organization page for deep editing (finance, contacts).
//
// Source-of-truth rules (ENFORCED on the backend — deals/classification.js):
//   • Linking an organization forces the deal to activityType='business' and
//     force-nulls any deal-level organizationTypeId (server-side, automatic).
//   • Organization type
//       – org linked  → edits the ORGANIZATION's own type (api.organizations.update);
//                        every deal of that org reflects it. (No deal-level copy.)
//       – new org     → chosen inside OrgPicker (required there).
//       – no org      → stored on the DEAL (Deal.organizationTypeId).
//   • Subtype  → always on the Deal (Deal.organizationSubtypeId); the server
//                clears it if it does not belong to the linked org's type.
//                The field renders ONLY when the effective type actually has
//                subtypes — never as an empty select.
//   • Unit     → on the Deal (Deal.organizationUnitId); must belong to the
//                linked org (unit_not_in_organization server-side).
//
// Nothing autosaves — there is one explicit "שמור" button.
//
// COMPLETION MODE (`requireOrganization`): the SAME dialog, opened by a flow
// that cannot continue without an organization (today: quote generation). It
// only changes the chrome — an explanation line, its own title/confirm wording,
// and a save button that stays disabled until an organization is actually
// resolved. There is deliberately no second organization-completion dialog in
// the product: one picker, one create path, one unit rule.
//
// `suggestContacts` (full contact payloads with orgLinks) turns on a suggestion
// strip of organizations the deal's contacts ALREADY belong to — proven links
// only, primary first. Nothing is ever inferred from names, domains or history.
const FIELD = 'border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white w-full';

export default function OrganizationEditDialog({
  deal,
  types,
  subtypes,
  open,
  onClose,
  onSaved,
  requireOrganization = false,
  title = 'ארגון בדיל',
  intro = null,
  confirmLabel = 'שמור',
  suggestContacts = null,
}) {
  const [resolution, setResolution] = useState(null);
  const [orgId, setOrgId] = useState('');
  const [name, setName] = useState(''); // the linked org's own name (editable when linked)
  const [unitId, setUnitId] = useState('');
  const [typeId, setTypeId] = useState(''); // effective org type (org's, or deal's when no org)
  const [subtypeId, setSubtypeId] = useState('');
  const [orgFull, setOrgFull] = useState(null); // fetched org (units + current type + contactLinks)
  const [original, setOriginal] = useState(null); // baseline binding for dirty check
  const [pickerInit, setPickerInit] = useState(undefined); // undefined = not ready yet
  const [busy, setBusy] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  // Bumped when a suggestion is applied — OrgPicker is uncontrolled after mount,
  // so a new initial selection means a fresh instance.
  const [pickerNonce, setPickerNonce] = useState(0);
  // A unit carried in from an applied suggestion, consumed by the org-switch
  // reset (which otherwise clears the unit on every organization change).
  const pendingUnitRef = useRef('');
  const savingRef = useRef(false);

  const suggestions = useMemo(
    () => (suggestContacts ? contactOrganizationSuggestions(suggestContacts) : []),
    [suggestContacts],
  );

  // Reload the linked org (contacts/units) after the contacts section or the
  // unit picker mutates it.
  async function reloadOrgFull() {
    if (!orgId) return;
    try {
      setOrgFull(await api.organizations.get(orgId));
    } catch {
      /* keep current */
    }
  }

  // Initialise from the deal when the dialog OPENS (or is reused for a
  // different deal) — deliberately keyed on the deal's IDENTITY, never on the
  // deal object. The Deal page refetches its deal in the background (realtime
  // hints), and every refetch hands down a new object: keying on it re-ran this
  // whole reset while the dialog was open, blanking `orgFull` — which unmounts
  // the contacts section below and takes any half-typed "איש קשר חדש" form with
  // it. Nothing the operator is editing may be reset by a background refresh;
  // only opening the dialog (or pointing it at another deal) re-initialises it.
  //
  // The OrgPicker is uncontrolled after mount, so it mounts only once
  // `pickerInit` is resolved (needs the linked org's name). The baseline is
  // captured together with the (possibly async) effective type, so dirty
  // tracking is accurate.
  useEffect(() => {
    if (!open) return;
    const initialOrgId = deal.organizationId || '';
    const baseUnit = deal.organizationUnitId || '';
    const baseSub = deal.organizationSubtypeId || '';
    setResolution(null);
    setOrgId(initialOrgId);
    setUnitId(baseUnit);
    setSubtypeId(baseSub);
    setName('');
    setOrgFull(null);
    setOriginal(null);
    setPickerInit(undefined);
    setPickerNonce(0);
    pendingUnitRef.current = '';
    if (initialOrgId) {
      api.organizations
        .get(initialOrgId)
        .then((full) => {
          setOrgFull(full);
          const t = full.organizationTypeId || '';
          setTypeId(t);
          setName(full.name || '');
          setPickerInit({ id: initialOrgId, name: full.name || '' });
          setOriginal({ orgId: initialOrgId, unitId: baseUnit, subtypeId: baseSub, typeId: t, name: full.name || '' });
        })
        .catch(() => {
          setTypeId('');
          setPickerInit({ id: initialOrgId, name: '' });
          setOriginal({ orgId: initialOrgId, unitId: baseUnit, subtypeId: baseSub, typeId: '', name: '' });
        });
    } else {
      // No org → the deal owns the type.
      const t = deal.organizationType?.id || deal.organizationTypeId || '';
      setTypeId(t);
      setPickerInit(null);
      setOriginal({ orgId: '', unitId: baseUnit, subtypeId: baseSub, typeId: t, name: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deal?.id]);

  // Applying a suggestion = selecting that existing organization. The picker is
  // uncontrolled after mount, so it is remounted with the new initial selection;
  // the membership's own unit (which belongs to that organization by
  // construction) is carried across the org-switch reset below.
  function applySuggestion(s) {
    pendingUnitRef.current = s.unitId || '';
    setPickerInit({ id: s.id, name: s.name });
    setPickerNonce((n) => n + 1);
  }

  // Follow the picker: selecting a different existing org (or clearing it)
  // swaps the fetched org + resets the unit; a typed-new name simply means
  // "no existing org selected" until save creates it.
  useEffect(() => {
    if (!resolution) return;
    const rid = resolution.existingOrgId || '';
    if (rid === orgId) return;
    setOrgId(rid);
    setUnitId(rid ? pendingUnitRef.current || '' : '');
    pendingUnitRef.current = '';
    setOrgFull(null);
    setName('');
    if (rid) {
      api.organizations
        .get(rid)
        .then((full) => {
          setOrgFull(full);
          setTypeId(full.organizationTypeId || '');
          setName(full.name || '');
        })
        .catch(() => setTypeId(''));
    }
    // When clearing the org, keep the current typeId as the deal's own type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolution]);

  const isNew = !!resolution?.isNew;
  // Will saving actually leave the deal WITH an organization? (An existing one
  // picked, or a valid new one about to be created.) Drives completion mode.
  const hasOrganization = !!resolution?.isExisting || (isNew && !resolution?.invalid) || (!resolution && !!orgId);
  // Effective type: linked org's (editable here) / the new org's (picked inside
  // OrgPicker) / the deal's own when there is no organization.
  const effectiveTypeId = isNew ? resolution?.orgTypeId || '' : typeId;
  // Subtypes are scoped to the effective type (plus generic, type-less subtypes).
  const scopedSubtypes = subtypes.filter(
    (s) => !effectiveTypeId || !s.organizationTypeId || s.organizationTypeId === effectiveTypeId,
  );
  const units = orgFull?.units || [];

  // Unsaved-work guard (auto-update): dirty when the chosen binding / org name
  // diverges from the baseline; clears on revert, on save, or on close.
  useDirtyWhen(
    { orgId: isNew ? `new:${resolution?.newOrgName || ''}` : orgId, unitId, subtypeId, typeId: effectiveTypeId, name },
    original,
    { active: open && !!original },
  );

  async function save() {
    // `busy` is state, so two clicks in the same tick would both get through and
    // commit the link (and, in completion mode, resume generation) twice.
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    try {
      let finalOrgId = null;
      if (resolution?.isExisting) {
        finalOrgId = resolution.existingOrgId;
      } else if (isNew) {
        if (resolution.invalid) {
          alert('לארגון חדש חייבים לבחור סוג.');
          return;
        }
        // The ONE creation path (resolveOrganization → POST /api/organizations).
        finalOrgId = (await resolveOrganization(resolution)).organizationId;
      } else if (!resolution && orgId) {
        // Opened on an already-linked deal and never touched — keep the link.
        finalOrgId = orgId;
      }
      // Completion mode must never write a null link (and never let the caller
      // resume as if an organization had been chosen).
      if (requireOrganization && !finalOrgId) {
        alert('יש לבחור ארגון קיים או ליצור ארגון חדש.');
        return;
      }
      const dealPayload = {
        organizationId: finalOrgId,
        // unitId can only have been chosen from the currently linked org's
        // units (the follow-effect clears it on every org switch).
        organizationUnitId: finalOrgId ? unitId || null : null,
        organizationSubtypeId: subtypeId || null,
      };
      // Deal owns the type ONLY when there is no organization.
      if (!finalOrgId) dealPayload.organizationTypeId = typeId || null;
      await api.deals.update(deal.id, dealPayload);

      // When an EXISTING org is linked, the organization is the source of truth
      // for its own name + type — written straight to the org (one update),
      // never copied onto the deal. Only once ITS full record loaded — the
      // name/type baseline must belong to the org actually being written.
      if (finalOrgId && resolution?.isExisting && orgFull?.id === finalOrgId) {
        const orgPayload = {};
        if (typeId !== (orgFull?.organizationTypeId || '')) orgPayload.organizationTypeId = typeId || null;
        if (name.trim() && name.trim() !== (orgFull?.name || '')) orgPayload.name = name.trim();
        if (Object.keys(orgPayload).length) await api.organizations.update(finalOrgId, orgPayload);
      }
      // The linked id is handed back so a waiting flow can resume immediately
      // (existing callers pass a no-arg refresh and are unaffected).
      await onSaved?.({ organizationId: finalOrgId });
      onClose?.();
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-1.5 hover:bg-gray-50"
          >
            ביטול
          </button>
          <button
            onClick={save}
            disabled={busy || !!resolution?.invalid || (requireOrganization && !hasOrganization)}
            className="bg-blue-600 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50"
          >
            {busy ? 'שומר…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {intro && (
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-[13px] leading-relaxed text-blue-900 ring-1 ring-blue-200">
            {intro}
          </p>
        )}

        {/* Organizations the deal's contacts ALREADY belong to — one click links
            the right one. Proven memberships only; nothing is inferred. */}
        {suggestions.length > 0 && !orgId && !isNew && (
          <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-2.5">
            <div className="mb-1.5 text-[11.5px] font-medium text-gray-500">
              {suggestions.length === 1 ? 'הארגון של איש הקשר' : 'ארגונים של אנשי הקשר בדיל'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => applySuggestion(s)}
                  title={s.contactName ? `דרך ${s.contactName}` : undefined}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[12px] text-gray-700 hover:border-blue-400 hover:bg-blue-50"
                >
                  <span className="truncate">{s.name}</span>
                  {s.unitName && <span className="shrink-0 text-[10.5px] text-gray-400">· {s.unitName}</span>}
                  {s.isPrimary && (
                    <span className="shrink-0 rounded-full bg-amber-50 px-1 text-[9.5px] font-bold text-amber-700 ring-1 ring-amber-200">
                      ראשי
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {pickerInit === undefined ? (
          <div className="h-10 rounded-lg bg-gray-100 animate-pulse" />
        ) : (
          <OrgPicker
            key={pickerNonce}
            serverSearch
            allowCreateDialog
            types={types}
            initialSelected={pickerInit}
            onResolve={setResolution}
          />
        )}

        {orgId && (
          <Field label="שם הארגון">
            <input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} />
          </Field>
        )}

        {orgId && (
          <UnitPicker
            orgId={orgId}
            units={units}
            value={unitId}
            onChange={setUnitId}
            onCreated={reloadOrgFull}
          />
        )}

        {/* Type: OrgPicker owns it for a NEW org (required there); here it is
            editable for a linked org (writes to the ORG) or a bare deal. */}
        {!isNew && (
          <Field label="סוג ארגון">
            <select value={typeId} onChange={(e) => { setTypeId(e.target.value); setSubtypeId(''); }} className={FIELD}>
              <option value="">— ללא —</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              {orgId
                ? 'נשמר על הארגון — ישפיע על כל הדילים של אותו ארגון.'
                : 'נשמר על הדיל עד שיקושר ארגון.'}
            </p>
          </Field>
        )}

        {/* Hidden entirely when the effective type has no subtypes. */}
        {scopedSubtypes.length > 0 && (
          <Field label="תת-סוג (של הדיל)">
            <select value={subtypeId} onChange={(e) => setSubtypeId(e.target.value)} className={FIELD}>
              <option value="">— ללא —</option>
              {scopedSubtypes.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </Field>
        )}

        {/* Collapsible: manage the org's linked contacts inline (reuses the same
            shared section as the full Organization page). */}
        {orgId && orgFull && (
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
            <button
              type="button"
              onClick={() => setShowContacts((o) => !o)}
              className="w-full flex items-center justify-between"
            >
              <span className="text-[13px] font-semibold text-gray-700">
                אנשי קשר בארגון
                {orgFull.contactLinks?.length ? (
                  <span className="ms-1 text-[11px] text-gray-400">({orgFull.contactLinks.length})</span>
                ) : null}
              </span>
              <span className="text-gray-400 text-xs">{showContacts ? '▾' : '▸'}</span>
            </button>
            {showContacts && (
              <div className="mt-3">
                <OrgContactsSection org={orgFull} onChange={reloadOrgFull} />
              </div>
            )}
          </div>
        )}

        {orgId && (
          <div className="pt-1">
            <Link to={`/admin/crm/organizations/${orgFull?.orgNo ?? orgId}`} className="text-[13px] text-blue-700 hover:underline">
              פתח את כרטיס הארגון המלא (יחידות, כספים) ←
            </Link>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-gray-500">{label}</label>
      {children}
    </div>
  );
}
