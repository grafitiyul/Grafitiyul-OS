import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Dialog from '../common/Dialog.jsx';
import { api } from '../../lib/api.js';
import OrgContactsSection from '../crm/common/OrgContactsSection.jsx';
import { OrgPicker, resolveOrganization } from '../crm/common/OrgPicker.jsx';
import UnitPicker from '../crm/common/UnitPicker.jsx';
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
const FIELD = 'border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white w-full';

export default function OrganizationEditDialog({ deal, types, subtypes, open, onClose, onSaved }) {
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

  // Initialise from the deal whenever the dialog opens. The OrgPicker is
  // uncontrolled after mount, so it mounts only once `pickerInit` is resolved
  // (needs the linked org's name). The baseline is captured together with the
  // (possibly async) effective type, so dirty tracking is accurate.
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
  }, [open, deal]);

  // Follow the picker: selecting a different existing org (or clearing it)
  // swaps the fetched org + resets the unit; a typed-new name simply means
  // "no existing org selected" until save creates it.
  useEffect(() => {
    if (!resolution) return;
    const rid = resolution.existingOrgId || '';
    if (rid === orgId) return;
    setOrgId(rid);
    setUnitId('');
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
      await onSaved?.();
      onClose?.();
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="ארגון בדיל"
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
            disabled={busy || !!resolution?.invalid}
            className="bg-blue-600 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50"
          >
            {busy ? 'שומר…' : 'שמור'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {pickerInit === undefined ? (
          <div className="h-10 rounded-lg bg-gray-100 animate-pulse" />
        ) : (
          <OrgPicker
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
